import { randomBytes, randomUUID, createHash, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { mkdir, lstat, readFile, open, rename, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { sealVault, openVaultEnvelope, EncryptionError } from "./crypto.mjs";

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
  return process.env.WAE_ACCOUNTS_ENABLED === "true" && Boolean(accountKey());
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
async function readDb(base = basePath()) {
  if (!accountKey()) fail("accounts_disabled", "Cuentas desactivadas.", 503);
  const path = pathFor(base);
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
  let envelope;
  try { envelope = JSON.parse(raw.toString("utf8")); }
  catch { fail("database_corrupt", "Formato del registro de cuentas inválido.", 503); }
  try { return validateDb(openVaultEnvelope("accounts", envelope, accountKey())); }
  catch (error) {
    if (error instanceof EncryptionError) fail("decrypt_failed", "No se pudo autenticar el registro de cuentas.", 503);
    throw error;
  }
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
async function mutate(operation, base = basePath()) {
  const next = pending.catch(() => {}).then(async () => {
    const db = await readDb(base);
    const result = await operation(db);
    await writeDb(db, base);
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
  const db = await readDb(base || basePath());
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
  const db = await readDb(base || basePath());
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
    website: safeWebsite
  };
}
export async function listBusinesses(header, base) {
  if (!accountsEnabled()) fail("accounts_disabled", "Cuentas desactivadas.", 503);
  const db = await readDb(base || basePath());
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
      visibility: "owner_only", createdAt: new Date().toISOString() };
    user.businesses.push(business);
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
