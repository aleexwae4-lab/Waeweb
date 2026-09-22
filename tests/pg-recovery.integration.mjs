import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { tmpdir } from "node:os";
import { backupPostgres, verifyPostgresBackup, restorePostgresBackup, verifyRestoredMarketplaceMedia } from "../server/pg-recovery.mjs";
import { postgresAccountsConfig } from "../server/accounts-postgres.mjs";
import { loadVault } from "../server/vault.mjs";
import { listPublicBusinesses, loginAccount, listBusinesses, addMarketListing, uploadMarketPhoto } from "../server/accounts.mjs";

test("disposable PostgreSQL encrypted snapshot verifies, rejects tampering and restores only into empty target", {
  skip: process.env.WAE_PG_INTEGRATION !== "true"
}, async () => {
  assert.equal(process.env.NODE_ENV, "test");
  const config = postgresAccountsConfig();
  assert.ok(config);
  // This test deletes rows: NEVER run it against a hosted or non-disposable DB.
  assert.equal(config.host, "127.0.0.1", "recovery drill requires local isolated PostgreSQL");
  assert.equal(config.database, "wae_test", "recovery drill requires a disposable CI database");
  assert.equal(config.user, "wae_test", "recovery drill requires the CI-only database user");
  assert.equal(config.ssl, false, "recovery drill must not contact a hosted TLS database");
  assert.equal(process.env.WAE_POSTGRES_ALLOW_INSECURE_LOCAL_TEST, "true");
  assert.equal(process.env.WAE_PG_RECOVERY_CI_ACK, "disposable-wae-test-only");
  const backupDir = await mkdtemp(join(tmpdir(), "wae-pg-recovery-"));
  const old = process.env.WAE_PG_BACKUP_DIR;
  process.env.WAE_PG_BACKUP_DIR = backupDir;
  const { default: pg } = await import("pg");
  const db = new pg.Client(postgresAccountsConfig());
  try {
    await db.connect();
    // RC19 synthetic object store only: no real S3, credential or live photograph.
    const jpeg=Buffer.from([255,216,255,224,0,0,1,2,3,4,255,217]);
    const fakeMedia={origin:"https://private.example.test",
      bucket:"wae-test-private-media",region:"us-east-1",
      accessKey:"fake-ci-access-key",secret:"ci-only-fake-media-secret-never-production"};
    const objects=new Map(), methods=[];
    const transport=async(url,options)=>{
      methods.push(options.method);
      const path=new URL(url).pathname;
      if(options.method==="PUT"){
        objects.set(path,Buffer.from(options.body));
        return {status:200};
      }
      if(options.method==="GET"){
        const bytes=objects.get(path);
        if(!bytes)return {status:404};
        return {status:200,headers:new Headers({
          "content-type":"image/jpeg","content-length":String(bytes.length)}),
          body:Readable.from([bytes])};
      }
      throw Error("unexpected_test_object_operation");
    };
    const owner=await loginAccount({email:"postgres-owner@example.test",
      password:"Secure-Test-Password-2026-Account"});
    const auth="Bearer "+owner.token;
    const company=(await listBusinesses(auth)).businesses.find(
      item=>item.name==="Negocio persistente");
    assert.ok(company);
    const imageListing=await addMarketListing(auth,company.id,{
      kind:"product",title:"RC19 snapshot item",category:"Moda",
      description:"Synthetic PostgreSQL plus object restore verification",
      availability:"available",price:"99.00"
    });
    await uploadMarketPhoto(auth,company.id,imageListing.id,{
      imageDataUrl:"data:image/jpeg;base64,"+jpeg.toString("base64")
    },undefined,{media:fakeMedia,transport});
    assert.equal(objects.size,1);
    const before = await db.query(
      "SELECT envelope FROM wae_accounts_record WHERE id=1");
    const vaultsBefore = await db.query(
      "SELECT vault_hash,envelope FROM wae_vault_records ORDER BY vault_hash");
    assert.equal(before.rows.length, 1);
    assert.ok(before.rows[0].envelope, "integration runs after account creation");
    assert.ok(vaultsBefore.rows.length > 0, "integration runs after vault creation");
    const originalVaultCount = (await loadVault("org_alpha")).size;
    const snapshot = await backupPostgres();
    assert.equal(snapshot.encrypted, true);
    assert.equal(snapshot.accountsPresent, true);
    assert.equal(snapshot.vaults, vaultsBefore.rows.length);
    assert.equal((await verifyPostgresBackup(snapshot.filename)).checksum, snapshot.checksum);
    const originalBytes=[...objects.values()][0];
    const verified=await verifyRestoredMarketplaceMedia(snapshot.filename,
      {media:fakeMedia,transport});
    assert.equal(verified.verified,1);
    assert.equal(verified.targetSnapshotMatchesBackup,true);
    assert.equal(verified.restoreCertified,false);
    const corrupt=Buffer.from(originalBytes);corrupt[5]^=1;
    const objectPath=[...objects.keys()][0];
    objects.set(objectPath,corrupt);
    const corrupted=await verifyRestoredMarketplaceMedia(snapshot.filename,
      {media:fakeMedia,transport});
    assert.equal(corrupted.mismatch,1);
    assert.equal(corrupted.status,"attention_required");
    objects.set(objectPath,originalBytes);
    const path = join(backupDir, snapshot.filename);
    const contents = await readFile(path, "utf8");
    assert.doesNotMatch(contents, /postgres-owner@example|Contenido auténtico|local-ci-only-password/);
    await assert.rejects(() => restorePostgresBackup(snapshot.filename,
      { offlineConfirmed: true }), { code: "recovery_target_not_empty" });
    const malformed = JSON.parse(contents);
    malformed.vaults[0].envelope += "changed";
    await writeFile(path, JSON.stringify(malformed));
    await assert.rejects(() => verifyPostgresBackup(snapshot.filename),
      { code: "recovery_integrity" });
    await writeFile(path, contents);
    // The CI database is disposable and no server is running. No production data is touched.
    await db.query("BEGIN");
    await db.query("DELETE FROM wae_vault_records");
    await db.query("UPDATE wae_accounts_record SET envelope=NULL WHERE id=1");
    await db.query("COMMIT");
    const beforeRestore=await verifyRestoredMarketplaceMedia(snapshot.filename,
      {media:fakeMedia,transport});
    assert.equal(beforeRestore.status,"target_mismatch");
    assert.equal(beforeRestore.targetSnapshotMatchesBackup,false);
    // Inject a write failure after the accounts UPDATE but before the vault INSERT.
    // Both stores must roll back atomically. Only the disposable CI database
    // admitted by the explicit guard above may install this test trigger.
    await db.query(`CREATE FUNCTION wae_ci_recovery_reject_vault()
      RETURNS trigger LANGUAGE plpgsql AS $wae_ci$
      BEGIN RAISE EXCEPTION 'ci_recovery_forced_failure'; END $wae_ci$`);
    await db.query(`CREATE TRIGGER wae_ci_recovery_fail
      BEFORE INSERT ON wae_vault_records
      FOR EACH ROW EXECUTE FUNCTION wae_ci_recovery_reject_vault()`);
    await assert.rejects(() => restorePostgresBackup(snapshot.filename,
      { offlineConfirmed: true }), { code: "recovery_database" });
    assert.equal((await db.query(
      "SELECT envelope FROM wae_accounts_record WHERE id=1")).rows[0].envelope, null,
      "failure must roll back the account write");
    assert.equal((await db.query(
      "SELECT COUNT(*)::int AS n FROM wae_vault_records")).rows[0].n, 0,
      "failure must roll back every vault write");
    await db.query("DROP TRIGGER wae_ci_recovery_fail ON wae_vault_records");
    await db.query("DROP FUNCTION wae_ci_recovery_reject_vault()");
    const result = await restorePostgresBackup(snapshot.filename,
      { offlineConfirmed: true });
    assert.equal(result.restored, true);
    const afterRestore=await verifyRestoredMarketplaceMedia(snapshot.filename,
      {media:fakeMedia,transport});
    assert.equal(afterRestore.verified,1);
    assert.equal(afterRestore.targetSnapshotMatchesBackup,true);
    assert.equal(afterRestore.restoreCertified,false);
    assert.equal(methods.filter(m=>m==="PUT").length,1,
      "recovery checks must not write any objects");

    assert.equal((await loadVault("org_alpha")).size, originalVaultCount);
    const after = await db.query(
      "SELECT envelope FROM wae_accounts_record WHERE id=1");
    assert.equal(after.rows[0].envelope, before.rows[0].envelope);
    const vaultsAfter = await db.query(
      "SELECT vault_hash,envelope FROM wae_vault_records ORDER BY vault_hash");
    assert.deepEqual(vaultsAfter.rows, vaultsBefore.rows);
    assert.equal((await listPublicBusinesses("Negocio persistente")).resultCount, 1);
    await assert.rejects(() => restorePostgresBackup(snapshot.filename,
      { offlineConfirmed: true }), { code: "recovery_target_not_empty" });
  } finally {
    await db.end().catch(() => {});
    await rm(backupDir, { recursive: true, force: true });
    if (old === undefined) delete process.env.WAE_PG_BACKUP_DIR;
    else process.env.WAE_PG_BACKUP_DIR = old;
  }
});
