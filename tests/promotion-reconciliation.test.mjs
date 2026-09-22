import test from "node:test";
import assert from "node:assert/strict";
import { auditPromotionRecords, auditStripePromotions } from "../server/promotion-reconciliation.mjs";

const now = Date.parse("2026-09-22T12:00:00Z");
const config = { live: false, price: "price_test_plan_2026" };
const user = "00000000-0000-4000-8000-000000000001";
const business = "00000000-0000-4000-8000-000000000002";
const attempt = "00000000-0000-4000-8000-000000000003";
const subId = "sub_test_123456";
function fixture(overrides = {}) {
  const p = {
    subscriptionId: subId, attemptId: attempt, status: "active",
    currentPeriodEnd: now + 86400000, ...overrides
  };
  return { version: 1, users: [{ id: user, businesses: [
    { id: business, visibility: "public", promotion: p }
  ] }] };
}
function provider(overrides = {}) {
  return {
    object: "subscription", id: subId, status: "active", livemode: false,
    metadata: { account_id: user, business_id: business, attempt_id: attempt },
    latest_invoice: { status: "paid", paid: true, amount_paid: 10000 },
    items: { data: [{ price: { id: config.price },
      current_period_end: Math.floor((now + 86400000) / 1000) }] },
    ...overrides
  };
}
async function run(db, sub = provider(), getter = async () => sub) {
  return (await auditPromotionRecords(db, config, getter, { now }))();
}
test("paid subscription and checkout binding reconcile without exposing identifiers", async () => {
  const report = await run(fixture());
  assert.equal(report.ready, true);
  assert.deepEqual(report.totals, { subscriptions: 1, matched: 1, problems: 0 });
  const serialized = JSON.stringify(report);
  for (const secret of [user, business, attempt, subId])
    assert.equal(serialized.includes(secret), false);
  assert.equal(report.releaseApproval, "not_evaluated");
});
test("fail closed on unpaid, wrong price, cancellation and drift", async () => {
  const unpaid = provider({ latest_invoice: { status: "open", paid: false, amount_paid: 0 } });
  const canceled = provider({ status: "canceled" });
  const wrongPrice = provider({ items: { data: [{
    price: { id: "price_other_2026" }, current_period_end: Math.floor((now + 86400000) / 1000)
  }] } });
  for (const sub of [unpaid, canceled, wrongPrice]) {
    const result = await run(fixture(), sub);
    assert.equal(result.ready, false);
    assert.equal(result.checks[0].id, "entitlement_drift");
  }
  const timeDrift = await run(fixture({ currentPeriodEnd: now + 172800000 }));
  assert.equal(timeDrift.checks[0].id, "entitlement_drift");
  const stateDrift = await run(fixture({ status: "inactive" }));
  assert.equal(stateDrift.checks[0].id, "entitlement_drift");
});
test("owner metadata, duplicate subscription and missing legacy binding are never silently trusted", async () => {
  const mismatch = await run(fixture(), provider({
    metadata: { account_id: user, business_id: business, attempt_id: "forged" }
  }));
  assert.equal(mismatch.checks[0].id, "owner_binding_mismatch");
  const legacy = await run(fixture({ attemptId: undefined }));
  assert.equal(legacy.checks[0].id, "legacy_binding_unverifiable");
  const db = fixture();
  db.users[0].businesses.push({
    id: "00000000-0000-4000-8000-000000000004", visibility: "public",
    promotion: { subscriptionId: subId, attemptId: attempt, status: "active",
      currentPeriodEnd: now + 86400000 }
  });
  const result = await run(db);
  assert.equal(result.ready, false);
  assert.equal(result.totals.problems, 1);
  assert.ok(result.checks.some(check => check.id === "duplicate_subscription"));
});
test("Stripe outage stays unknown and cannot auto-grant a promotion", async () => {
  const report = await run(fixture(), undefined, async () => { throw Error("private credential"); });
  assert.equal(report.ready, false);
  assert.equal(report.checks[0].id, "provider_unavailable");
  assert.doesNotMatch(JSON.stringify(report), /private credential/);
});
test("audit without configured PostgreSQL and Stripe fails closed without network calls", async () => {
  const report = await auditStripePromotions();
  assert.equal(report.ready, false);
  assert.equal(report.scope, "billing_read_only");
  assert.equal(report.releaseApproval, "not_evaluated");
});
