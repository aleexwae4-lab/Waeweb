import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vaultConfig, storeDocument, loadVault, VaultError } from "../server/vault.mjs";
import { vaultKeysConfig, encryptionReady, sealVault, openVaultEnvelope, EncryptionError } from "../server/crypto.mjs";
import { createBackup, verifyBackup, restoreBackup, BackupError } from "../server/backup.mjs";

const keys = JSON.stringify({ org_alpha: "ab".repeat(32), org_beta: "cd".repeat(32) });
const tokens = JSON.stringify({ org_alpha: "a".repeat(48), org_beta: "b".repeat(48) });
process.env.WAE_VAULT_KEYS_JSON = keys; // Test fixtures ONLY. Never use these predictable keys in production.
const sha = data => createHash("sha256").update(data).digest("hex");
const text = "Texto original para respaldos cifrados y recuperación verificable del documento.";
function page(url) {
  return { id: sha(url).slice(0, 20), url, title: "Estudio documentado",
    text, fingerprint: sha(text), fetchedAt: "2026-09-22T07:00:00Z", source: "Índice WAE" };
}
test("per-vault encryption config requires valid distinct 256-bit keys matching auth IDs", () => {
  assert.equal(vaultKeysConfig("{"), null);
  assert.equal(vaultKeysConfig(JSON.stringify({ org_alpha: "short" })), null);
  assert.equal(vaultKeysConfig(JSON.stringify({ org_alpha: "a".repeat(64), org_beta: "a".repeat(64) })), null);
  assert.equal(vaultKeysConfig(JSON.stringify({ "../bad": "ab".repeat(32) })), null);
  const config = vaultKeysConfig(keys);
  assert.equal(config.get("org_alpha").length, 32);
  assert.equal(encryptionReady(vaultConfig(tokens), config), true);
  assert.equal(encryptionReady(vaultConfig(tokens), vaultKeysConfig(JSON.stringify({ org_alpha: "ab".repeat(32) }))), false);
});
test("AES-256-GCM round-trip random IV and AAD reject wrong key, wrong vault and tampering", () => {
  const payload = { version: 2, id: "org_alpha", documents: [page("https://test.example.org/a")] };
  const a = sealVault("org_alpha", payload), b = sealVault("org_alpha", payload);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.equal(a.algorithm, "AES-256-GCM");
  assert.doesNotMatch(JSON.stringify(a), /Texto original/);
  assert.deepEqual(openVaultEnvelope("org_alpha", a), payload);
  assert.throws(() => openVaultEnvelope("org_beta", a), EncryptionError);
  assert.throws(() => openVaultEnvelope("org_alpha", a, Buffer.alloc(32, 1)), { code: "decrypt_failed" });
  const bytes = Buffer.from(a.ciphertext, "base64");
  bytes[0] ^= 1;
  assert.throws(() => openVaultEnvelope("org_alpha", { ...a, ciphertext: bytes.toString("base64") }), { code: "decrypt_failed" });
  assert.throws(() => openVaultEnvelope("org_alpha", { ...a, iv: a.iv.replace(/.$/, "x") }), EncryptionError);
});
test("legacy plaintext v1 fails closed without destructive automatic migration", async () => {
  const base = await mkdtemp(join(tmpdir(), "wae-legacy-"));
  const id = "org_alpha";
  try {
    const path = join(base, sha(id) + ".json");
    const plaintext = JSON.stringify({ version: 1, id, documents: [page("https://test.example.org/legacy")] });
    await writeFile(path, plaintext);
    await assert.rejects(() => loadVault(id, base), { code: "migration_required" });
    assert.equal(await readFile(path, "utf8"), plaintext);
  } finally { await rm(base, { recursive: true, force: true }); }
});
test("encrypted backup roundtrip preserves documents; restore rejects overwrites", async () => {
  const root = await mkdtemp(join(tmpdir(), "wae-backup-roundtrip-"));
  const vaultDir = join(root, "vaults"), backupDir = join(root, "backups"), restored = join(root, "restored");
  const doc = page("https://test.example.org/roundtrip");
  try {
    await storeDocument("org_alpha", doc, vaultDir);
    const backup = await createBackup("org_alpha", vaultDir, backupDir);
    assert.equal(backup.documents, 1);
    assert.equal(backup.encrypted, true);
    const raw = await readFile(join(backupDir, backup.filename), "utf8");
    assert.doesNotMatch(raw, /Texto original|Estudio documentado/);
    const verification = await verifyBackup("org_alpha", backup.filename, backupDir);
    assert.equal(verification.documents, 1);
    assert.equal(verification.checksum, backup.checksum);
    const restoredInfo = await restoreBackup("org_alpha", backup.filename, restored, backupDir);
    assert.equal(restoredInfo.restoredDocuments, 1);
    assert.deepEqual((await loadVault("org_alpha", restored)).get(doc.id).text, doc.text);
    await assert.rejects(() => restoreBackup("org_alpha", backup.filename, restored, backupDir), { code: "vault_exists" });
    await assert.rejects(() => verifyBackup("org_beta", backup.filename, backupDir), { code: "invalid_backup_name" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("checksum detects backup modification; authentication detects forged checksum over modified ciphertext", async () => {
  const root = await mkdtemp(join(tmpdir(), "wae-backup-integrity-"));
  const vaultDir = join(root, "vaults"), backupDir = join(root, "backups");
  try {
    await storeDocument("org_alpha", page("https://test.example.org/integrity"), vaultDir);
    const created = await createBackup("org_alpha", vaultDir, backupDir);
    const path = join(backupDir, created.filename);
    const original = JSON.parse(await readFile(path, "utf8"));
    const damaged = structuredClone(original);
    const bytes = Buffer.from(damaged.envelope.ciphertext, "base64");
    bytes[0] ^= 1;
    damaged.envelope.ciphertext = bytes.toString("base64");
    await writeFile(path, JSON.stringify(damaged));
    await assert.rejects(() => verifyBackup("org_alpha", created.filename, backupDir), { code: "backup_integrity" });
    damaged.checksum = sha(JSON.stringify(damaged.envelope));
    await writeFile(path, JSON.stringify(damaged));
    await assert.rejects(() => verifyBackup("org_alpha", created.filename, backupDir), { code: "decrypt_failed" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("backup creation fails if source vault is missing rather than producing an empty recovery", async () => {
  const root = await mkdtemp(join(tmpdir(), "wae-backup-missing-"));
  try {
    await assert.rejects(() => createBackup("org_alpha", join(root, "vault"), join(root, "backup")), { code: "missing_vault" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
