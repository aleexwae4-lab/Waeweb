import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { search, weather } from "./search.mjs";

const root = fileURLToPath(new URL("../public/", import.meta.url));
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml"]],
  ["/robots.txt", ["robots.txt", "text/plain; charset=utf-8"]]
]);
const rate = new Map();
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
  if (req.method !== "GET" && req.method !== "HEAD") return write(res, 405, { error: "Método no permitido." }, { allow: "GET, HEAD" });
  let u;
  try { u = new URL(req.url, "http://localhost"); }
  catch { return write(res, 400, { error: "URL inválida." }); }
  if (u.pathname === "/api/health") return write(res, 200, { status: "ok", product: "WAE WEB", version: "0.1.0" });
  if (u.pathname === "/api/capabilities") return write(res, 200, {
    providers: ["Wikipedia", "Crossref", "OpenAlex", "Wikimedia Commons", "Open-Meteo"],
    googleSearchConfigured: Boolean(process.env.GOOGLE_SEARCH_API_KEY && process.env.GOOGLE_SEARCH_ENGINE_ID),
    deploymentConnected: false
  });
  if (u.pathname.startsWith("/api/")) {
    if (limited(req)) return write(res, 429, { error: "Demasiadas consultas. Intenta de nuevo en un minuto." }, { "retry-after": "60" });
    try {
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
    } catch {
      return write(res, 502, { error: "La fuente externa no respondió. Prueba nuevamente." });
    }
  }
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
