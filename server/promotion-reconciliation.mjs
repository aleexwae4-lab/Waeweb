// Operator-only, read-only Stripe vs encrypted account promotion reconciliation.
// No payment-state mutations, automatic activation or HTTP endpoint.
import { billingConfig, paidPeriod, retrieveStripeSubscription, subscriptionMatchesAttempt } from "./billing.mjs";
import { postgresAccountsConfig, readAccountsPostgres } from "./accounts-postgres.mjs";
import { accountKey } from "./accounts.mjs";
import { openVaultEnvelope } from "./crypto.mjs";

const passed = id => ({ id, status: "passed" });
const blocked = id => ({ id, status: "blocked" });
const MAX_PROMOTIONS = 1000;
export function auditPromotionRecords(db, config, retrieve, { now = Date.now() } = {}) {
  if (!db || db.version !== 1 || !Array.isArray(db.users) || db.users.length > 500 ||
      !config || typeof retrieve !== "function") throw Error("audit_configuration");
  const records = [];
  for (const user of db.users) {
    if (typeof user?.id !== "string" || !Array.isArray(user.businesses) ||
        user.businesses.length > 20) throw Error("audit_payload");
    for (const business of user.businesses) {
      const p = business?.promotion;
      if (!p?.subscriptionId && p?.status !== "active") continue;
      records.push({ user, business, p });
      if (records.length > MAX_PROMOTIONS) throw Error("audit_size");
    }
  }
  return async () => {
    const counts = Object.create(null);
    const subscriptions = new Set();
    const add = code => { counts[code] = (counts[code] || 0) + 1; };
    for (const { user, business, p } of records) {
      if (typeof p.subscriptionId !== "string" ||
          !/^sub_[A-Za-z0-9_]{4,}$/.test(p.subscriptionId) ||
          (p.status !== "active" && p.status !== "inactive")) {
        add("invalid_local_record"); continue;
      }
      if (subscriptions.has(p.subscriptionId)) {
        add("duplicate_subscription"); continue;
      }
      subscriptions.add(p.subscriptionId);
      let sub;
      try { sub = await retrieve(config, p.subscriptionId); }
      catch { add("provider_unavailable"); continue; }
      if (sub?.id !== p.subscriptionId ||
          Boolean(sub.livemode) !== config.live ||
          sub.object !== "subscription") {
        add("provider_identity_mismatch"); continue;
      }
      if (typeof p.attemptId !== "string" || !p.attemptId) {
        add("legacy_binding_unverifiable"); continue;
      }
      if (!subscriptionMatchesAttempt(sub, {
        accountId: user.id, businessId: business.id, attemptId: p.attemptId
      })) {
        add("owner_binding_mismatch"); continue;
      }
      const period = paidPeriod(sub, config, { now });
      const expectedActive = Boolean(period) && business.visibility === "public";
      const localActive = p.status === "active" &&
        Number.isSafeInteger(p.currentPeriodEnd) && p.currentPeriodEnd > now &&
        business.visibility === "public";
      if (localActive !== expectedActive ||
          (expectedActive && Math.abs(p.currentPeriodEnd - period.currentPeriodEnd) > 1000)) {
        add("entitlement_drift"); continue;
      }
      add("matched");
    }
    const problemCount = Object.entries(counts).reduce((total, [code, count]) =>
      total + (code === "matched" ? 0 : count), 0);
    return {
      ready: records.length > 0 && problemCount === 0,
      scope: "billing_read_only", releaseApproval: "not_evaluated",
      totals: { subscriptions: records.length, matched: counts.matched || 0, problems: problemCount },
      checks: Object.entries(counts).sort(([a], [b]) => a.localeCompare(b))
        .map(([id, count]) => ({ id, count, status: id === "matched" ? "passed" : "blocked" }))
    };
  };
}
export async function auditStripePromotions({ retrieve = retrieveStripeSubscription, now = Date.now() } = {}) {
  if (process.env.WAE_ACCOUNTS_STORE !== "postgres" ||
      !postgresAccountsConfig() || !accountKey() || !billingConfig())
    return { ready: false, scope: "billing_read_only",
      releaseApproval: "not_evaluated", checks: [blocked("audit_configuration")] };
  try {
    const envelope = await readAccountsPostgres();
    if (typeof envelope !== "string" || Buffer.byteLength(envelope) > 4 * 1024 * 1024)
      throw Error("audit_payload");
    const db = openVaultEnvelope("accounts", JSON.parse(envelope), accountKey());
    const run = auditPromotionRecords(db, billingConfig(), retrieve, { now });
    return await run();
  } catch {
    return { ready: false, scope: "billing_read_only",
      releaseApproval: "not_evaluated", checks: [blocked("audit_unavailable")] };
  }
}
