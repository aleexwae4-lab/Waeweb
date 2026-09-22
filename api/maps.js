// Public location search. The shared handler retains rate-limit and preview guards.
import { handler } from "../server/index.mjs";
export default async function waewebMaps(req,res) {
  try { await handler(req,res); }
  catch {
    if (res.headersSent) { res.destroy?.(); return; }
    res.writeHead(500,{
      "content-type":"application/json; charset=utf-8",
      "cache-control":"no-store",
      "x-content-type-options":"nosniff",
      "x-waeweb-api":"1"
    });
    res.end(JSON.stringify({error:"Error interno del backend WAEWEB."}));
  }
}
