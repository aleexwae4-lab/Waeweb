import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { search, weather } from "./search.mjs";
import { readPage, searchIndex, getIndexedDocument, ReaderError } from "./reader.mjs";
import { vaultConfig, authenticateVault, loadVault, storeDocument, VaultError } from "./vault.mjs";
import { encryptionReady, vaultKeysConfig } from "./crypto.mjs";
import { accountsEnabled, AccountError, registerAccount, loginAccount, logoutAccount, getAccount, listBusinesses, addBusiness, deleteBusiness } from "./accounts.mjs";

const root = fileURLToPath(new URL("../public/", import.meta.url));
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/accounts.js", ["accounts.js", "text/javascript; charset=utf-8"]],
  ["/workspace.js", ["workspace.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml"]],
  ["/robots.txt", ["robots.txt", "text/plain; charset=utf-8"]]
]);
const rate = new Map();
const accountRate = new Map();
function accountLimited(req, action) {
  const ip = req.socket.remoteAddress || "unknown";
  const key = action + ":" + ip;
  const now = Date.now();
  const previous = accountRate.get(key);
  const windowMs = 15 * 60_000;
  const limit = action === "register" ? 5 : 12;
  if (!previous || previous.until < now) {
    if (accountRate.size > 10000) accountRate.clear();
    accountRate.set(key, { count: 1, until: now + windowMs });
    return false;
  }
  previous.count++;
  return previous.count > limit;
}
async function jsonBody(req, maxBytes = 3000) {
  let size = 0, chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw new AccountError("body_too_large", "Solicitud demasiado grande.", 413);
    chunks.push(chunk);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error("not object");
    return parsed;
  } catch { throw new AccountError("invalid_json", "JSON inválido.", 400); }
}
const security = {
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(self), geolocation=()"
};
function write(res, code, object, headers = {}) {
  res.writeHead(code, { ...security, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers });
  res.end(JSON.stringify(object));
}
function limited(req) {
  const key = process.env.TRUST_PROXY === "true"
    ? (req.headers["x-forwarded-for"] || "").split(",")[0].trim() || req.socket.remoteAddress
    : req.socket.remoteAddress || "unknown";
  const now = Date.now();
  const entry = rate.get(key);
  if (!entry || now > entry.until) {
    if (rate.size > 10000) rate.clear();
    rate.set(key, { count: 1, until: now + 60000 });
    return false;
  }
  entry.count++;
  return entry.count > 60;
}
export async function handler(req, res) {
  if (!["GET", "HEAD", "POST", "DELETE"].includes(req.method)) return write(res, 405, { error: "Método no permitido." }, { allow: "GET, HEAD, POST, DELETE" });
  let u;
  try { u = new URL(req.url, "http://localhost"); }
  catch { return write(res, 400, { error: "URL inválida." }); }
  if (u.pathname === "/api/health") return write(res, 200, { status: "ok", product: "WAE WEB", version: "0.6.0" });
  if (u.pathname === "/api/capabilities") return write(res, 200, {
    providers: ["Wikipedia", "Crossref", "OpenAlex", "Open Library", "Wikimedia Commons", "Open-Meteo"],
    googleSearchConfigured: Boolean(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID),
    researchBrief: "extractive", queryOperators: ["site:", "after:", "before:", "source:", "-term", "\"phrase\""],
    localResearchLibrary: true,
    readerEnabled: process.env.WAE_READER_ENABLED === "true" && encryptionReady(vaultConfig(), vaultKeysConfig()),
    vaultRequired: true,
    indexPersistence: "encrypted_local_disk_per_vault",
    encryption: "AES-256-GCM",
    accountsEnabled: accountsEnabled(),
    businessRegistration: accountsEnabled() ? "owner_only_self_declared" : "disabled",
    deploymentConnected: false
  });
  const accountRoutes = new Set(["/api/account/register", "/api/account/login", "/api/account/logout", "/api/account/me", "/api/businesses"]);
  const businessDelete = /^\/api\/businesses\/[0-9a-f-]{36}$/i.test(u.pathname);
  if (req.method === "POST" && u.pathname !== "/api/read" && !accountRoutes.has(u.pathname))
    return write(res, 405, { error: "Método no permitido." }, { allow: "GET, HEAD" });
  if (req.method === "DELETE" && !businessDelete)
    return write(res, 405, { error: "Método no permitido." }, { allow: "GET, HEAD" });
  if (u.pathname.startsWith("/api/")) {
    if (limited(req)) return write(res, 429, { error: "Demasiadas consultas. Intenta de nuevo en un minuto." }, { "retry-after": "60" });
    try {
      if (accountRoutes.has(u.pathname) || businessDelete) {
        if (!accountsEnabled()) return write(res, 503, { error: "Cuentas desactivadas. Configura WAE_ACCOUNTS_ENABLED y WAE_ACCOUNTS_KEY en el servidor." });
        if (req.method === "POST" && (u.pathname === "/api/account/register" || u.pathname === "/api/account/login")) {
          const action = u.pathname.endsWith("register") ? "register" : "login";
          if (accountLimited(req, action)) return write(res, 429, { error: "Demasiados intentos. Prueba más tarde." }, { "retry-after": "900" });
          const body = await jsonBody(req);
          const result = action === "register" ? await registerAccount(body) : await loginAccount(body);
          return write(res, action === "register" ? 201 : 200, result);
        }
        if (req.method === "GET" && u.pathname === "/api/account/me") {
          return write(res, 200, { user: await getAccount(req.headers.authorization) });
        }
        if (req.method === "POST" && u.pathname === "/api/account/logout") {
          return write(res, 200, await logoutAccount(req.headers.authorization));
        }
        if (u.pathname === "/api/businesses" && req.method === "GET") {
          return write(res, 200, await listBusinesses(req.headers.authorization));
        }
        if (u.pathname === "/api/businesses" && req.method === "POST") {
          const body = await jsonBody(req);
          return write(res, 201, { business: await addBusiness(req.headers.authorization, body) });
        }
        if (businessDelete && req.method === "DELETE") {
          return write(res, 200, await deleteBusiness(req.headers.authorization, u.pathname.slice("/api/businesses/".length)));
        }
        return write(res, 405, { error: "Método no permitido." }, { allow: "GET, POST, DELETE" });
      }
      if (u.pathname === "/api/index/search" || u.pathname === "/api/index/document" || u.pathname === "/api/read") {
        if (process.env.WAE_READER_ENABLED !== "true" || !encryptionReady(vaultConfig(), vaultKeysConfig())) {
          return write(res, 503, { error: "Bóvedas no configuradas o lector desactivado." });
        }
        const vault = authenticateVault(req.headers.authorization);
        if (!vault) return write(res, 401, { error: "Credencial de investigación ausente o incorrecta." },
          { "www-authenticate": "Bearer realm=\"WAE WEB Vault\"" });
        if (u.pathname === "/api/read") {
          if (req.method !== "POST") return write(res, 405, { error: "Utiliza POST para leer una página." }, { allow: "POST" });
          let raw = "";
          try {
            for await (const chunk of req) {
              raw += chunk.toString("utf8");
              if (Buffer.byteLength(raw, "utf8") > 2200) {
                return write(res, 413, { error: "Petición demasiado grande." });
              }
            }
          } catch { return write(res, 400, { error: "Cuerpo de petición inválido." }); }
          let payload;
          try { payload = JSON.parse(raw); } catch { return write(res, 400, { error: "JSON inválido." }); }
          const target = payload?.url;
          if (typeof target !== "string" || !target || target.length > 1800) {
            return write(res, 400, { error: "Se requiere URL HTTPS de hasta 1800 caracteres." });
          }
          const page = await readPage(target);
          const saved = await storeDocument(vault, page);
          return write(res, 200, { ...saved.record, indexSize: saved.records.size, persistence: "encrypted_local_disk_per_vault" });
        }
        if (req.method !== "GET") return write(res, 405, { error: "Método no permitido." }, { allow: "GET" });
        const records = await loadVault(vault);
        if (u.pathname === "/api/index/search") {
          const q = u.searchParams.get("q") || "";
          if (q.length > 180) return write(res, 400, { error: "La consulta supera 180 caracteres." });
          const data = searchIndex(q, records);
          return write(res, data.error ? 400 : 200, {
            ...data, persistence: "encrypted_local_disk_per_vault",
            warning: "Búsqueda en el espacio autorizado. No representa un índice global de Internet."
          });
        }
        const data = getIndexedDocument(u.searchParams.get("id") || "", records);
        return data ? write(res, 200, data) : write(res, 404, { error: "Documento no encontrado en tu espacio." });
      }
      if (u.pathname === "/api/search") {
        const q = u.searchParams.get("q") || "";
        if (q.length > 180) return write(res, 400, { error: "La consulta supera 180 caracteres." });
        const data = await search(q, u.searchParams.get("type") || "all");
        return write(res, data.error ? 400 : 200, data);
      }
      if (u.pathname === "/api/weather") {
        const q = u.searchParams.get("place") || "";
        if (q.length > 180) return write(res, 400, { error: "La localidad supera 180 caracteres." });
        const data = await weather(q);
        return write(res, data.error ? 404 : 200, data);
      }
      return write(res, 404, { error: "Ruta no encontrada." });
    } catch (error) {
      if (error instanceof AccountError) return write(res, error.status, { error: error.message, code: error.code });
      if (error instanceof ReaderError) return write(res, 422, { error: error.message, code: error.code });
      if (error instanceof VaultError) return write(res, 503, { error: error.message, code: error.code });
      return write(res, 502, { error: "La fuente externa no respondió. Prueba nuevamente." });
    }
  }
  if (req.method === "POST" || req.method === "DELETE") return write(res, 405, { error: "Método no permitido." }, { allow: "GET, HEAD" });
  if (!files.has(u.pathname)) return write(res, 404, { error: "Página no encontrada." });
  const [file, mime] = files.get(u.pathname);
  try {
    const bytes = await readFile(resolve(root, file));
    res.writeHead(200, { ...security, "content-type": mime, "cache-control": "no-cache" });
    res.end(req.method === "HEAD" ? undefined : bytes);
  } catch { write(res, 500, { error: "Recurso no disponible." }); }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 3000);
  http.createServer((req, res) => { handler(req, res).catch(() => write(res, 500, { error: "Error interno." })); })
    .listen(port, "0.0.0.0", () => console.log("WAE WEB listening on " + port));
}
