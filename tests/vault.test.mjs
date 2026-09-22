import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { tmpdir } from "node:os";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  vaultConfig, authenticateVault, loadVault, storeDocument, vaultStatus, VaultError
} from "../server/vault.mjs";
import { handler } from "../server/index.mjs";

const tokenA = "wae_a_123456789012345678901234567890xyz";
const tokenB = "wae_b_123456789012345678901234567890xyz";
const vaults = JSON.stringify({ org_alpha: tokenA, org_beta: tokenB });
const keys = JSON.stringify({ org_alpha: "ab".repeat(32), org_beta: "cd".repeat(32) });
process.env.WAE_VAULT_KEYS_JSON = keys; // Fixture keys only; production keys must be random and external.
function fixture(url, text, name = "Estudio de pruebas") {
  const hash = content => createHash("sha256").update(content).digest("hex");
  return {
    id: hash(url).slice(0, 20), url, text, title: name,
    fingerprint: hash(text), source: "Índice WAE",
    fetchedAt: "2026-09-22T06:30:00.000Z"
  };
}
const text = "Contenido documental auténtico de ejemplo para comprobar persistencia por bóveda.";
test("credentials reject malformed configs, duplicated secrets and wrong bearer", () => {
  assert.equal(vaultConfig(), null); // unless explicitly supplied
  assert.equal(vaultConfig("{"), null);
  assert.equal(vaultConfig('{"../../escape":"' + tokenA + '"}'), null);
  assert.equal(vaultConfig(JSON.stringify({ first: tokenA, second: tokenA })), null);
  assert.equal(vaultConfig('{"first":"short"}'), null);
  assert.equal(vaultConfig(JSON.stringify({ first: "a".repeat(32) + " " })), null);
  assert.equal(vaultConfig(JSON.stringify({ first: "é".repeat(40) })), null);
  const config = vaultConfig(vaults);
  assert.equal(authenticateVault("Bearer " + tokenA, config), "org_alpha");
  assert.equal(authenticateVault("Bearer " + tokenB, config), "org_beta");
  assert.equal(authenticateVault("Bearer " + tokenA.slice(0, -1) + "Q", config), null);
  assert.equal(authenticateVault(null, config), null);
  assert.equal(authenticateVault("Basic " + tokenA, config), null);
});
test("vault files persist across read calls with different tenant hashes and remain isolated", async () => {
  const dir = await mkdtemp(join(tmpdir(), "waeweb-vault-test-"));
  try {
    const first = fixture("https://source.example.org/a", text);
    const second = fixture("https://source.example.org/b", text + " Otro párrafo.");
    const a = await storeDocument("org_alpha", first, dir);
    assert.equal(a.records.size, 1);
    await storeDocument("org_beta", second, dir);
    assert.equal((await loadVault("org_alpha", dir)).get(first.id).text, text);
    assert.equal((await loadVault("org_alpha", dir)).has(second.id), false);
    assert.equal((await loadVault("org_beta", dir)).has(first.id), false);
    assert.equal(await vaultStatus("org_alpha", dir), 1);
    const filenames = await readdir(dir);
    assert.equal(filenames.length, 2);
    for (const name of filenames) {
      const raw = await readFile(join(dir, name), "utf8");
      assert.doesNotMatch(raw, /Contenido documental auténtico/);
      assert.equal(JSON.parse(raw).algorithm, "AES-256-GCM");
    }
    assert.ok(filenames.every(name => /^[a-f0-9]{64}\.json$/.test(name)));
    assert.ok(filenames.every(name => !name.includes("org_")));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("same vault serializes concurrent writes and bounds its index", async () => {
  const dir = await mkdtemp(join(tmpdir(), "waeweb-vault-queue-"));
  try {
    const pages = Array.from({ length: 90 }, (_, i) =>
      fixture("https://concurrent.example.org/page-" + i, text + i));
    await Promise.all(pages.map(page => storeDocument("org_alpha", page, dir)));
    const loaded = await loadVault("org_alpha", dir);
    assert.equal(loaded.size, 80);
    assert.equal(loaded.has(pages[89].id), true);
    assert.equal(loaded.has(pages[0].id), false);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("reject tampered records and fail closed on corrupt persisted JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "waeweb-vault-integrity-"));
  try {
    const doc = fixture("https://article.example.org/check", text);
    await assert.rejects(() => storeDocument("org_alpha", { ...doc, fingerprint: "a".repeat(64) }, dir), VaultError);
    await storeDocument("org_alpha", doc, dir);
    const [file] = await readdir(dir);
    const path = join(dir, file);
    const data = JSON.parse(await readFile(path, "utf8"));
    const bytes = Buffer.from(data.ciphertext, "base64");
    bytes[0] ^= 1;
    data.ciphertext = bytes.toString("base64");
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, JSON.stringify(data));
    await assert.rejects(() => loadVault("org_alpha", dir), { code: "decrypt_failed" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("HTTP tenant endpoints deny missing auth, prevent cross-tenant reads, and reject URL GET", async () => {
  const prev = {
    reader: process.env.WAE_READER_ENABLED, vaults: process.env.WAE_VAULTS_JSON,
    dir: process.env.WAE_VAULT_DIR, keys: process.env.WAE_VAULT_KEYS_JSON
  };
  const dir = await mkdtemp(join(tmpdir(), "waeweb-vault-api-"));
  process.env.WAE_READER_ENABLED = "true";
  process.env.WAE_VAULTS_JSON = vaults;
  process.env.WAE_VAULT_KEYS_JSON = keys;
  process.env.WAE_VAULT_DIR = dir;
  const doc = fixture("https://api.example.org/document", text);
  await storeDocument("org_alpha", doc, dir);
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const unauthenticated = await fetch(base + "/api/index/search?q=Contenido");
    assert.equal(unauthenticated.status, 401);
    assert.equal((await fetch(base + "/api/index/document?id=" + doc.id)).status, 401);
    const aHeaders = { authorization: "Bearer " + tokenA };
    const bHeaders = { authorization: "Bearer " + tokenB };
    const own = await (await fetch(base + "/api/index/search?q=Contenido", { headers: aHeaders })).json();
    const other = await (await fetch(base + "/api/index/search?q=Contenido", { headers: bHeaders })).json();
    assert.equal(own.count, 1);
    assert.equal(other.count, 0);
    assert.equal(own.persistence, "encrypted_local_disk_per_vault");
    assert.equal((await fetch(base + "/api/index/document?id=" + doc.id, { headers: bHeaders })).status, 404);
    assert.equal((await fetch(base + "/api/index/document?id=" + doc.id, { headers: aHeaders })).status, 200);
    assert.equal((await fetch(base + "/api/read?url=https://example.org", { headers: aHeaders })).status, 405);
    assert.equal((await fetch(base + "/api/read", {
      method: "POST", headers: { ...aHeaders, "content-type": "application/json" },
      body: JSON.stringify({ url: "http://127.0.0.1" })
    })).status, 422);
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(prev)) {
      const name = key === "reader" ? "WAE_READER_ENABLED" : key === "vaults" ? "WAE_VAULTS_JSON" : key === "keys" ? "WAE_VAULT_KEYS_JSON" : "WAE_VAULT_DIR";
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
