// Vercel Node.js function entry point. Source-only: no deployment is configured.
// Vercel's catch-all API file preserves the incoming /api/* request path.
// The HTTP handler is shared with local Node/Electron; no server.listen().
import { handler } from "../server/index.mjs";

export default async function waewebApi(req, res) {
  try {
    await handler(req, res);
  } catch {
    if (res.headersSent) {
      res.destroy?.();
      return;
    }
    res.writeHead(500, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    res.end(JSON.stringify({ error: "Error interno del backend WAEWEB." }));
  }
}
