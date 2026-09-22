import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { storeDocument, loadVault, vaultFilePath } from "../server/vault.mjs";
import { verifyBackup } from "../server/backup.mjs";
import { migrateLegacyVault, rotateVaultKey } from "../server/maintenance.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const oldKey = "ab".repeat(32), newKey = "cd".repeat(32);
process.env.WAE_VAULT_KEYS_JSON = JSON.stringify({ org_alpha: oldKey });
const text = "Documento de investigación que debe permanecer íntegro después de la rotación cifrada.";
function example(url) {
  return { id: sha(url).slice(0, 20), url, text, fingerprint: sha(text),
    title: "Página comprobable", fetchedAt: "2026-09-22T07:00:00Z" };
}
test("offline key rotation preserves documents and creates old-key encrypted backup", async () => {
  const root = await mkdtemp(join(tmpdir(), "wae-key-rotate-"));
  const vaultBase = join(root, "vault"), backupBase = join(root, "backup");
  const item = example("https://source.example.test/rotate");
  try {
    await storeDocument("org_alpha", item, vaultBase);
    const result = await rotateVaultKey("org_alpha", newKey, { vaultBase, backupBase });
    assert.equal(result.documents, 1);
    assert.equal(result.requiresConfigChange, true);
    assert.equal((await verifyBackup("org_alpha", result.oldKeyBackup, backupBase)).documents, 1);
    await assert.rejects(() => loadVault("org_alpha", vaultBase), { code: "decrypt_failed" });
    process.env.WAE_VAULT_KEYS_JSON = JSON.stringify({ org_alpha: newKey });
    assert.equal((await loadVault("org_alpha", vaultBase)).get(item.id).text, text);
    await assert.rejects(() => verifyBackup("org_alpha", result.oldKeyBackup, backupBase), { code: "decrypt_failed" });
    const raw = await readFile(vaultFilePath("org_alpha", vaultBase), "utf8");
    assert.doesNotMatch(raw, /Documento de investigación/);
  } finally {
    process.env.WAE_VAULT_KEYS_JSON = JSON.stringify({ org_alpha: oldKey });
    await rm(root, { recursive: true, force: true });
  }
});
test("rotation rejects reused or malformed key without altering original", async () => {
  const root = await mkdtemp(join(tmpdir(), "wae-rotate-reject-"));
  const vaultBase = join(root, "vault"), backupBase = join(root, "backup");
  try {
    await storeDocument("org_alpha", example("https://source.example.test/reject"), vaultBase);
    const original = await readFile(vaultFilePath("org_alpha", vaultBase));
    await assert.rejects(() => rotateVaultKey("org_alpha", oldKey, { vaultBase, backupBase }), { code: "same_key" });
    await assert.rejects(() => rotateVaultKey("org_alpha", "invalid", { vaultBase, backupBase }), { code: "invalid_new_key" });
    assert.deepEqual(await readFile(vaultFilePath("org_alpha", vaultBase)), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("explicit offline v1 migration validates and encrypts legacy documents", async () => {
  const root = await mkdtemp(join(tmpdir(), "wae-v1-migration-"));
  const base = join(root, "vault");
  const doc = example("https://source.example.test/legacy");
  try {
    await mkdir(base, { recursive: true });
    const path = vaultFilePath("org_alpha", base);
    await writeFile(path, JSON.stringify({ version: 1, id: "org_alpha", documents: [doc] }));
    await assert.rejects(() => loadVault("org_alpha", base), { code: "migration_required" });
    const result = await migrateLegacyVault("org_alpha", { vaultBase: base });
    assert.equal(result.migratedDocuments, 1);
    assert.equal((await loadVault("org_alpha", base)).get(doc.id).text, text);
    assert.doesNotMatch(await readFile(path, "utf8"), /Documento de investigación/);
    await assert.rejects(() => migrateLegacyVault("org_alpha", { vaultBase: base }), { code: "invalid_legacy" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("invalid legacy fingerprint aborts migration without damaging source", async () => {
  const root = await mkdtemp(join(tmpdir(), "wae-v1-unsafe-"));
  const base = join(root, "vault");
  try {
    await mkdir(base, { recursive: true });
    const doc = { ...example("https://source.example.test/corrupt"), fingerprint: "0".repeat(64) };
    const path = vaultFilePath("org_alpha", base);
    const original = JSON.stringify({ version: 1, id: "org_alpha", documents: [doc] });
    await writeFile(path, original);
    await assert.rejects(() => migrateLegacyVault("org_alpha", { vaultBase: base }), { code: "corrupt_vault" });
    assert.equal(await readFile(path, "utf8"), original);
  } finally { await rm(root, { recursive: true, force: true }); }
});
