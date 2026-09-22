import { randomBytes, randomUUID, createHash, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, lstat, readFile, open, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sealVault, openVaultEnvelope, EncryptionError } from "./crypto.mjs";
import { billingConfig, paidPeriod, subscriptionMatchesAttempt } from "./billing.mjs";
import { postgresAccountsSelected, postgresAccountsConfig, readAccountsPostgres, mutateAccountsPostgres } from "./accounts-postgres.mjs";
import { requiresDurableStorage } from "./hosting.mjs";
import { createListing, validateListing, publicCatalog, searchMarketplace, validMarketId, MAX_LISTINGS, MAX_OBJECT_LISTINGS, MarketplaceError } from "./marketplace.mjs";
import { mediaConfig, mediaSelected, decodeMarketPhoto, makeMediaKey, putMarketImage, deleteMarketImage, presignedMarketImage, ownerImageUrl, MarketMediaError } from "./marketplace-media.mjs";
import { validId, validateInquiry, validateReport, newInquiry, newReport, publicInquiryReceipt, MarketplaceTrustError } from "./marketplace-trust.mjs";

const scrypt = promisify(scryptCb);
const MAX_BYTES = 4 * 1024 * 1024;
const MAX_USERS = 500;
const MAX_BUSINESSES = 20;
const MAX_SESSIONS = 6;
const SESSION_MS = 7 * 24 * 3600 * 1000;
const hash = value => createHash("sha256").update(value).digest("hex");
let pending = Promise.resolve();
export class AccountError extends Error {
  constructor(code, message, status = 422) {
    super(message); this.name = "AccountError"; this.code = code; this.status = status;
  }
}
const fail = (code, message, status) => { throw new AccountError(code, message, status); };
export function accountKey(raw = process.env.WAE_ACCOUNTS_KEY) {
  return typeof raw === "string" && /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : null;
}
export function accountsEnabled() {
  const store = process.env.WAE_ACCOUNTS_STORE || "file";
  // An ephemeral serverless instance MUST NOT accept signups into its own local disk.
  // PostgreSQL is an explicit opt-in; a misconfigured DB never falls back to files.
  return process.env.WAE_ACCOUNTS_ENABLED === "true" && Boolean(accountKey()) &&
    (store === "file" && !requiresDurableStorage() ||
      store === "postgres" && Boolean(postgresAccountsConfig()));
}
function basePath(root = process.env.WAE_ACCOUNTS_DIR || ".wae-private-accounts") {
  if (!root || String(root).includes("\0")) fail("storage_config", "Directorio de cuentas inválido.", 503);
  return resolve(root);
}
function pathFor(base) { return join(base, "accounts.encrypted.json"); }
function validateDb(payload) {
  if (!payload || payload.version !== 1 || !Array.isArray(payload.users) || payload.users.length > MAX_USERS) {
    fail("database_corrupt", "Datos de cuentas inconsistentes.", 503);
  }
  const emails = new Set(), ids = new Set();
  for (const user of payload.users) {
    if (typeof user?.id !== "string" || typeof user.email !== "string" ||
      !Array.isArray(user.businesses) || !Array.isArray(user.sessions) ||
      user.businesses.length > MAX_BUSINESSES || user.sessions.length > MAX_SESSIONS ||
      ids.has(user.id) || emails.has(user.email)) {
      fail("database_corrupt", "Datos de cuentas inconsistentes.", 503);
    }
    ids.add(user.id); emails.add(user.email);
  }
  return payload;
}
function decodeDb(raw) {
  if (raw === null) return { version: 1, users: [] };
  let envelope;
  try { envelope = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : raw); }
  catch { fail("database_corrupt", "Formato del registro de cuentas inválido.", 503); }
  try { return validateDb(openVaultEnvelope("accounts", envelope, accountKey())); }
  catch (error) {
    if (error instanceof EncryptionError) fail("decrypt_failed", "No se pudo autenticar el registro de cuentas.", 503);
    throw error;
  }
}
async function readDb(base) {
  if (base === undefined && requiresDurableStorage() && !postgresAccountsSelected())
    fail("storage_config", "No se permite leer cuentas desde almacenamiento efímero.", 503);
  if (!accountKey()) fail("accounts_disabled", "Cuentas desactivadas.", 503);
  if (base === undefined && postgresAccountsSelected()) {
    if (!postgresAccountsConfig()) fail("storage_config", "PostgreSQL de cuentas no configurado.", 503);
    try { return decodeDb(await readAccountsPostgres()); }
    catch (error) {
      if (error instanceof AccountError) throw error;
      fail("storage_failure", "No se pudo abrir el registro de cuentas.", 503);
    }
  }
  const path = pathFor(base ?? basePath());
  let raw;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > MAX_BYTES) fail("database_corrupt", "Archivo de cuentas inválido.", 503);
    raw = await readFile(path);
  } catch (error) {
    if (error.code === "ENOENT") return { version: 1, users: [] };
    if (error instanceof AccountError) throw error;
    fail("storage_failure", "No se pudo abrir el registro de cuentas.", 503);
  }
  return decodeDb(raw);
}
async function writeDb(db, base) {
  const encrypted = sealVault("accounts", db, accountKey());
  const bytes = Buffer.from(JSON.stringify(encrypted), "utf8");
  if (bytes.length > MAX_BYTES) fail("database_full", "Capacidad de cuentas alcanzada.", 503);
  await mkdir(base, { recursive: true, mode: 0o700 });
  const path = pathFor(base), temporary = path + "." + randomUUID() + ".tmp";
  let handle = null;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path);
  } catch {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    fail("storage_failure", "No se pudo guardar el registro de cuentas.", 503);
  }
}
async function mutate(operation, base) {
  if (base === undefined && requiresDurableStorage() && !postgresAccountsSelected())
    fail("storage_config", "No se permiten escrituras en almacenamiento efímero.", 503);
  if (base === undefined && postgresAccountsSelected()) {
    if (!postgresAccountsConfig()) fail("storage_config", "PostgreSQL de cuentas no configurado.", 503);
    try {
      return await mutateAccountsPostgres(async envelope => {
        const db = decodeDb(envelope);
        const result = await operation(db);
        const encrypted = JSON.stringify(sealVault("accounts", db, accountKey()));
        if (Buffer.byteLength(encrypted) > MAX_BYTES)
          fail("database_full", "Capacidad de cuentas alcanzada.", 503);
        return { envelope: encrypted, result };
      });
    } catch (error) {
      if (error instanceof AccountError) throw error;
      fail("storage_failure", "No se pudo guardar el registro de cuentas.", 503);
    }
  }
  const directory = base ?? basePath();
  const next = pending.catch(() => {}).then(async () => {
    const db = await readDb(directory);
    const result = await operation(db);
    await writeDb(db, directory);
    return result;
  });
  pending = next;
  return next;
}
function nameValue(value, min, max, field) {
  if (typeof value !== "string" || value !== value.trim() || value.length < min ||
    value.length > max || /[\u0000-\u001f\u007f]/.test(value)) {
    fail("invalid_input", field + " no válido.");
  }
  return value;
}
function emailValue(value) {
  if (typeof value !== "string" || value.length > 254 || value !== value.trim()) {
    fail("invalid_input", "Correo electrónico no válido.");
  }
  const email = value.toLowerCase();
  if (!/^[^\s@]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(email)) fail("invalid_input", "Correo electrónico no válido.");
  return email;
}
function passwordValue(value) {
  if (typeof value !== "string" || value.length < 12 || value.length > 128 ||
    /[\u0000-\u001f\u007f]/.test(value)) {
    fail("invalid_input", "La contraseña debe contener entre 12 y 128 caracteres, sin caracteres de control.");
  }
  return value;
}
async function passwordDigest(password, salt) {
  return (await scrypt(password, Buffer.from(salt, "hex"), 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 })).toString("hex");
}
function publicUser(user) { return { id: user.id, name: user.name, email: user.email, createdAt: user.createdAt }; }
function sessionToken(user) {
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  user.sessions = user.sessions.filter(session => session.expires > now).slice(-MAX_SESSIONS + 1);
  user.sessions.push({ digest: hash(token), expires: now + SESSION_MS });
  return token;
}
export function sessionDigest(header) {
  if (typeof header !== "string" || !/^Bearer [A-Za-z0-9_-]{43}$/.test(header)) return null;
  return hash(header.slice(7));
}
function userWithSession(db, header) {
  const tokenHash = sessionDigest(header);
  if (!tokenHash) fail("not_authenticated", "Inicia sesión para continuar.", 401);
  const now = Date.now();
  for (const user of db.users) {
    for (const session of user.sessions) {
      if (session.expires > now && timingSafeEqual(Buffer.from(session.digest, "hex"), Buffer.from(tokenHash, "hex"))) {
        return user;
      }
    }
  }
  fail("not_authenticated", "Sesión vencida o inválida.", 401);
}
export async function registerAccount(data, base) {
  if (!accountsEnabled()) fail("accounts_disabled", "Registro no habilitado.", 503);
  const name = nameValue(data?.name, 2, 100, "Nombre");
  const email = emailValue(data?.email);
  const password = passwordValue(data?.password);
  const salt = randomBytes(16).toString("hex");
  const passwordHash = await passwordDigest(password, salt);
  return mutate(db => {
    if (db.users.some(user => user.email === email)) fail("email_registered", "El correo ya está registrado.", 409);
    if (db.users.length >= MAX_USERS) fail("registration_full", "No hay capacidad para más cuentas.", 503);
    const user = { id: randomUUID(), name, email, salt, passwordHash,
      createdAt: new Date().toISOString(), sessions: [], businesses: [] };
    const token = sessionToken(user);
    db.users.push(user);
    return { user: publicUser(user), token, expiresIn: SESSION_MS / 1000 };
  }, base);
}
export async function loginAccount(data, base) {
  if (!accountsEnabled()) fail("accounts_disabled", "Registro no habilitado.", 503);
  const email = emailValue(data?.email);
  const password = passwordValue(data?.password);
  const db = await readDb(base);
  const user = db.users.find(entry => entry.email === email);
  const salt = user?.salt || "00".repeat(16);
  const calculated = await passwordDigest(password, salt);
  if (!user || !timingSafeEqual(Buffer.from(calculated, "hex"), Buffer.from(user.passwordHash, "hex"))) {
    fail("invalid_credentials", "Correo o contraseña incorrectos.", 401);
  }
  return mutate(state => {
    const current = state.users.find(entry => entry.id === user.id);
    if (!current) fail("invalid_credentials", "Correo o contraseña incorrectos.", 401);
    const token = sessionToken(current);
    return { user: publicUser(current), token, expiresIn: SESSION_MS / 1000 };
  }, base);
}
export async function getAccount(header, base) {
  if (!accountsEnabled()) fail("accounts_disabled", "Cuentas desactivadas.", 503);
  const db = await readDb(base);
  return publicUser(userWithSession(db, header));
}
export async function logoutAccount(header, base) {
  if (!accountsEnabled()) fail("accounts_disabled", "Cuentas desactivadas.", 503);
  return mutate(db => {
    const user = userWithSession(db, header);
    const target = sessionDigest(header);
    user.sessions = user.sessions.filter(session => session.digest !== target);
    return { ok: true };
  }, base);
}
function businessValue(data) {
  const website = typeof data?.website === "string" ? data.website.trim() : "";
  // Optional public business contact. Require explicit international E.164 consent.
  const whatsapp = typeof data?.whatsapp === "string" ? data.whatsapp.trim() : "";
  if (whatsapp && !/^\+[1-9]\d{7,14}$/.test(whatsapp))
    fail("invalid_whatsapp","Usa el prefijo internacional, por ejemplo +5213312345678.");
  let safeWebsite = null;
  if (website) {
    try {
      const url = new URL(website);
      if (url.protocol !== "https:" || url.username || url.password || url.href.length > 320) throw Error();
      safeWebsite = url.href;
    } catch { fail("invalid_website", "El sitio web debe ser una URL HTTPS válida."); }
  }
  return {
    name: nameValue(data?.name, 2, 130, "Nombre del negocio"),
    category: nameValue(data?.category, 2, 80, "Sector"),
    city: nameValue(data?.city, 2, 100, "Ciudad"),
    description: data?.description ? nameValue(data.description, 2, 800, "Descripción") : "",
    website: safeWebsite,
    whatsapp: whatsapp || null
  };
}
export async function listBusinesses(header, base) {
  if (!accountsEnabled()) fail("accounts_disabled", "Cuentas desactivadas.", 503);
  const db = await readDb(base);
  const user = userWithSession(db, header);
  return { businesses: user.businesses, visibility: "owner_only", verification: "self_declared" };
}
export async function addBusiness(header, data, base) {
  if (!accountsEnabled()) fail("accounts_disabled", "Cuentas desactivadas.", 503);
  const values = businessValue(data);
  return mutate(db => {
    const user = userWithSession(db, header);
    if (user.businesses.length >= MAX_BUSINESSES) fail("business_limit", "Límite de 20 negocios por cuenta.", 409);
    const business = { id: randomUUID(), ...values, status: "self_declared",
      visibility: data.publish === true ? "public" : "owner_only",
      createdAt: new Date().toISOString() };
    user.businesses.push(business);
    return business;
  }, base);
}
export async function updateBusiness(header, id, data, base) {
  if (!accountsEnabled()) fail("accounts_disabled", "Cuentas desactivadas.", 503);
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) fail("invalid_business", "Negocio no válido.");
  const values = businessValue(data);
  return mutate(db => {
    const user = userWithSession(db, header);
    const business = user.businesses.find(item => item.id === id);
    if (!business) fail("business_missing", "Negocio no encontrado en tu cuenta.", 404);
    Object.assign(business, values, { updatedAt: new Date().toISOString() });
    // Editing text must never implicitly publish or unpublish a business.
    return business;
  }, base);
}
export async function deleteBusiness(header, id, base) {
  if (!accountsEnabled()) fail("accounts_disabled", "Cuentas desactivadas.", 503);
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) fail("invalid_business", "Negocio no válido.");
  return mutate(db => {
    const user = userWithSession(db, header);
    const old = user.businesses.length;
    user.businesses = user.businesses.filter(item => item.id !== id);
    if (user.businesses.length === old) fail("business_missing", "Negocio no encontrado en tu cuenta.", 404);
    return { ok: true };
  }, base);
}

export async function updateBusinessVisibility(header, id, published, base) {
  if (!accountsEnabled()) fail("accounts_disabled", "Cuentas desactivadas.", 503);
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id) || typeof published !== "boolean") {
    fail("invalid_business", "La visibilidad del negocio debe ser un valor booleano.");
  }
  return mutate(db => {
    const user = userWithSession(db, header);
    const business = user.businesses.find(item => item.id === id);
    if (!business) fail("business_missing", "Negocio no encontrado en tu cuenta.", 404);
    business.visibility = published ? "public" : "owner_only";
    return business;
  }, base);
}
const promotionLive = (item, now = Date.now()) =>
  Boolean(billingConfig()) && item.visibility === "public" && item.promotion?.status === "active" &&
  typeof item.promotion.currentPeriodEnd === "number" && item.promotion.currentPeriodEnd > now;
export function promotionalStatus(item, now = Date.now()) {
  const promotion = item?.promotion;
  return {
    plan: promotionLive(item, now) ? "promocionar" : "gratis",
    state: promotionLive(item, now) ? "active" : promotion?.status === "active" ? "inactive" : promotion?.status || "free",
    paidThrough: promotion?.currentPeriodEnd || null
  };
}
export async function reserveCheckout(header, businessId, base) {
  if (!accountsEnabled()) fail("accounts_disabled", "Cuentas desactivadas.", 503);
  if (!/^[a-f0-9-]{36}$/i.test(businessId || "")) fail("invalid_business", "Negocio no válido.");
  return mutate(db => {
    const user = userWithSession(db, header);
    const business = user.businesses.find(item => item.id === businessId);
    if (!business) fail("business_missing", "Negocio no encontrado.", 404);
    if (business.visibility !== "public") fail("business_private", "Publica voluntariamente tu negocio antes de promocionarlo.", 409);
    if (promotionLive(business)) fail("already_promoted", "Este negocio ya tiene un plan activo.", 409);
    const last = business.promotion?.pending;
    if (last && Date.now() - last.createdAt < 20 * 60_000) {
      fail("checkout_pending", "Ya existe una contratación reciente. Comprueba Stripe antes de iniciar otra.", 409);
    }
    const attemptId = randomUUID();
    business.promotion = { ...business.promotion, pending: { attemptId, createdAt: Date.now() } };
    return { accountId: user.id, businessId, attemptId, email: user.email };
  }, base);
}
export async function bindCheckout(attempt, sessionId, base) {
  if (!/^cs_(test_|live_)[A-Za-z0-9_]+$/.test(sessionId || "")) fail("invalid_checkout", "Referencia de compra inválida.");
  return mutate(db => {
    const user = db.users.find(item => item.id === attempt.accountId);
    const business = user?.businesses.find(item => item.id === attempt.businessId);
    if (!business || business.promotion?.pending?.attemptId !== attempt.attemptId) {
      fail("checkout_changed", "Contratación pendiente ya no válida.", 409);
    }
    business.promotion.pending.sessionId = sessionId;
    return { ok: true };
  }, base);
}
export async function clearCheckout(attempt, base) {
  return mutate(db => {
    const business = db.users.find(item => item.id === attempt.accountId)
      ?.businesses.find(item => item.id === attempt.businessId);
    if (business?.promotion?.pending?.attemptId === attempt.attemptId &&
      !business.promotion.pending.sessionId) delete business.promotion.pending;
    return { ok: true };
  }, base);
}
export async function acceptPaidCheckout(event, subscription, config, base) {
  const session = event.data.object;
  if (event.type !== "checkout.session.completed" ||
    session.mode !== "subscription" || session.status !== "complete" ||
    session.payment_status !== "paid" || Boolean(session.livemode) !== config.live ||
    !/^cs_(test_|live_)/.test(session.id || "") ||
    typeof session.subscription !== "string") return { applied: false };
  const period = paidPeriod(subscription, config);
  if (!period || session.subscription !== subscription.id) return { applied: false };
  return mutate(db => {
    const pending = db.users.flatMap(user => user.businesses.map(business => ({ user, business })))
      .find(({ user, business }) => user.id === session.metadata?.account_id &&
        business.id === session.metadata?.business_id &&
        business.promotion?.pending?.attemptId === session.metadata?.attempt_id &&
        business.promotion.pending.sessionId === session.id);
    if (!pending || !subscriptionMatchesAttempt(subscription, {
      accountId: pending.user.id, businessId: pending.business.id,
      attemptId: pending.business.promotion.pending.attemptId
    })) return { applied: false };
    const { business } = pending;
    if (business.promotion.subscriptionId && business.promotion.subscriptionId !== subscription.id &&
      promotionLive(business)) return { applied: false };
    if (business.visibility !== "public") return { applied: false };
    business.promotion = {
      subscriptionId: subscription.id, attemptId: pending.business.promotion.pending.attemptId,
      status: "active", currentPeriodEnd: period.currentPeriodEnd, lastEventCreated: event.created,
      lastEventId: event.id
    };
    return { applied: true };
  }, base);
}
export async function updatePaidSubscription(event, subscription, config, base) {
  const id = subscription?.id;
  if (typeof id !== "string" || !/^sub_[A-Za-z0-9_]{4,}$/.test(id)) return { applied: false };
  const period = event.type === "invoice.payment_failed" || event.type === "customer.subscription.deleted"
    ? null : paidPeriod(subscription, config);
  return mutate(db => {
    const match = db.users.flatMap(user => user.businesses.map(business => ({ user, business })))
      .find(({ business }) => business.promotion?.subscriptionId === id);
    if (!match || !subscriptionMatchesAttempt(subscription, {
      accountId: match.user.id, businessId: match.business.id,
      attemptId: subscription.metadata?.attempt_id
    })) return { applied: false };
    const promo = match.business.promotion;
    if (event.created < (promo.lastEventCreated || 0) ||
      event.id === promo.lastEventId) return { applied: false };
    promo.status = period ? "active" : "inactive";
    promo.currentPeriodEnd = period?.currentPeriodEnd || null;
    promo.lastEventCreated = event.created;
    promo.lastEventId = event.id;
    return { applied: true };
  }, base);
}
export async function getPromotionStatus(header, businessId, base) {
  if (!accountsEnabled()) fail("accounts_disabled", "Cuentas desactivadas.", 503);
  const db = await readDb(base);
  const user = userWithSession(db, header);
  const business = user.businesses.find(item => item.id === businessId);
  if (!business) fail("business_missing", "Negocio no encontrado.", 404);
  return promotionalStatus(business);
}
function publicBusiness(item) {
  return {
    id: item.id, name: item.name, category: item.category, city: item.city,
    description: item.description, website: item.website,
    whatsapp: item.whatsapp || null,
    verification: "self_declared"
  };
}
export async function getPublicBusiness(id, base) {
  if (!accountsEnabled()) fail("accounts_disabled", "Cuentas desactivadas.", 503);
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) fail("business_missing", "Ficha pública no disponible.", 404);
  const db = await readDb(base);
  const business = db.users.flatMap(user => user.businesses)
    .find(item => item.id === id && item.visibility === "public");
  if (!business) fail("business_missing", "Ficha pública no disponible.", 404);
  return { business: publicBusiness(business),
    disclaimer: "Negocio publicado voluntariamente. WAE WEB no verifica la identidad, titularidad ni información comercial." };
}
export async function listPublicBusinesses(query = "", base) {
  if (!accountsEnabled()) fail("accounts_disabled", "Cuentas desactivadas.", 503);
  if (typeof query !== "string" || query.length > 100) fail("invalid_query", "Consulta de negocio demasiado larga.");
  const fold = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const terms = [...new Set(fold(query).match(/[\p{L}\p{N}]{2,}/gu) || [])].slice(0, 12);
  const db = await readDb(base);
  const matching = db.users.flatMap(user => user.businesses)
    .filter(item => item.visibility === "public")
    .map(item => {
      const title = fold(item.name), sector = fold(item.category), city = fold(item.city);
      const description = fold(item.description);
      if (!terms.every(term => [title, sector, city, description].some(field => field.includes(term)))) return null;
      const score = terms.reduce((sum, term) =>
        sum + (title.includes(term) ? 5 : 0) + (sector.includes(term) ? 3 : 0) +
          (city.includes(term) ? 2 : 0) + (description.includes(term) ? 1 : 0), 0);
      return { item, score };
    }).filter(Boolean)
    .sort((a, b) => b.score - a.score || b.item.createdAt.localeCompare(a.item.createdAt));
  const eligible = matching.slice(0, 100);
  const promoted = eligible.filter(({ item }) => promotionLive(item))
    .slice(0, 3).map(({ item }) => ({ ...publicBusiness(item), sponsored: true, label: "Patrocinado" }));
  const promotedIds = new Set(promoted.map(item => item.id));
  const organic = eligible.filter(({ item }) => !promotedIds.has(item.id))
    .slice(0, 25).map(({ item }) => publicBusiness(item));
  return {
    sponsored: promoted, businesses: organic,
    resultCount: organic.length, limitedTo: 25,
    disclaimer: "Patrocinados son publicidad de pago, no verificación comercial. El orden orgánico es independiente."
  };
}

function ownedBusiness(db, header, businessId) {
  if (!validMarketId(businessId)) fail("business_missing","Negocio no encontrado.",404);
  const user = userWithSession(db,header);
  const business = user.businesses.find(item => item.id === businessId);
  if (!business) fail("business_missing","Negocio no encontrado.",404);
  return business;
}
function listingLimit(base) {
  return base === undefined && postgresAccountsSelected() && Boolean(mediaConfig())
    ? MAX_OBJECT_LISTINGS : MAX_LISTINGS;
}
export async function listOwnerListings(header, businessId, base) {
  if (!accountsEnabled()) fail("accounts_disabled","Cuentas desactivadas.",503);
  const db = await readDb(base);
  return { items: ownedBusiness(db,header,businessId).listings || [], limit:listingLimit(base) };
}
export async function addMarketListing(header, businessId, input, base) {
  if (!accountsEnabled()) fail("accounts_disabled","Cuentas desactivadas.",503);
  if (mediaSelected() && input?.imageDataUrl) throw new MarketMediaError("media_endpoint_required",422);
  const listing = createListing(input);
  return mutate(db => {
    const business = ownedBusiness(db,header,businessId);
    business.listings ||= [];
    if (business.listings.length >= listingLimit(base))
      throw new MarketplaceError("listing_limit","Límite de publicaciones por negocio.",409);
    business.listings.push(listing);
    return listing;
  },base);
}
export async function editMarketListing(header, businessId, listingId, input, base) {
  if (!accountsEnabled()) fail("accounts_disabled","Cuentas desactivadas.",503);
  if (!validMarketId(listingId)) fail("listing_missing","Publicación no encontrada.",404);
  if (mediaSelected() && input?.imageDataUrl) throw new MarketMediaError("media_endpoint_required",422);
  return mutate(db => {
    const business = ownedBusiness(db,header,businessId);
    const listing = business.listings?.find(item=>item.id===listingId);
    if (!listing) fail("listing_missing","Publicación no encontrada.",404);
    Object.assign(listing,validateListing(input,listing),{updatedAt:new Date().toISOString()});
    return listing;
  },base);
}
export async function setMarketListingVisibility(header, businessId, listingId, published, base) {
  if (!accountsEnabled()) fail("accounts_disabled","Cuentas desactivadas.",503);
  if (!validMarketId(listingId)) fail("listing_missing","Publicación no encontrada.",404);
  if (typeof published !== "boolean")
    fail("invalid_visibility","La publicación debe ser pública o privada.");
  return mutate(db => {
    const business=ownedBusiness(db,header,businessId);
    const listing=business.listings?.find(item=>item.id===listingId);
    if (!listing) fail("listing_missing","Publicación no encontrada.",404);
    // Publishing requires a separate, explicit owner decision. Business must be public.
    if (published && business.visibility !== "public")
      fail("business_private","Publica primero el perfil de tu empresa.",409);
    if (published && listing.moderation === "blocked")
      fail("listing_blocked", "Esta publicación requiere revisión antes de volver a publicarse.", 409);
    listing.visibility=published?"public":"owner_only";
    listing.updatedAt=new Date().toISOString();
    return listing;
  },base);
}
export async function deleteMarketListing(header,businessId,listingId,base) {
  if (!accountsEnabled()) fail("accounts_disabled","Cuentas desactivadas.",503);
  if (!validMarketId(listingId)) fail("listing_missing","Publicación no encontrada.",404);
  return mutate(db=>{
    const business=ownedBusiness(db,header,businessId);
    const before=business.listings?.length||0;
    business.listings=(business.listings||[]).filter(item=>item.id!==listingId);
    if (business.listings.length===before) fail("listing_missing","Publicación no encontrada.",404);
    return {ok:true};
  },base);
}
export async function getPublicMarketCatalog(businessId,base) {
  if (!accountsEnabled()) fail("accounts_disabled","Cuentas desactivadas.",503);
  if (!validMarketId(businessId)) fail("business_missing","Negocio no encontrado.",404);
  const db=await readDb(base);
  const business=db.users.flatMap(user=>user.businesses)
    .find(item=>item.id===businessId && item.visibility==="public");
  if (!business) fail("business_missing","Negocio no publicado.",404);
  return { items: publicCatalog(business),
    disclaimer:"Catálogo autodeclarado; precios y disponibilidad sujetos a confirmación con la empresa." };
}
export async function browseMarketplace(filters={},base) {
  if (!accountsEnabled()) fail("accounts_disabled","Cuentas desactivadas.",503);
  const db=await readDb(base);
  return searchMarketplace(db.users,filters);
}

const DAY_MS = 24 * 60 * 60 * 1000;
function publicForContact(db, businessId, listingId) {
  if (!validId(businessId) || !validId(listingId))
    fail("listing_missing", "Publicación no encontrada.", 404);
  for (const owner of db.users) {
    const business = owner.businesses.find(item => item.id === businessId);
    if (!business || business.visibility !== "public") continue;
    const listing = (business.listings || []).find(item =>
      item.id === listingId && item.visibility === "public");
    if (listing) return { owner, business, listing };
  }
  fail("listing_missing", "Publicación no encontrada.", 404);
}
export async function sendMarketInquiry(header, businessId, listingId, input, base) {
  if (!accountsEnabled()) fail("accounts_disabled", "Cuentas desactivadas.", 503);
  const message = validateInquiry(input);
  return mutate(db => {
    const buyer = userWithSession(db, header);
    const { owner, business, listing } = publicForContact(db, businessId, listingId);
    if (owner.id === buyer.id) fail("self_inquiry", "No puedes consultar tu propia publicación.", 409);
    business.inquiries ||= [];
    if (business.inquiries.length >= 40)
      fail("inquiry_capacity", "Este negocio alcanzó su capacidad de consultas.", 503);
    const now = Date.now();
    if (business.inquiries.some(item => item.buyerId === buyer.id &&
        item.listingId === listing.id && now - Date.parse(item.createdAt) < DAY_MS))
      fail("inquiry_duplicate", "Ya enviaste una consulta para este artículo durante las últimas 24 horas.", 409);
    business.inquiries.push(newInquiry({ buyer, listing, message, now }));
    return publicInquiryReceipt();
  }, base);
}
export async function getMarketInquiries(header, businessId, base) {
  if (!accountsEnabled()) fail("accounts_disabled", "Cuentas desactivadas.", 503);
  const db = await readDb(base);
  const business = ownedBusiness(db, header, businessId);
  return { items: business.inquiries || [], limit: 40 };
}
export async function reportMarketListing(header, businessId, listingId, input, base) {
  if (!accountsEnabled()) fail("accounts_disabled", "Cuentas desactivadas.", 503);
  const reason = validateReport(input);
  return mutate(db => {
    const reporter = userWithSession(db, header);
    const { owner } = publicForContact(db, businessId, listingId);
    if (owner.id === reporter.id) fail("self_report", "No puedes reportar tu propia publicación.", 409);
    db.marketReports ||= [];
    if (db.marketReports.length >= 500)
      fail("report_capacity", "La recepción de reportes está temporalmente limitada.", 503);
    const now = Date.now();
    if (db.marketReports.some(item => item.reporterId === reporter.id &&
      item.businessId === businessId && item.listingId === listingId &&
      now - Date.parse(item.createdAt) < 30 * DAY_MS))
      fail("report_duplicate", "Este reporte ya fue recibido.", 409);
    if (db.marketReports.filter(item => item.reporterId === reporter.id &&
      now - Date.parse(item.createdAt) < DAY_MS).length >= 5)
      fail("report_rate", "Límite diario de reportes alcanzado.", 429);
    db.marketReports.push(newReport({
      reporterId: reporter.id, businessId, listingId, reason, now
    }));
    // Reports only queue for manual review. Never auto-unpublish on allegations.
    return { received: true, status: "pending_review" };
  }, base);
}

function requireMarketModerator() {
  if (process.env.WAE_MARKET_MODERATOR_ACK !== "manual-review-authorized")
    fail("moderator_not_authorized", "Revisión operativa no autorizada.", 403);
}
export async function listMarketReports(base) {
  requireMarketModerator();
  if (!accountsEnabled()) fail("accounts_disabled", "Cuentas desactivadas.", 503);
  const db=await readDb(base);
  // No reporter names, emails, or bearer credentials in operator output.
  return { scope:"operator_only", releaseApproval:"not_evaluated",
    cases:(db.marketReports||[]).filter(report=>report.status==="pending_review")
      .map(report=>({id:report.id,businessId:report.businessId,
        listingId:report.listingId,reason:report.reason,createdAt:report.createdAt})) };
}
export async function reviewMarketReport(reportId, decision, { manualConfirmed = false, base } = {}) {
  requireMarketModerator();
  if (!accountsEnabled()) fail("accounts_disabled", "Cuentas desactivadas.", 503);
  if (!validId(reportId) || !["dismiss","hide"].includes(decision) || manualConfirmed !== true)
    fail("moderator_confirmation", "Requiere un expediente y confirmación manual.", 422);
  return mutate(db=>{
    const report=(db.marketReports||[]).find(item=>item.id===reportId);
    if(!report || report.status!=="pending_review")
      fail("report_missing", "Reporte pendiente no encontrado.", 404);
    const business=db.users.flatMap(user=>user.businesses)
      .find(item=>item.id===report.businessId);
    const listing=business?.listings?.find(item=>item.id===report.listingId);
    if(decision==="hide") {
      if(!listing)fail("listing_missing","La publicación ya no existe.",404);
      listing.visibility="owner_only";
      listing.moderation="blocked";
      listing.updatedAt=new Date().toISOString();
    }
    report.status=decision==="hide"?"actioned":"dismissed";
    report.reviewedAt=new Date().toISOString();
    return { reviewed:true,decision,listingHidden:decision==="hide" };
  },base);
}

function objectMedia(media, base) {
  if (!media) throw new MarketMediaError("media_unavailable",503);
  // Hosted uploads require durable encrypted records. Explicit file bases are for
  // isolated tests only and must never enable media on production ephemeral disks.
  if (base === undefined && !postgresAccountsSelected())
    fail("media_requires_postgres","Las fotografías requieren PostgreSQL persistente.",503);
  if (base !== undefined && process.env.NODE_ENV !== "test")
    fail("media_requires_postgres","La carga de fotografías no admite modo local productivo.",503);
}
function checkedImageKey(businessId, listingId, listing) {
  const key=listing?.imageKey;
  const prefix="marketplace/"+businessId.toLowerCase()+"/"+listingId.toLowerCase()+"/";
  if (typeof key !== "string" || !key.startsWith(prefix) || listing.imageType!=="image/jpeg")
    throw new MarketMediaError("media_not_found",404);
  return key;
}
export async function uploadMarketPhoto(header, businessId, listingId, data, base,
    { media = mediaConfig(), transport = fetch } = {}) {
  if (!accountsEnabled()) fail("accounts_disabled","Cuentas desactivadas.",503);
  objectMedia(media,base);
  if (!validMarketId(businessId) || !validMarketId(listingId))
    fail("listing_missing","Publicación no encontrada.",404);
  // Do not send bytes to a provider before validating auth and ownership.
  const current=await readDb(base);
  const owned=ownedBusiness(current,header,businessId);
  if (!owned.listings?.some(item=>item.id===listingId))
    fail("listing_missing","Publicación no encontrada.",404);
  const bytes=decodeMarketPhoto(data?.imageDataUrl);
  const key=makeMediaKey(businessId,listingId);
  await putMarketImage(media,key,bytes,transport);
  let previousKey;
  let item;
  try {
    item=await mutate(db=>{
      const business=ownedBusiness(db,header,businessId);
      const listing=business.listings?.find(entry=>entry.id===listingId);
      if (!listing) fail("listing_missing","Publicación no encontrada.",404);
      previousKey=listing.imageKey;
      // The object has been uploaded before committing its reference.
      Object.assign(listing,{imageKey:key,imageType:"image/jpeg",imageDataUrl:null,
        updatedAt:new Date().toISOString()});
      return listing;
    },base);
  } catch(error) {
    await deleteMarketImage(media,key,transport).catch(()=>{});
    throw error;
  }
  // Deletion happens only after the new key is durably committed. An object
  // may remain orphaned if cleanup fails; it must never revoke the new image.
  if (previousKey && previousKey !== key)
    await deleteMarketImage(media,previousKey,transport).catch(()=>{});
  return { uploaded:true, item:{...item,
    imageUrl:ownerImageUrl(businessId,listingId)} };
}
export async function getMarketPhotoLink(header, businessId, listingId, base,
    { media=mediaConfig(), now=Date.now() } = {}) {
  if (!accountsEnabled()) fail("accounts_disabled","Cuentas desactivadas.",503);
  objectMedia(media,base);
  const db=await readDb(base);
  const business=ownedBusiness(db,header,businessId);
  const listing=business.listings?.find(item=>item.id===listingId);
  if (!listing) fail("listing_missing","Publicación no encontrada.",404);
  return { url:presignedMarketImage(media,checkedImageKey(businessId,listingId,listing),now),
    expiresIn:120 };
}
export async function getPublicMarketPhotoLink(businessId, listingId, base,
    { media=mediaConfig(), now=Date.now() } = {}) {
  if (!accountsEnabled()) fail("accounts_disabled","Cuentas desactivadas.",503);
  objectMedia(media,base);
  const db=await readDb(base);
  if (!validMarketId(businessId) || !validMarketId(listingId))
    fail("listing_missing","Publicación no encontrada.",404);
  const business=db.users.flatMap(user=>user.businesses)
    .find(item=>item.id===businessId && item.visibility==="public");
  const listing=business?.listings?.find(item=>
    item.id===listingId && item.visibility==="public" && item.moderation!=="blocked");
  if (!listing) fail("listing_missing","Publicación no encontrada.",404);
  return { url:presignedMarketImage(media,checkedImageKey(businessId,listingId,listing),now),
    expiresIn:120 };
}
export async function removeMarketPhoto(header,businessId,listingId,base,
    { media=mediaConfig(),transport=fetch } = {}) {
  if (!accountsEnabled())fail("accounts_disabled","Cuentas desactivadas.",503);
  if (!validMarketId(businessId) || !validMarketId(listingId))
    fail("listing_missing","Publicación no encontrada.",404);
  // Removing inline legacy photos remains possible without an S3 provider.
  let oldKey;
  const item=await mutate(db=>{
    const business=ownedBusiness(db,header,businessId);
    const listing=business.listings?.find(entry=>entry.id===listingId);
    if (!listing)fail("listing_missing","Publicación no encontrada.",404);
    if (listing.imageKey && !media)
      throw new MarketMediaError("media_unavailable",503);
    oldKey=listing.imageKey;
    listing.imageKey=null;listing.imageType=null;listing.imageDataUrl=null;
    listing.updatedAt=new Date().toISOString();
    return listing;
  },base);
  if (oldKey && media)
    await deleteMarketImage(media,oldKey,transport).catch(()=>{});
  return { removed:true, item };
}
