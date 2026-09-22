import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
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
