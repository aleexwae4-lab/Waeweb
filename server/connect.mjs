import { createHash, timingSafeEqual } from "node:crypto";
import { search } from "./search.mjs";
import { readPage, ReaderError, safeReaderUrl } from "./reader.mjs";
import { connectAdmissionReady, acquireConnectPostgres } from "./connect-postgres.mjs";

export const CONNECT_VERSION = "waeweb-connect/v1";
export const CONNECT_CLIENT_IDS = Object.freeze([
  "inteligenciauniversal", "universal-core-vt3h", "waeosgreen"
]);
const TYPES = new Set(["all","images","news","videos","research","books"]);
const counters = new Map();
const running = new Map();
const sha = text => createHash("sha256").update(text).digest();
function json(res, status, payload, headers={}) {
  res.writeHead(status, { "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store", "x-content-type-options":"nosniff",
    "referrer-policy":"no-referrer", "x-waeweb-connect":CONNECT_VERSION, ...headers });
  res.end(JSON.stringify(payload));
}
export function connectConfig(env=process.env) {
  if (env.WAE_CONNECT_ENABLED !== "true" || !connectAdmissionReady(env)) return null;
  let obj;
  try { obj = JSON.parse(env.WAE_CONNECT_CLIENTS_JSON || ""); } catch { return null; }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const entries = Object.entries(obj);
  if (!entries.length || entries.length > 3) return null;
  const seen = new Set(), clients = new Map();
  for (const [id,secret] of entries) {
    if (!CONNECT_CLIENT_IDS.includes(id) || typeof secret !== "string" ||
      secret.length < 32 || secret.length > 256 ||
      !/^[\x21-\x7e]+$/.test(secret) || seen.has(secret)) return null;
    seen.add(secret); clients.set(id,sha(secret));
  }
  return clients;
}
export function authorizeConnect(headers={},config=connectConfig()) {
  if (!(config instanceof Map)) return null;
  const id = headers["x-waeweb-client"];
  const auth = headers.authorization;
  if (typeof id !== "string" || !config.has(id) || typeof auth !== "string" ||
    !/^Bearer [\x21-\x7e]{32,256}$/.test(auth)) return null;
  const provided = sha(auth.slice(7));
  return timingSafeEqual(provided,config.get(id)) ? id : null;
}
export function connectRequest(body, kind="search") {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new TypeError("invalid_json");
  if (kind === "retrieve") {
    if (typeof body.url !== "string" || body.url.length < 12 || body.url.length > 1800)
      throw new TypeError("invalid_url");
    try { return { url:safeReaderUrl(body.url).href }; }
    catch { throw new TypeError("invalid_url"); }
  }
  if (typeof body.query !== "string" || body.query !== body.query.trim() ||
    body.query.length < 2 || body.query.length > 180 ||
    /[\u0000-\u001f\u007f]/.test(body.query)) throw new TypeError("invalid_query");
  if (body.type !== undefined && !TYPES.has(body.type)) throw new TypeError("invalid_type");
  if (body.fresh !== undefined && typeof body.fresh !== "boolean") throw new TypeError("invalid_fresh");
  return { query:body.query,type:body.type || "all",fresh:body.fresh === true };
}
async function bodyJson(req) {
  const parts=[]; let bytes=0;
  for await (const chunk of req) {
    bytes+=chunk.length;
    if (bytes>2400) throw new TypeError("body_too_large");
    parts.push(chunk);
  }
  let value;
  try { value=JSON.parse(Buffer.concat(parts).toString("utf8")); }
  catch { throw new TypeError("invalid_json"); }
  return value;
}
function admission(id) {
  const now=Date.now(),slot=counters.get(id);
  if (!slot || slot.until<=now) {
    counters.set(id,{until:now+60000,count:1});return true;
  }
  slot.count+=1;return slot.count<=20;
}
function sse(res,event,data) {
  if (!res.destroyed && !res.writableEnded)
    res.write("event: "+event+"\ndata: "+JSON.stringify(data)+"\n\n");
}
// Never turn an upstream outage (including an unconfigured category) into a
// successful empty answer. Preserve partial evidence without claiming completeness.
const textField=(value,max=1024)=>typeof value==="string"
  ? value.replace(/[\\u0000-\\u001f\\u007f]/g," ").trim().slice(0,max) : "";
const sourceList=value=>Array.isArray(value)
  ? value.filter(x=>typeof x==="string").slice(0,25).map(x=>textField(x,120)).filter(Boolean)
  : [];
function usableUrl(value) {
  if(typeof value!=="string" || value.length>1800)return false;
  try {
    const url=new URL(value);
    return ["https:","http:"].includes(url.protocol) &&
      !url.username && !url.password && !url.hash && Boolean(url.hostname);
  }catch{return false;}
}
export function safeResults(payload,params) {
  if(!payload || typeof payload!=="object" || Array.isArray(payload))
    return {ok:false,contract:CONNECT_VERSION,error:"invalid_search_response"};
  if(payload.error) return {ok:false,contract:CONNECT_VERSION,
    error:"search_rejected",message:textField(payload.error,300)};
  const sources=sourceList(payload.sources);
  const failedSources=sourceList(payload.failedSources);
  const configured=sources.filter(name=>!name.endsWith(" no configurado"));
  // A configured provider may legitimately have ZERO hits. Missing provider
  // capability is different from a verified zero-result search.
  if(configured.length===0) return {ok:false,contract:CONNECT_VERSION,
    error:"no_sources_available",status:"unavailable",
    sources,failedSources,results:[],fetchedAt:new Date().toISOString()};
  const results=Array.isArray(payload.results)?payload.results:[];
  const mapped=results.filter(item=>item && typeof item==="object" &&
    usableUrl(item.url) && textField(item.title,300))
    .slice(0,25).map(item=>({
      title:textField(item.title,300),url:item.url,
      snippet:textField(item.snippet,1100),source:textField(item.source,120),
      date:textField(item.date,40)||null,
      image:usableUrl(item.image)?item.image:null
    }));
  const status=failedSources.length || sources.some(name=>name.endsWith(" no configurado"))
    ? "partial" : "complete";
  return {ok:true,contract:CONNECT_VERSION,
    status,query:textField(payload.query,180),type:params.type,
    results:mapped,sources,failedSources,
    fetchedAt:typeof payload.fetchedAt==="string" &&
      !Number.isNaN(Date.parse(payload.fetchedAt))?payload.fetchedAt:new Date().toISOString(),
    brief:payload.brief&&typeof payload.brief==="object"?null:textField(payload.brief,1200)||null,
    freshness:params.fresh?"bypass_waeweb_cache":"standard_cache",
    disclaimer:"Fuentes externas no verificadas; un resultado parcial no implica cobertura exhaustiva."
  };
}

export async function handleConnect(req,res,{searchProvider=search,reader=readPage}={}) {
  const pathname=new URL(req.url||"/","http://localhost").pathname;
  const allowed={"/api/connect/v1/status":"GET","/api/connect/v1/search":"POST",
    "/api/connect/v1/stream":"POST","/api/connect/v1/retrieve":"POST"};
  const method=allowed[pathname];
  if (!method) return json(res,404,{error:"connect_route_not_found"});
  if (req.headers.origin) return json(res,403,{error:"server_to_server_only"});
  const config=connectConfig();
  if (!config) return json(res,503,{error:"connect_disabled"});
  const client=authorizeConnect(req.headers,config);
  if (!client) return json(res,401,{error:"invalid_connect_credentials"},
    {"www-authenticate":'Bearer realm="WAEWEB Connect"'});
  if (req.method!==method) return json(res,405,{error:"method_not_allowed"},{allow:method});
  const shared=process.env.WAE_CONNECT_ADMISSION_MODE==="postgres";
  let lease;
  if (shared) {
    try {
      lease=await acquireConnectPostgres(client);
      if (!lease.ok) return json(res,429,{error:lease.reason},
        {"retry-after":lease.reason==="connect_rate_limited"?"60":"1"});
    } catch { return json(res,503,{error:"connect_admission_unavailable"}); }
  } else {
    if (!admission(client)) return json(res,429,{error:"connect_rate_limited"},{"retry-after":"60"});
    const inFlight=running.get(client)||0;
    if (inFlight>=3) return json(res,429,{error:"connect_concurrency_limited"},{"retry-after":"1"});
    running.set(client,inFlight+1);
  }
  try {
    if (method==="GET") return json(res,200,{ok:true,contract:CONNECT_VERSION,
      client,capabilities:{search:true,stream:true,retrieve:process.env.WAE_CONNECT_READER_ENABLED==="true"},
      transport:"server_to_server",streamSemantics:"start_then_final_results",
      admission:shared?"postgres_shared":"local_development",
      browserEngine:"not_remote_chromium"});
    const params=connectRequest(await bodyJson(req),pathname.endsWith("/retrieve")?"retrieve":"search");
    if (pathname.endsWith("/retrieve")) {
      if (process.env.WAE_CONNECT_READER_ENABLED!=="true") return json(res,503,{error:"connect_reader_disabled"});
      const page=await reader(params.url);
      return json(res,200,{ok:true,contract:CONNECT_VERSION,
        page:{url:page.url,title:page.title,text:page.text,fetchedAt:page.fetchedAt,
          fingerprint:page.fingerprint,source:"WAEWEB public HTTPS Reader"},
        disclaimer:"Lectura solicitada bajo HTTPS público y robots.txt. No se guarda en las bóvedas."});
    }
    if (pathname.endsWith("/stream")) {
      res.writeHead(200,{"content-type":"text/event-stream; charset=utf-8",
        "cache-control":"no-store, no-transform","connection":"keep-alive",
        "x-content-type-options":"nosniff","x-waeweb-connect":CONNECT_VERSION});
      sse(res,"ready",{contract:CONNECT_VERSION,client,query:params.query});
      try {
        const payload=safeResults(await searchProvider(params.query,params.type,{fresh:params.fresh}),params);
        sse(res,payload.ok?"results":"error",payload);
        sse(res,"done",{ok:payload.ok});
      } catch { sse(res,"error",{error:"connect_upstream_unavailable"});sse(res,"done",{ok:false}); }
      return res.end();
    }
    try {
      const result=safeResults(await searchProvider(params.query,params.type,{fresh:params.fresh}),params);
      return json(res,result.ok?200:result.error==="no_sources_available"?503:422,result);
    } catch { return json(res,502,{error:"connect_upstream_unavailable"}); }
  } catch (error) {
    if (error instanceof TypeError)
      return json(res,error.message==="body_too_large"?413:400,{error:error.message});
    if (error instanceof ReaderError)
      return json(res,422,{error:error.code,message:error.message});
    return json(res,502,{error:"connect_operation_failed"});
  } finally {
    if (shared) await lease.release().catch(()=>{});
    else {
      const count=running.get(client)||1;
      if (count<=1) running.delete(client); else running.set(client,count-1);
    }
  }
}
