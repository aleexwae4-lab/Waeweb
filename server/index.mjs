import http from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { search, weather } from "./search.mjs";
import { findPlaces, MapsError } from "./maps.mjs";
import { handleConnect, connectConfig } from "./connect.mjs";
import { readPage, searchIndex, getIndexedDocument, ReaderError } from "./reader.mjs";
import { vaultConfig, authenticateVault, loadVault, storeDocument, VaultError, vaultStorageReady } from "./vault.mjs";
import { encryptionReady, vaultKeysConfig } from "./crypto.mjs";
import { billingConfig, createStripeCheckout, retrieveStripeSubscription, verifyStripeEvent, BillingError } from "./billing.mjs";
import { MarketplaceError } from "./marketplace.mjs";
import { MarketplaceTrustError } from "./marketplace-trust.mjs";
import { mediaConfig, MarketMediaError } from "./marketplace-media.mjs";
import { MediaJournalError } from "./marketplace-lifecycle.mjs";
import { accountsEnabled, listOwnerListings, addMarketListing, editMarketListing, setMarketListingVisibility, deleteMarketListing, getPublicMarketCatalog, browseMarketplace, uploadMarketPhoto, getMarketPhotoLink, getPublicMarketPhotoLink, removeMarketPhoto, getMarketInquiries, sendMarketInquiry, reportMarketListing, AccountError, registerAccount, loginAccount, logoutAccount, getAccount, listBusinesses, addBusiness, deleteBusiness, updateBusiness, updateBusinessVisibility, listPublicBusinesses, getPublicBusiness, reserveCheckout, bindCheckout, clearCheckout, acceptPaidCheckout, updatePaidSubscription, getPromotionStatus } from "./accounts.mjs";

const root = fileURLToPath(new URL("../public/", import.meta.url));
const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
// Isolated preview: never open live accounts, private vaults, writes, billing or Connect.
const previewMode = () => process.env.WAE_PREVIEW_MODE === "true" ||
  process.env.VERCEL_ENV === "preview";
const readerAvailable = () => process.env.WAE_READER_ENABLED === "true" &&
  vaultStorageReady() && encryptionReady(vaultConfig(), vaultKeysConfig());
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/browser.js", ["browser.js", "text/javascript; charset=utf-8"]],
  ["/browser-core.js", ["browser-core.js", "text/javascript; charset=utf-8"]],
  ["/omnibox.js", ["omnibox.js", "text/javascript; charset=utf-8"]],
  ["/maps-core.js", ["maps-core.js", "text/javascript; charset=utf-8"]],
  ["/accounts.js", ["accounts.js", "text/javascript; charset=utf-8"]],
  ["/business-profile.js", ["business-profile.js", "text/javascript; charset=utf-8"]],
  ["/marketplace.js", ["marketplace.js", "text/javascript; charset=utf-8"]],
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
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; connect-src 'self'; font-src 'self'; frame-src https:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'; object-src 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "strict-origin-when-cross-origin",
  "x-frame-options": "DENY",
  "permissions-policy": "camera=(), microphone=(self), geolocation=()"
};
function write(res, code, object, headers = {}) {
  res.writeHead(code, { ...security, "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-waeweb-api": "1", ...headers });
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
  if (!["GET", "HEAD", "POST", "DELETE", "PATCH"].includes(req.method)) return write(res, 405, { error: "Método no permitido." }, { allow: "GET, HEAD, POST, DELETE, PATCH" });
  let u;
  try { u = new URL(req.url, "http://localhost"); }
  catch { return write(res, 400, { error: "URL inválida." }); }
  // Allow anonymous navigation and federated research in preview, but no
  // private data reads, mutations, signups, checkout or integration gateway.
  // VERCEL_ENV=preview is supplied by Vercel; WAE_PREVIEW_MODE=true permits
  // identical local tests. This check precedes ALL API handlers.
  if (previewMode() && u.pathname.startsWith("/api/") &&
      (!["GET","HEAD"].includes(req.method) ||
        !["/api/health","/api/capabilities","/api/search",
          "/api/weather","/api/maps","/api/marketplace"].includes(u.pathname)))
    return write(res,503,{error:"Vista previa: cuentas, pagos y APIs privadas desactivados.",
      previewMode:true});
  if (previewMode() && u.pathname==="/api/marketplace")
    return write(res,200,{items:[],total:0,hasMore:false,
      previewMode:true,note:"Catálogo vacío de vista previa; no se utilizan datos reales."});
  if (u.pathname === "/api/health" || u.pathname === "/api/capabilities") {
    if (!["GET", "HEAD"].includes(req.method)) return write(res, 405, { error: "Método no permitido." }, { allow: "GET, HEAD" });
  }
  if (u.pathname === "/api/health") return write(res, 200, { status: "ok", product: "WAE WEB", version: VERSION, previewMode:previewMode() });
  if (u.pathname === "/api/capabilities") return write(res, 200, {
    providers: ["Wikipedia", "Crossref", "OpenAlex", "Open Library", "Wikimedia Commons", "Open-Meteo", "Open-Meteo Geocoding", "OpenStreetMap"],
    mapsEnabled: true, mapPrecision: "locality_centroid_or_user_coordinates",
    googleSearchConfigured: Boolean(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID),
    researchBrief: "extractive", queryOperators: ["site:", "after:", "before:", "source:", "-term", "\"phrase\""],
    localResearchLibrary: true,
    readerEnabled: !previewMode() && readerAvailable(),
    vaultRequired: true,
    indexPersistence: previewMode() || !readerAvailable() ? "disabled" :
      process.env.WAE_VAULT_STORE === "postgres" ?
        "encrypted_postgres_per_vault" : "encrypted_local_disk_per_vault",
    encryption: "AES-256-GCM",
    accountsEnabled: !previewMode() && accountsEnabled(),
    promotionsEnabled: !previewMode() && Boolean(billingConfig()) && accountsEnabled(),
    businessRegistration: !previewMode() && accountsEnabled() ? "owner_controlled_self_declared" : "disabled",
    publicBusinessProfiles: !previewMode() && accountsEnabled(),
    marketplaceEnabled: !previewMode() && accountsEnabled(),
    marketplaceObjectMedia: !previewMode() && Boolean(mediaConfig()) && process.env.WAE_ACCOUNTS_STORE === "postgres" && accountsEnabled(),
    connectApi: !previewMode() && Boolean(connectConfig()),
    previewMode:previewMode(),
    deploymentConnected: false
  });
  if (u.pathname.startsWith("/api/connect/")) return handleConnect(req,res);
  const accountRoutes = new Set(["/api/account/register", "/api/account/login", "/api/account/logout", "/api/account/me", "/api/businesses", "/api/businesses/public", "/api/promotions/plan", "/api/promotions/webhook", "/api/promotions/search", "/api/marketplace"]);
  const businessDelete = /^\/api\/businesses\/[0-9a-f-]{36}$/i.test(u.pathname);
  const businessEdit = /^\/api\/businesses\/[0-9a-f-]{36}\/profile$/i.test(u.pathname);
  const businessPublicProfile = /^\/api\/businesses\/public\/[0-9a-f-]{36}$/i.test(u.pathname);
  const businessCheckout = /^\/api\/businesses\/[0-9a-f-]{36}\/promote$/i.test(u.pathname);
  const businessPromotion = /^\/api\/businesses\/[0-9a-f-]{36}\/promotion$/i.test(u.pathname);
  const catalogOwner = u.pathname.match(/^\/api\/businesses\/([0-9a-f-]{36})\/listings$/i);
  const catalogItem = u.pathname.match(/^\/api\/businesses\/([0-9a-f-]{36})\/listings\/([0-9a-f-]{36})(\/visibility)?$/i);
  const catalogPublic = u.pathname.match(/^\/api\/businesses\/public\/([0-9a-f-]{36})\/listings$/i);
  const marketInquiries = u.pathname.match(/^\/api\/businesses\/([0-9a-f-]{36})\/inquiries$/i);
  const marketInteraction = u.pathname.match(/^\/api\/marketplace\/([0-9a-f-]{36})\/([0-9a-f-]{36})\/(inquiries|reports)$/i);
  const imageOwner = u.pathname.match(/^\/api\/businesses\/([0-9a-f-]{36})\/listings\/([0-9a-f-]{36})\/image$/i);
  const imagePublic = u.pathname.match(/^\/api\/marketplace\/images\/([0-9a-f-]{36})\/([0-9a-f-]{36})$/i);
  if (req.method === "POST" && u.pathname !== "/api/read" && !accountRoutes.has(u.pathname) && !businessCheckout && !catalogOwner && !marketInteraction && !imageOwner)
    return write(res, 405, { error: "Método no permitido." }, { allow: "GET, HEAD" });
  if (req.method === "PATCH" && !businessDelete && !businessEdit && !catalogItem) return write(res, 405, { error: "Método no permitido." }, { allow: "GET, HEAD" });
  if (req.method === "DELETE" && !businessDelete && !catalogItem && !imageOwner)
    return write(res, 405, { error: "Método no permitido." }, { allow: "GET, HEAD" });
  if (u.pathname.startsWith("/api/")) {
    if (limited(req)) return write(res, 429, { error: "Demasiadas consultas. Intenta de nuevo en un minuto." }, { "retry-after": "60" });
    try {
      if (accountRoutes.has(u.pathname) || businessDelete || businessEdit || businessPublicProfile || businessCheckout || businessPromotion || catalogOwner || catalogItem || catalogPublic || marketInquiries || marketInteraction || imageOwner || imagePublic) {
        if (!accountsEnabled()) return write(res, 503, { error: "Cuentas desactivadas. Configura WAE_ACCOUNTS_ENABLED y WAE_ACCOUNTS_KEY en el servidor." });
        if (imagePublic && req.method === "GET") {
          const signed=await getPublicMarketPhotoLink(imagePublic[1],imagePublic[2]);
          res.writeHead(302,{...security, location:signed.url,
            "cache-control":"private, no-store, max-age=0",
            "referrer-policy":"no-referrer", "content-length":"0"});
          return res.end();
        }
        if (imageOwner && req.method === "GET")
          return write(res,200,await getMarketPhotoLink(
            req.headers.authorization,imageOwner[1],imageOwner[2]));
        if (imageOwner && req.method === "POST") {
          const body=await jsonBody(req,380*1024);
          return write(res,201,await uploadMarketPhoto(
            req.headers.authorization,imageOwner[1],imageOwner[2],body));
        }
        if (imageOwner && req.method === "DELETE")
          return write(res,200,await removeMarketPhoto(
            req.headers.authorization,imageOwner[1],imageOwner[2]));
        if (u.pathname === "/api/marketplace" && req.method === "GET") {
          return write(res,200,await browseMarketplace({
            q:u.searchParams.get("q")||"",city:u.searchParams.get("city")||"",
            kind:u.searchParams.get("kind")||"all",
            page:Number(u.searchParams.get("page")||1)
          }));
        }
        if (catalogPublic && req.method === "GET")
          return write(res,200,await getPublicMarketCatalog(catalogPublic[1]));
        if (catalogOwner && req.method === "GET")
          return write(res,200,await listOwnerListings(req.headers.authorization,catalogOwner[1]));
        if (catalogOwner && req.method === "POST") {
          const body=await jsonBody(req,95*1024);
          return write(res,201,{item:await addMarketListing(req.headers.authorization,catalogOwner[1],body)});
        }
        if (catalogItem && req.method === "PATCH") {
          const body=await jsonBody(req,95*1024);
          const item=catalogItem[3]
            ? await setMarketListingVisibility(req.headers.authorization,catalogItem[1],catalogItem[2],body.published)
            : await editMarketListing(req.headers.authorization,catalogItem[1],catalogItem[2],body);
          return write(res,200,{item});
        }
        if (catalogItem && !catalogItem[3] && req.method === "DELETE")
          return write(res,200,await deleteMarketListing(req.headers.authorization,catalogItem[1],catalogItem[2]));
        if (marketInquiries && req.method === "GET")
          return write(res, 200, await getMarketInquiries(req.headers.authorization, marketInquiries[1]));
        if (marketInteraction && req.method === "POST") {
          const body = await jsonBody(req, 1100);
          const result = marketInteraction[3] === "inquiries"
            ? await sendMarketInquiry(req.headers.authorization, marketInteraction[1], marketInteraction[2], body)
            : await reportMarketListing(req.headers.authorization, marketInteraction[1], marketInteraction[2], body);
          return write(res, 201, result);
        }
        if (u.pathname === "/api/promotions/search" && req.method === "GET") {
          if (!billingConfig()) return write(res, 200, { sponsored: [], label: "Patrocinado" });
          const q = u.searchParams.get("q") || "";
          if (q.length < 2 || q.length > 100) return write(res, 400, { error: "Consulta de promoción inválida." });
          const listings = await listPublicBusinesses(q);
          return write(res, 200, { sponsored: listings.sponsored,
            label: "Patrocinado", disclaimer: "Publicidad pagada no verificada. Los resultados orgánicos son independientes." });
        }
        if (u.pathname === "/api/promotions/plan" && req.method === "GET") {
          return write(res, 200, { free: { name: "Registro Gratis", price: 0,
            description: "Ficha y participación orgánica sin costo." },
            promote: { name: "Plan Promocionar", available: Boolean(billingConfig()),
              price: null, priceNote: "Importe e intervalo definidos por el operador y mostrados antes de pagar en Stripe Checkout.",
              placement: "Hasta tres resultados patrocinados señalados por consulta relevante.",
              disclaimer: "Publicidad pagada, no certificación ni ingresos garantizados." } });
        }
        if (u.pathname === "/api/promotions/webhook") {
          if (req.method !== "POST") return write(res, 405, { error: "Se requiere POST." }, { allow: "POST" });
          const config = billingConfig();
          if (!config) return write(res, 503, { error: "El cobro está desactivado." });
          let size = 0, chunks = [];
          try {
            for await (const chunk of req) {
              size += chunk.length;
              if (size > 128 * 1024) return write(res, 413, { error: "Evento demasiado grande." });
              chunks.push(chunk);
            }
          } catch { return write(res, 400, { error: "Evento inválido." }); }
          const event = verifyStripeEvent(Buffer.concat(chunks), req.headers["stripe-signature"], config.webhookSecret);
          if (Boolean(event.livemode) !== config.live) return write(res, 400, { error: "Modo de pago inconsistente." });
          if (event.type === "checkout.session.completed") {
            const session = event.data.object;
            if (session.mode !== "subscription" || session.payment_status !== "paid" ||
              typeof session.subscription !== "string") return write(res, 200, { received: true, promoted: false });
            const subscription = await retrieveStripeSubscription(config, session.subscription);
            const result = await acceptPaidCheckout(event, subscription, config);
            return write(res, 200, { received: true, promoted: result.applied });
          }
          if (["customer.subscription.updated", "customer.subscription.deleted",
               "invoice.paid", "invoice.payment_failed"].includes(event.type)) {
            const reference = event.type.startsWith("invoice.")
              ? event.data.object.subscription : event.data.object.id;
            if (typeof reference !== "string") return write(res, 200, { received: true });
            let subscription;
            if (event.type === "customer.subscription.deleted") {
              subscription = event.data.object;
            } else {
              subscription = await retrieveStripeSubscription(config, reference);
            }
            await updatePaidSubscription(event, subscription, config);
          }
          return write(res, 200, { received: true });
        }
        if (businessPromotion && req.method === "GET") {
          return write(res, 200, await getPromotionStatus(req.headers.authorization,
            u.pathname.slice("/api/businesses/".length, -"/promotion".length)));
        }
        if (businessCheckout && req.method === "POST") {
          const config = billingConfig();
          if (!config) return write(res, 503, { error: "Los pagos aún no están configurados." });
          const id = u.pathname.slice("/api/businesses/".length, -"/promote".length);
          const attempt = await reserveCheckout(req.headers.authorization, id);
          let checkout;
          try {
            checkout = await createStripeCheckout(config, attempt);
            await bindCheckout(attempt, checkout.id);
          } catch (error) {
            await clearCheckout(attempt).catch(() => {});
            throw error;
          }
          return write(res, 201, { checkoutUrl: checkout.url,
            message: "La publicidad solo se activa cuando Stripe confirma el cobro." });
        }
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
        if (businessPublicProfile && req.method === "GET") {
          return write(res, 200, await getPublicBusiness(u.pathname.slice("/api/businesses/public/".length)));
        }
        if (u.pathname === "/api/businesses/public" && req.method === "GET") {
          return write(res, 200, await listPublicBusinesses(u.searchParams.get("q") || ""));
        }
        if (u.pathname === "/api/businesses" && req.method === "GET") {
          return write(res, 200, await listBusinesses(req.headers.authorization));
        }
        if (u.pathname === "/api/businesses" && req.method === "POST") {
          const body = await jsonBody(req);
          return write(res, 201, { business: await addBusiness(req.headers.authorization, body) });
        }
        if (businessEdit && req.method === "PATCH") {
          const body = await jsonBody(req);
          return write(res, 200, { business: await updateBusiness(req.headers.authorization,
            u.pathname.slice("/api/businesses/".length, -"/profile".length), body) });
        }
        if (businessDelete && req.method === "PATCH") {
          const body = await jsonBody(req);
          return write(res, 200, { business: await updateBusinessVisibility(req.headers.authorization, u.pathname.slice("/api/businesses/".length), body.published) });
        }
        if (businessDelete && req.method === "DELETE") {
          return write(res, 200, await deleteBusiness(req.headers.authorization, u.pathname.slice("/api/businesses/".length)));
        }
        return write(res, 405, { error: "Método no permitido." }, { allow: "GET, POST, DELETE, PATCH" });
      }
      if (u.pathname === "/api/index/search" || u.pathname === "/api/index/document" || u.pathname === "/api/read") {
        if (!readerAvailable()) {
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
          return write(res, 200, { ...saved.record, indexSize: saved.records.size, persistence: process.env.WAE_VAULT_STORE === "postgres" ? "encrypted_postgres_per_vault" : "encrypted_local_disk_per_vault" });
        }
        if (req.method !== "GET") return write(res, 405, { error: "Método no permitido." }, { allow: "GET" });
        const records = await loadVault(vault);
        if (u.pathname === "/api/index/search") {
          const q = u.searchParams.get("q") || "";
          if (q.length > 180) return write(res, 400, { error: "La consulta supera 180 caracteres." });
          const data = searchIndex(q, records);
          return write(res, data.error ? 400 : 200, {
            ...data, persistence: process.env.WAE_VAULT_STORE === "postgres" ? "encrypted_postgres_per_vault" : "encrypted_local_disk_per_vault",
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
      if (u.pathname === "/api/maps") {
        if (req.method !== "GET" && req.method !== "HEAD") return write(res, 405, { error: "Método no permitido." }, { allow: "GET, HEAD" });
        const data = await findPlaces(u.searchParams.get("q") || "");
        return write(res, 200, data);
      }
      if (u.pathname === "/api/weather") {
        const q = u.searchParams.get("place") || "";
        if (q.length > 180) return write(res, 400, { error: "La localidad supera 180 caracteres." });
        const data = await weather(q);
        return write(res, data.error ? 404 : 200, data);
      }
      return write(res, 404, { error: "Ruta no encontrada." });
    } catch (error) {
      if (error instanceof MapsError) return write(res, error.status, { error: error.message, code: error.code });
      if (error instanceof BillingError) return write(res, error.status, { error: error.message, code: error.code });
      if (error instanceof MarketplaceError) return write(res,error.status,{error:error.message,code:error.code});
      if (error instanceof MarketMediaError) return write(res,error.status,{error:"Fotografía no disponible o inválida.",code:error.code});
      if (error instanceof MediaJournalError) return write(res,error.status,{error:"Almacenamiento de fotografías pendiente de revisión.",code:error.code});
      if (error instanceof MarketplaceTrustError) return write(res,error.status,{error:error.message,code:error.code});
      if (error instanceof AccountError) return write(res, error.status, { error: error.message, code: error.code });
      if (error instanceof ReaderError) return write(res, 422, { error: error.message, code: error.code });
      if (error instanceof VaultError) return write(res, 503, { error: error.message, code: error.code });
      return write(res, 502, { error: "La fuente externa no respondió. Prueba nuevamente." });
    }
  }
  if (req.method === "POST" || req.method === "DELETE" || req.method === "PATCH") return write(res, 405, { error: "Método no permitido." }, { allow: "GET, HEAD" });
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
