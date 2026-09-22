import dns from "node:dns/promises";
import https from "node:https";
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { parseQuery, rankResults, researchBrief } from "./intelligence.mjs";

const MAX_BYTES = 256 * 1024;
const MAX_DOCUMENTS = 80;
const MAX_TEXT = 18000;
const AGENT = "WAEWebResearchBot";
const docs = new Map();
const robotsCache = new Map();
export class ReaderError extends Error {
  constructor(code, message) { super(message); this.name = "ReaderError"; this.code = code; }
}
function reject(code, message) { throw new ReaderError(code, message); }
export function isPublicAddress(ip) {
  if (isIP(ip) !== 4) return false; // IPv6 and embedded IPv4 are deliberately unsupported.
  const [a, b, c] = ip.split(".").map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
    a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 ||
    a === 192 && (b === 168 || b === 0 || b === 88 && c === 99) ||
    a === 198 && (b === 18 || b === 19 || b === 51 && c === 100) ||
    a === 203 && b === 0 && c === 113 || a === 100 && b >= 64 && b <= 127);
}
export function safeReaderUrl(input) {
  let url;
  try { url = new URL(input); } catch { reject("invalid_url", "URL inválida."); }
  if (url.protocol !== "https:" || url.port && url.port !== "443" || url.username ||
    url.password || url.hash || url.href.length > 1800) {
    reject("blocked_url", "Solo HTTPS público en puerto 443, sin credenciales ni fragmentos.");
  }
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!host.includes(".") || host === "localhost" || /\.(local|internal|localhost|test|invalid|onion)$/.test(host) ||
    isIP(host) || !/^[a-z0-9.-]+$/.test(host)) {
    reject("blocked_host", "No se permiten IP literales, dominios reservados ni nombres internos.");
  }
  return url;
}
async function publicEndpoint(url, resolver = dns.lookup) {
  let addresses;
  try { addresses = await resolver(url.hostname, { all: true, family: 4, verbatim: true }); }
  catch { reject("dns_failed", "No se pudo resolver el dominio público IPv4."); }
  if (!Array.isArray(addresses) || !addresses.length || addresses.some(entry => !isPublicAddress(entry.address))) {
    reject("blocked_dns", "La resolución DNS incluyó una dirección no pública.");
  }
  return addresses[0];
}
function requestPublic(url, address, maxBytes = MAX_BYTES) {
  return new Promise((resolve, rejectPromise) => {
    let settled = false;
    const done = (error, value) => {
      if (settled) return;
      settled = true;
      if (error) rejectPromise(error); else resolve(value);
    };
    const req = https.get(url, {
      lookup: (_host, _options, callback) => callback(null, address.address, 4),
      headers: { "user-agent": AGENT + "/0.3 (+https://github.com/aleexwae4-lab/Waeweb)", "accept": "text/html,text/plain;q=0.8", "accept-encoding": "identity" },
      timeout: 5000, maxHeaderSize: 16000
    }, res => {
      const status = res.statusCode || 0;
      if ([301, 302, 303, 307, 308].includes(status)) {
        res.resume();
        return done(null, { status, location: res.headers.location, headers: res.headers });
      }
      if (status === 404) { res.resume(); return done(null, { status, body: "" }); }
      if (status !== 200) { res.resume(); return done(new ReaderError("upstream_status", "El sitio respondió " + status + ".")); }
      if (res.headers["content-encoding"] && res.headers["content-encoding"] !== "identity") {
        res.destroy(); return done(new ReaderError("compressed", "No se aceptan respuestas comprimidas."));
      }
      if (Number(res.headers["content-length"]) > maxBytes) {
        res.destroy(); return done(new ReaderError("too_large", "Documento demasiado grande."));
      }
      const chunks = []; let length = 0;
      res.on("data", chunk => {
        length += chunk.length;
        if (length > maxBytes) {
          res.destroy(); return done(new ReaderError("too_large", "Documento demasiado grande."));
        }
        chunks.push(chunk);
      });
      res.on("end", () => done(null, { status, body: Buffer.concat(chunks).toString("utf8"), headers: res.headers }));
      res.on("error", error => done(error));
    });
    req.on("timeout", () => req.destroy(new ReaderError("timeout", "La página tardó demasiado.")));
    req.on("error", error => done(error));
  });
}
async function guardedFetch(input, { resolver = dns.lookup, transport = requestPublic, redirects = 2 } = {}) {
  let url = safeReaderUrl(input);
  const seen = new Set();
  for (let attempt = 0; attempt <= redirects; attempt++) {
    if (seen.has(url.href)) reject("redirect_loop", "Redirección circular.");
    seen.add(url.href);
    const address = await publicEndpoint(url, resolver);
    const result = await transport(url, address);
    if ([301, 302, 303, 307, 308].includes(result.status)) {
      if (!result.location || attempt === redirects) reject("redirect_limit", "Demasiadas redirecciones.");
      url = safeReaderUrl(new URL(result.location, url).href);
      continue;
    }
    return { ...result, url: url.href };
  }
  reject("redirect_limit", "Demasiadas redirecciones.");
}
export function robotsPermits(body, path, agent = AGENT) {
  const target = agent.toLowerCase();
  const groups = []; let current = { agents: [], rules: [] }; let started = false;
  for (const raw of String(body).split(/\r?\n/).slice(0, 3000)) {
    const line = raw.split("#", 1)[0].trim();
    const match = line.match(/^(user-agent|allow|disallow)\s*:\s*(.*)$/i);
    if (!match) continue;
    const directive = match[1].toLowerCase(), value = match[2].trim();
    if (directive === "user-agent") {
      if (started) { groups.push(current); current = { agents: [], rules: [] }; started = false; }
      current.agents.push(value.toLowerCase());
    } else {
      started = true;
      current.rules.push({ directive, value });
    }
  }
  groups.push(current);
  const specific = groups.filter(g => g.agents.includes(target));
  const rules = (specific.length ? specific : groups.filter(g => g.agents.includes("*"))).flatMap(g => g.rules);
  let matched = null;
  for (const rule of rules) {
    if (!rule.value) continue;
    const encoded = rule.value.split("*").map(part => [...part].map(c =>
      ".+?^$()[]{}|\\".includes(c) ? "\\" + c : c).join("")).join(".*");
    const pattern = "^" + encoded;
    let matches;
    try { matches = new RegExp(pattern).test(path); } catch { return false; }
    if (!matches) continue;
    const length = rule.value.replace(/\*/g, "").length;
    if (!matched || length > matched.length || length === matched.length && rule.directive === "allow") {
      matched = { length, directive: rule.directive };
    }
  }
  return !matched || matched.directive === "allow";
}
const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function plainText(value) {
  return String(value ?? "").replace(/&#(x[0-9a-f]+|\d+);|&([a-z]+);/gi, (all, number, name) => {
    if (name) return entities[name.toLowerCase()] ?? all;
    const code = number.toLowerCase().startsWith("x") ? parseInt(number.slice(1), 16) : Number(number);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : "";
  }).replace(/\s+/g, " ").trim();
}
export function extractHtml(html) {
  const raw = String(html);
  const title = plainText((raw.match(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/i) || [])[1] || "").slice(0, 240);
  const stripped = raw.replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|nav|footer|header)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/(?:p|div|section|article|h[1-6]|li|br)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return { title, text: plainText(stripped).slice(0, MAX_TEXT) };
}
async function checkRobots(url, options) {
  const root = new URL("/robots.txt", url);
  let entry = robotsCache.get(root.origin);
  if (!entry || entry.expires < Date.now()) {
    const response = await guardedFetch(root.href, options);
    if (new URL(response.url).origin !== root.origin) reject("robots_redirect", "robots.txt redirigido a otro origen.");
    const body = response.status === 404 ? "" : response.body;
    if (body.length > 65536) reject("robots_too_large", "robots.txt demasiado grande.");
    if (robotsCache.size >= 150) robotsCache.clear();
    entry = { body, expires: Date.now() + 900000 };
    robotsCache.set(root.origin, entry);
  }
  if (!robotsPermits(entry.body, url.pathname + url.search)) {
    reject("robots_disallowed", "robots.txt restringe esta ruta.");
  }
}
export async function readPage(input, options = {}) {
  const url = safeReaderUrl(input);
  await checkRobots(url, options);
  // Do not follow document redirects: otherwise the destination path could bypass its robots rules.
  const response = await guardedFetch(url.href, { ...options, redirects: 0 });
  if (response.status !== 200) reject("not_found", "Documento no encontrado.");
  const mime = String(response.headers?.["content-type"] || "").toLowerCase().split(";")[0].trim();
  if (!["text/html", "text/plain"].includes(mime)) reject("unsupported_media", "Solo se admite HTML o texto.");
  const parsed = mime === "text/html" ? extractHtml(response.body) :
    { title: "", text: plainText(response.body).slice(0, MAX_TEXT) };
  if (parsed.text.length < 30) reject("empty_page", "Sin suficiente texto legible.");
  return {
    id: createHash("sha256").update(response.url).digest("hex").slice(0, 20),
    url: response.url, title: parsed.title || new URL(response.url).hostname,
    text: parsed.text, source: "Índice WAE", fetchedAt: new Date().toISOString(),
    fingerprint: createHash("sha256").update(parsed.text).digest("hex")
  };
}
export function indexDocument(page, store = docs) {
  if (!page || !/^https:\/\//.test(page.url) || typeof page.text !== "string" ||
    page.text.length < 30 || page.text.length > MAX_TEXT || !/^[a-f0-9]{20}$/.test(page.id)) {
    reject("invalid_document", "Documento de índice inválido.");
  }
  const record = { ...page, snippet: page.text.slice(0, 440) };
  store.delete(page.id);
  while (store.size >= MAX_DOCUMENTS) store.delete(store.keys().next().value);
  store.set(page.id, record);
  return record;
}
export function searchIndex(query, store = docs) {
  const spec = parseQuery(query);
  if (spec.errors.length) return { error: spec.errors.join(" ") };
  if (spec.query.length < 2) return { error: "Escribe una consulta de al menos dos caracteres." };
  const results = rankResults([...store.values()].map(doc => ({
    title: doc.title, url: doc.url, snippet: doc.text.slice(0, 900),
    source: "Índice WAE", date: null, id: doc.id,
    fingerprint: doc.fingerprint, fetchedAt: doc.fetchedAt
  })), spec);
  return { query: spec.input, results, count: results.length,
    indexSize: store.size, brief: researchBrief(results), persistence: "memory_only",
    warning: "Índice temporal de páginas solicitadas expresamente; no representa toda la web." };
}
export function getIndexedDocument(id, store = docs) {
  return /^[a-f0-9]{20}$/.test(String(id)) ? store.get(id) || null : null;
}
export async function readAndIndex(url, options = {}) {
  const page = await readPage(url, options);
  const indexed = indexDocument(page);
  return { ...indexed, indexSize: docs.size, persistence: "memory_only" };
}
export function indexSize() { return docs.size; }
