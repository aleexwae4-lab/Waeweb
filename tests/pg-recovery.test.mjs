import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, chmod, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sealVault } from "../server/crypto.mjs";
import { verifyRecoveryBundle, restorePostgresBackup, verifyPostgresBackup } from "../server/pg-recovery.mjs";

const sha = input => createHash("sha256").update(input).digest("hex");
const original = Object.fromEntries([
  "NODE_ENV", "WAE_ACCOUNTS_STORE", "WAE_VAULT_STORE",
  "WAE_ACCOUNTS_DATABASE_URL", "WAE_POSTGRES_ALLOW_INSECURE_LOCAL_TEST",
  "WAE_ACCOUNTS_KEY", "WAE_VAULTS_JSON", "WAE_VAULT_KEYS_JSON"
].map(key => [key, process.env[key]]));

function configure() {
  Object.assign(process.env, {
    NODE_ENV: "test", WAE_ACCOUNTS_STORE: "postgres", WAE_VAULT_STORE: "postgres",
    WAE_ACCOUNTS_DATABASE_URL: "postgresql://test:test@localhost/test",
    WAE_POSTGRES_ALLOW_INSECURE_LOCAL_TEST: "true",
    WAE_ACCOUNTS_KEY: "ab".repeat(32),
    WAE_VAULTS_JSON: JSON.stringify({ org_alpha: "test-secret-" + "a".repeat(40) }),
    WAE_VAULT_KEYS_JSON: JSON.stringify({ org_alpha: "cd".repeat(32) })
  });
}
function fixture() {
  const accounts = JSON.stringify(sealVault(
    "accounts", { version: 1, users: [] }, Buffer.from("ab".repeat(32), "hex")));
  const vault = JSON.stringify(sealVault(
    "org_alpha", { version: 2, id: "org_alpha", documents: [] },
    Buffer.from("cd".repeat(32), "hex")));
  const source = {
    version: 1, type: "waeweb-encrypted-postgres-recovery",
    createdAt: "2026-09-22T00:00:00.000Z",
    accounts: { envelope: accounts },
    vaults: [{ vaultHash: sha("org_alpha"), envelope: vault }]
  };
  return { ...source, checksum: sha(JSON.stringify(source)) };
}
test("recovery verifies encrypted account and isolated vault identities without exposing plaintext", () => {
  configure();
  const snapshot = fixture();
  assert.deepEqual(verifyRecoveryBundle(snapshot), {
    encrypted: true, accountsPresent: true, vaults: 1, documents: 0,
    checksum: snapshot.checksum
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /test-secret|test@test|WAE_ACCOUNTS_KEY/);
});
test("recovery rejects modified ciphertext, forged checksum and unknown tenants", () => {
  configure();
  const altered = fixture();
  const envelope = JSON.parse(altered.accounts.envelope);
  const bytes = Buffer.from(envelope.ciphertext, "base64");
  bytes[0] ^= 1;
  envelope.ciphertext = bytes.toString("base64");
  altered.accounts.envelope = JSON.stringify(envelope);
  assert.throws(() => verifyRecoveryBundle(altered), { code: "recovery_integrity" });
  const { checksum, ...source } = altered;
  altered.checksum = sha(JSON.stringify(source));
  assert.throws(() => verifyRecoveryBundle(altered), { code: "recovery_envelope" });
  const foreign = fixture();
  foreign.vaults[0].vaultHash = sha("org_beta");
  const { checksum: ignored, ...untrusted } = foreign;
  foreign.checksum = sha(JSON.stringify(untrusted));
  assert.throws(() => verifyRecoveryBundle(foreign), { code: "recovery_identity" });
});
test("offline confirmation is mandatory before any database connection", async () => {
  configure();
  await assert.rejects(() => restorePostgresBackup("waeweb-pg-0000000000000-00000000-0000-0000-0000-000000000000.backup.json"),
    { code: "recovery_requires_offline_confirmation" });
});
test("backup directory and files reject insecure permissions and symlink redirection", async () => {
  configure();
  const root = await mkdtemp(join(tmpdir(), "wae-pg-private-"));
  const link = root + "-link";
  const previous = process.env.WAE_PG_BACKUP_DIR;
  const filename = "waeweb-pg-0000000000000-00000000-0000-0000-0000-000000000000.backup.json";
  try {
    const path = join(root, filename);
    await writeFile(path, JSON.stringify(fixture()), { mode: 0o600 });
    process.env.WAE_PG_BACKUP_DIR = root;
    assert.equal((await verifyPostgresBackup(filename)).encrypted, true);
    await chmod(path, 0o644);
    await assert.rejects(() => verifyPostgresBackup(filename), { code: "recovery_file" });
    await chmod(path, 0o600);
    await chmod(root, 0o755);
    await assert.rejects(() => verifyPostgresBackup(filename), { code: "recovery_directory" });
    await chmod(root, 0o700);
    await symlink(root, link, "dir");
    process.env.WAE_PG_BACKUP_DIR = link;
    await assert.rejects(() => verifyPostgresBackup(filename), { code: "recovery_directory" });
  } finally {
    if (previous === undefined) delete process.env.WAE_PG_BACKUP_DIR;
    else process.env.WAE_PG_BACKUP_DIR = previous;
    await rm(link, { force: true });
    await rm(root, { recursive: true, force: true });
  }
});
test.after(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});
