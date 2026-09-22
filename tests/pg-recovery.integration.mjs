import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { backupPostgres, verifyPostgresBackup, restorePostgresBackup } from "../server/pg-recovery.mjs";
import { postgresAccountsConfig } from "../server/accounts-postgres.mjs";
import { loadVault } from "../server/vault.mjs";
import { listPublicBusinesses } from "../server/accounts.mjs";

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
    // Inject a write failure after the accounts UPDATE but before the vault INSERT.
    // Both stores must roll back atomically. Only the disposable CI database
    // admitted by the explicit guard above may install this test trigger.
    await db.query(`CREATE FUNCTION wae_ci_recovery_reject_vault()
      RETURNS trigger LANGUAGE plpgsql AS $
      BEGIN RAISE EXCEPTION 'ci_recovery_forced_failure'; END $`);
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
