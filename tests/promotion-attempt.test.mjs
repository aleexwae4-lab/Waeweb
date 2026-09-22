import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerAccount, addBusiness, listBusinesses, updateBusinessVisibility,
  reserveCheckout, bindCheckout, acceptPaidCheckout } from "../server/accounts.mjs";

const secret = "fa".repeat(32); // Synthetic key, never a production secret.
test("paid checkout stores the authenticated attempt for offline Stripe reconciliation", async () => {
  const prior = { enabled: process.env.WAE_ACCOUNTS_ENABLED, key: process.env.WAE_ACCOUNTS_KEY };
  process.env.WAE_ACCOUNTS_ENABLED = "true";
  process.env.WAE_ACCOUNTS_KEY = secret;
  const dir = await mkdtemp(join(tmpdir(), "wae-billing-audit-"));
  try {
    const owner = await registerAccount({
      name: "Prueba de cobro", email: "billing-reconcile@example.test",
      password: "Strong-test-password-2026-for-billing"
    }, dir);
    const bearer = "Bearer " + owner.token;
    const business = await addBusiness(bearer, {
      name: "Patrocinio de prueba", category: "Tecnología", city: "Zapopan"
    }, dir);
    await updateBusinessVisibility(bearer, business.id, true, dir);
    const attempt = await reserveCheckout(bearer, business.id, dir);
    const sessionId = "cs_test_abcdefghijk123456";
    const subscriptionId = "sub_abcdefghijk123456";
    await bindCheckout(attempt, sessionId, dir);
    const now = Date.now();
    const config = { live: false, price: "price_abcdefghijk123456" };
    const sub = {
      id: subscriptionId, object: "subscription", status: "active",
      livemode: false, metadata: {
        account_id: owner.user.id, business_id: business.id,
        attempt_id: attempt.attemptId
      },
      latest_invoice: { status: "paid", paid: true, amount_paid: 15000 },
      items: { data: [{ price: { id: config.price },
        current_period_end: Math.floor((now + 86400000) / 1000) }] }
    };
    const event = {
      id: "evt_abcdefghijk123456", created: Math.floor(now / 1000),
      type: "checkout.session.completed",
      data: { object: {
        id: sessionId, mode: "subscription", status: "complete",
        payment_status: "paid", livemode: false, subscription: subscriptionId,
        metadata: { account_id: owner.user.id, business_id: business.id,
          attempt_id: attempt.attemptId }
      } }
    };
    assert.equal((await acceptPaidCheckout(event, {
      ...sub, metadata: { ...sub.metadata, attempt_id: "wrong" }
    }, config, dir)).applied, false);
    assert.equal((await acceptPaidCheckout(event, sub, config, dir)).applied, true);
    const [stored] = (await listBusinesses(bearer, dir)).businesses;
    assert.equal(stored.promotion.subscriptionId, subscriptionId);
    assert.equal(stored.promotion.attemptId, attempt.attemptId);
    assert.equal((await acceptPaidCheckout(event, sub, config, dir)).applied, false);
  } finally {
    await rm(dir, { recursive: true, force: true });
    for (const [name, value] of [["WAE_ACCOUNTS_ENABLED", prior.enabled],
      ["WAE_ACCOUNTS_KEY", prior.key]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});
