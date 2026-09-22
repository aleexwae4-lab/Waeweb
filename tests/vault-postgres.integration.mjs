import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { initializeVaultPostgres, closeVaultPostgres, vaultPostgresConfig } from "../server/vault-postgres.mjs";
import { loadVault, storeDocument, vaultStorageReady } from "../server/vault.mjs";
import { closeAccountsPostgres } from "../server/accounts-postgres.mjs";

const exec = promisify(execFile);
const hash = value => createHash("sha256").update(value).digest("hex");
const document = (n, org = "alpha") => {
  const url = "https://example.org/" + org + "/" + n;
  const text = "Contenido auténtico de ensayo de bóvedas persistentes — " + org + " " + n;
  return { id: hash(url).slice(0, 20), url, title: "Ensayo " + n,
    text, fingerprint: hash(text), fetchedAt: new Date().toISOString() };
};

test("PostgreSQL vaults isolate and retain AES-GCM documents across independent Node processes", {
  skip: process.env.WAE_PG_INTEGRATION !== "true"
}, async () => {
  assert.ok(vaultPostgresConfig());
  assert.equal(vaultStorageReady(), true);
  await assert.rejects(() => loadVault("org_alpha"), { code: "storage_failure" });
  await initializeVaultPostgres();

  const ids = ["org_alpha", "org_beta"];
  await storeDocument(ids[0], document(0));
  await storeDocument(ids[1], document(0, "beta"));
  const worker = `import { storeDocument } from "./server/vault.mjs";
import { closeVaultPostgres } from "./server/vault-postgres.mjs";
import { createHash } from "node:crypto";
const hash = value => createHash("sha256").update(value).digest("hex");
const id = Number(process.env.WAE_PG_WORKER);
const url = "https://example.org/alpha/" + id;
const text = "Contenido auténtico de ensayo de bóvedas persistentes — alpha " + id;
await storeDocument("org_alpha", {
  id: hash(url).slice(0,20), url, text, title: "Ensayo " + id,
  fingerprint: hash(text), fetchedAt: new Date().toISOString()
});
await closeVaultPostgres();
console.log("written", id);`;
  const completed = await Promise.all(Array.from({ length: 8 }, (_, i) =>
    exec(process.execPath, ["--input-type=module", "-e", worker], {
      env: { ...process.env, WAE_PG_WORKER: String(i + 1) }, maxBuffer: 65536
    })));
  assert.equal(completed.length, 8);
  const a = await loadVault(ids[0]);
  const b = await loadVault(ids[1]);
  assert.equal(a.size, 9, "no concurrent write lost");
  assert.equal(b.size, 1, "tenant isolation");
  assert.equal(b.has(document(0).id), false);

  // Verify only authenticated encryption envelopes are persisted in the DB.
  const { default: pg } = await import("pg");
  const client = new pg.Client(vaultPostgresConfig());
  await client.connect();
  try {
    const { rows } = await client.query("SELECT vault_hash, envelope, revision FROM wae_vault_records");
    assert.equal(rows.length, 2);
    for (const row of rows) {
      const envelope = JSON.parse(row.envelope);
      assert.equal(envelope.algorithm, "AES-256-GCM");
      assert.match(row.vault_hash, /^[a-f0-9]{64}$/);
      assert.doesNotMatch(row.envelope, /Contenido auténtico|example\.org/);
    }
  } finally { await client.end(); }

  const original = process.env.WAE_VAULT_KEYS_JSON;
  try {
    process.env.WAE_VAULT_KEYS_JSON = JSON.stringify({
      org_alpha: "ff".repeat(32), org_beta: "cd".repeat(32)
    });
    await assert.rejects(() => loadVault("org_alpha"), { code: "decrypt_failed" });
  } finally { process.env.WAE_VAULT_KEYS_JSON = original; }
  assert.equal((await loadVault(ids[0])).size, 9);
  await closeVaultPostgres();
  await closeAccountsPostgres();
});
