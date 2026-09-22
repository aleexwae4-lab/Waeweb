// Named public API entry points prevent a catch-all routing mismatch from
// sending public requests into an unrelated auth middleware or static fallback.
// The shared handler enforces all method, preview and rate-limit policies.
import { handler } from "../server/index.mjs";
export default async function waewebPublicApi(req, res) {
  try { await handler(req, res); }
  catch {
    if (res.headersSent) { res.destroy?.(); return; }
    res.writeHead(500, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "x-waeweb-api": "1"
    });
    res.end(JSON.stringify({ error: "Error interno del backend WAEWEB." }));
  }
}
