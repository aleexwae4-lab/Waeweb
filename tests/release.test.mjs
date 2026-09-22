import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import http from "node:http";
import { handler } from "../server/index.mjs";
import { accountsEnabled, getAccount, registerAccount } from "../server/accounts.mjs";
import { assessVercelRelease } from "../scripts/release-gate.mjs";

const ids = ["web-runtime", "durable-storage", "identity-and-abuse",
  "monetization", "web-e2e-and-security", "privacy-and-operations"];
const passing = () => ({
  target: "vercel-public-web",
  approval: "GO",
  checks: ids.map(id => ({ id, status: "passed", evidence: "https://github.com/example/example/actions/runs/1" }))
});

test("public web release remains blocked in the actual release-candidate manifest", async () => {
  const manifest = JSON.parse(await readFile(new URL("../release-readiness.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const result = assessVercelRelease(manifest, pkg.version);
  assert.equal(result.approved, false);
  assert.ok(result.blockers.some(line => line.includes("web-runtime")));
  assert.ok(result.blockers.some(line => line.includes("durable-storage")));
  assert.ok(result.blockers.some(line => line.includes("release candidate")));
});

test("release gate fails closed for missing, duplicate and unproven controls", () => {
  assert.equal(assessVercelRelease(passing(), "1.0.0").approved, true);
  assert.equal(assessVercelRelease(passing(), "1.0.0-rc.1").approved, false);
  const noApproval = passing();
  noApproval.approval = "HOLD";
  assert.equal(assessVercelRelease(noApproval, "1.0.0").approved, false);
  const missing = passing();
  missing.checks.pop();
  assert.equal(assessVercelRelease(missing, "1.0.0").approved, false);
  const duplicate = passing();
  duplicate.checks.push(duplicate.checks[0]);
  assert.equal(assessVercelRelease(duplicate, "1.0.0").approved, false);
  const unproven = passing();
  unproven.checks[0].evidence = "";
  assert.equal(assessVercelRelease(unproven, "1.0.0").approved, false);
});

test("Vercel mode fails closed rather than creating ephemeral accounts or vaults", async () => {
  const keys = ["VERCEL", "WAE_ACCOUNTS_ENABLED", "WAE_ACCOUNTS_KEY",
    "WAE_ACCOUNTS_STORE", "WAE_ACCOUNTS_DATABASE_URL", "WAE_READER_ENABLED"];
  const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  const server = http.createServer((req, res) => {
    handler(req, res).catch(() => { res.statusCode = 500; res.end("Internal error"); });
  });
  try {
    Object.assign(process.env, {
      VERCEL: "1", WAE_ACCOUNTS_ENABLED: "true",
      WAE_ACCOUNTS_KEY: "ab".repeat(32), WAE_ACCOUNTS_STORE: "file",
      WAE_READER_ENABLED: "true"
    });
    assert.equal(accountsEnabled(), false);
    await assert.rejects(() => getAccount("Bearer " + "a".repeat(43)), { code: "storage_config" });
    await assert.rejects(() => registerAccount({
      name: "No debería crearse", email: "blocked@example.test",
      password: "Not-A-Real-Production-Password"
    }), { code: "accounts_disabled" });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const capabilities = await fetch("http://127.0.0.1:" + server.address().port + "/api/capabilities");
    assert.equal(capabilities.status, 200);
    const result = await capabilities.json();
    assert.equal(result.readerEnabled, false);
    assert.equal(result.accountsEnabled, false);
    assert.equal(result.promotionsEnabled, false);
    process.env.WAE_ACCOUNTS_STORE = "postgres";
    process.env.WAE_ACCOUNTS_DATABASE_URL = "postgresql://invalid";
    assert.equal(accountsEnabled(), false, "Misconfigured Postgres cannot fall back to local disk");
  } finally {
    if (server.listening) await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
