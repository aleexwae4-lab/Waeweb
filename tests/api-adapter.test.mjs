import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import api from "../api/[...path].js";

test("serverless API adapter retains original paths without starting a listener", async () => {
  const server = http.createServer(api);
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const healthResponse = await fetch(base + "/api/health");
    assert.equal(healthResponse.status, 200);
    const health = await healthResponse.json();
    assert.equal(health.product, "WAE WEB");
    assert.match(health.version, /^1\.0\.0-rc\./);
    const capabilities = await (await fetch(base + "/api/capabilities")).json();
    assert.equal(capabilities.deploymentConnected, false);
    const missing = await fetch(base + "/api/unrecognized");
    assert.equal(missing.status, 405 === missing.status ? 405 : 404);
    assert.equal(missing.headers.get("cache-control"), "no-store");
    const page = await fetch(base + "/api/health", { method: "POST" });
    assert.equal(page.status, 405);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test("Vercel mode never advertises file-backed vaults or account mutations as available", async () => {
  const old = Object.fromEntries(["VERCEL","WAE_ACCOUNTS_STORE","WAE_VAULT_STORE",
    "WAE_ACCOUNTS_ENABLED","WAE_READER_ENABLED","WAE_ACCOUNTS_KEY",
    "WAE_VAULTS_JSON","WAE_VAULT_KEYS_JSON"].map(k => [k,process.env[k]]));
  const server = http.createServer(api);
  try {
    Object.assign(process.env, {
      VERCEL: "1", WAE_ACCOUNTS_STORE: "file", WAE_VAULT_STORE: "file",
      WAE_ACCOUNTS_ENABLED: "true", WAE_READER_ENABLED: "true",
      WAE_ACCOUNTS_KEY: "ab".repeat(32),
      WAE_VAULTS_JSON: JSON.stringify({ team_alpha: "test-vault-token-123456789012345678901234" }),
      WAE_VAULT_KEYS_JSON: JSON.stringify({ team_alpha: "cd".repeat(32) })
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const base = "http://127.0.0.1:" + server.address().port;
    const capability = await (await fetch(base + "/api/capabilities")).json();
    assert.equal(capability.readerEnabled, false);
    assert.equal(capability.accountsEnabled, false);
    assert.equal((await fetch(base + "/api/index/search", {
      headers: { authorization: "Bearer test-vault-token-123456789012345678901234" }
    })).status, 503);
    assert.equal((await fetch(base + "/api/account/register", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Test account", email: "blocked@example.test",
        password: "NeverCreateEphemeralAccount"
      })
    })).status, 503);
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    for (const [k,v] of Object.entries(old)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
