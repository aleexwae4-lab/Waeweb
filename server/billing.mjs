import { createHmac, timingSafeEqual } from "node:crypto";

const STRIPE_API = "https://api.stripe.com/v1";
const PRICE_RE = /^price_[A-Za-z0-9_]{6,120}$/;
const SECRET_RE = /^sk_(test|live)_[A-Za-z0-9_]{8,}$/;
const WEBHOOK_RE = /^whsec_[A-Za-z0-9_]{8,}$/;
const UUID_RE = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export class BillingError extends Error {
  constructor(code, message, status = 422) {
    super(message); this.name = "BillingError"; this.code = code; this.status = status;
  }
}
const fail = (code, message, status) => { throw new BillingError(code, message, status); };
export function billingConfig(env = process.env) {
  if (env.WAE_PROMOTIONS_ENABLED !== "true" || !SECRET_RE.test(env.STRIPE_SECRET_KEY || "") ||
    !WEBHOOK_RE.test(env.STRIPE_WEBHOOK_SECRET || "") || !PRICE_RE.test(env.STRIPE_PROMOTION_PRICE_ID || "")) return null;
  let origin;
  try {
    origin = new URL(env.WAE_PUBLIC_ORIGIN || "");
    if ((origin.protocol !== "https:" && !(origin.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(origin.hostname))) ||
      origin.username || origin.password || origin.pathname !== "/" ||
      origin.search || origin.hash) return null;
  } catch { return null; }
  return {
    secret: env.STRIPE_SECRET_KEY, webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    price: env.STRIPE_PROMOTION_PRICE_ID, origin: origin.origin,
    live: env.STRIPE_SECRET_KEY.startsWith("sk_live_")
  };
}
export function paidPeriod(subscription, config, { now = Date.now() } = {}) {
  if (!subscription || subscription.object !== "subscription" || !/^sub_[A-Za-z0-9_]{4,}$/.test(subscription.id || "") ||
    subscription.status !== "active" || Boolean(subscription.livemode) !== config.live) return null;
  if (!Array.isArray(subscription.items?.data) || !subscription.items.data.some(item => item.price?.id === config.price)) return null;
  const invoice = subscription.latest_invoice;
  // Require a verifiably paid latest invoice, rather than a trial or "active" flag alone.
  if (!invoice || typeof invoice !== "object" || invoice.status !== "paid" || invoice.paid !== true ||
    !Number.isSafeInteger(invoice.amount_paid) || invoice.amount_paid <= 0) return null;
  const ends = subscription.items.data.filter(item => item.price?.id === config.price)
    .map(item => item.current_period_end || subscription.current_period_end)
    .filter(Number.isSafeInteger);
  if (!ends.length) return null;
  const periodEnd = Math.min(...ends) * 1000;
  return periodEnd > now && periodEnd < now + 366 * 24 * 3600 * 1000
    ? { status: "active", currentPeriodEnd: periodEnd } : null;
}
export function verifyStripeEvent(raw, header, secret, now = Date.now()) {
  if (!Buffer.isBuffer(raw) || raw.length > 128 * 1024 ||
    typeof header !== "string" || !WEBHOOK_RE.test(secret || "")) fail("invalid_signature", "Firma de webhook inválida.", 400);
  const parts = header.split(",").map(part => part.trim().split("="));
  const t = parts.find(part => part[0] === "t")?.[1];
  const signatures = parts.filter(part => part[0] === "v1" && /^[a-f0-9]{64}$/i.test(part[1] || ""));
  if (!/^\d{10}$/.test(t || "") || Math.abs(now / 1000 - Number(t)) > 300 || !signatures.length) {
    fail("invalid_signature", "Firma de webhook inválida.", 400);
  }
  const expected = createHmac("sha256", secret).update(t + ".").update(raw).digest();
  if (!signatures.some(([, value]) => timingSafeEqual(expected, Buffer.from(value, "hex")))) {
    fail("invalid_signature", "Firma de webhook inválida.", 400);
  }
  let event;
  try { event = JSON.parse(raw.toString("utf8")); }
  catch { fail("invalid_event", "Evento de cobro inválido.", 400); }
  if (typeof event?.id !== "string" || !/^evt_[A-Za-z0-9_]{5,}$/.test(event.id) ||
    !Number.isSafeInteger(event.created) || typeof event.type !== "string" ||
    typeof event.data?.object !== "object") fail("invalid_event", "Evento de cobro inválido.", 400);
  return event;
}
async function stripeRequest(config, resource, { method = "GET", params, transport = fetch } = {}) {
  const response = await transport(STRIPE_API + resource, {
    method,
    headers: {
      authorization: "Bearer " + config.secret,
      ...(params ? { "content-type": "application/x-www-form-urlencoded" } : {})
    },
    body: params ? new URLSearchParams(params).toString() : undefined,
    signal: AbortSignal.timeout(12000)
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) fail("provider_unavailable", "El servicio de pagos no confirmó la operación.", 502);
  return data;
}
export async function createStripeCheckout(config, { accountId, businessId, attemptId, email }, transport = fetch) {
  if (![accountId, businessId, attemptId].every(v => UUID_RE.test(v || ""))) {
    fail("invalid_checkout", "Solicitud de promoción inválida.");
  }
  const params = {
    mode: "subscription", "line_items[0][price]": config.price, "line_items[0][quantity]": "1",
    client_reference_id: attemptId,
    success_url: config.origin + "/?promotion=return",
    cancel_url: config.origin + "/?promotion=canceled",
    "metadata[account_id]": accountId, "metadata[business_id]": businessId,
    "metadata[attempt_id]": attemptId,
    "subscription_data[metadata][account_id]": accountId,
    "subscription_data[metadata][business_id]": businessId,
    "subscription_data[metadata][attempt_id]": attemptId
  };
  if (email) params.customer_email = email;
  const result = await stripeRequest(config, "/checkout/sessions", { method: "POST", params, transport });
  let link;
  try { link = new URL(result.url); } catch { fail("invalid_checkout", "Checkout no proporcionó una dirección segura.", 502); }
  if (!/^cs_(test_|live_)/.test(result.id || "") || link.protocol !== "https:" ||
    link.hostname !== "checkout.stripe.com" || result.mode !== "subscription" ||
    Boolean(result.livemode) !== config.live) fail("invalid_checkout", "Checkout no verificado.", 502);
  return { id: result.id, url: link.href };
}
export async function retrieveStripeSubscription(config, subscriptionId, transport = fetch) {
  if (typeof subscriptionId !== "string" || !/^sub_[A-Za-z0-9_]{4,}$/.test(subscriptionId)) {
    fail("invalid_subscription", "Referencia de suscripción inválida.", 422);
  }
  return stripeRequest(config, "/subscriptions/" + encodeURIComponent(subscriptionId) +
    "?expand[]=latest_invoice", { transport });
}
export function subscriptionMatchesAttempt(subscription, { accountId, businessId, attemptId }) {
  return subscription?.metadata?.account_id === accountId &&
    subscription.metadata.business_id === businessId &&
    subscription.metadata.attempt_id === attemptId;
}
