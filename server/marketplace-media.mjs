// RC15 private, opt-in S3-compatible object storage for JPEG marketplace photos.
// Credentials are operator-only, never sent to browsers or committed to Git.
import { createHash, createHmac, randomUUID } from "node:crypto";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_MEDIA_BYTES = 250 * 1024;
const hex = bytes => createHash("sha256").update(bytes).digest("hex");
const hmac = (key, value) => createHmac("sha256", key).update(value).digest();
const esc = value => encodeURIComponent(value).replace(/[!'()*]/g,
  char => "%" + char.charCodeAt(0).toString(16).toUpperCase());

export class MarketMediaError extends Error {
  constructor(code, status = 422) {
    super(code); this.name = "MarketMediaError"; this.code = code; this.status = status;
  }
}
const fail = (code, status) => { throw new MarketMediaError(code, status); };
export const mediaSelected = (env = process.env) => env.WAE_MARKET_MEDIA_STORE === "s3";
export function mediaConfig(env = process.env) {
  if (!mediaSelected(env)) return null;
  let endpoint;
  try { endpoint = new URL(env.WAE_MEDIA_ENDPOINT || ""); }
  catch { return null; }
  const local = env.NODE_ENV === "test" && env.WAE_MEDIA_ALLOW_LOCAL_TEST === "true" &&
    endpoint.protocol === "http:" && ["127.0.0.1","localhost"].includes(endpoint.hostname);
  if (!(endpoint.protocol === "https:" || local) || endpoint.pathname !== "/" ||
      endpoint.search || endpoint.hash || endpoint.username || endpoint.password ||
      !/^[a-z0-9][a-z0-9.-]{2,61}[a-z0-9]$/.test(env.WAE_MEDIA_BUCKET || "") ||
      !/^[a-z0-9-]{2,40}$/.test(env.WAE_MEDIA_REGION || "") ||
      !/^[A-Za-z0-9_/+=-]{8,128}$/.test(env.WAE_MEDIA_ACCESS_KEY_ID || "") ||
      typeof env.WAE_MEDIA_SECRET_ACCESS_KEY !== "string" ||
      env.WAE_MEDIA_SECRET_ACCESS_KEY.length < 20 ||
      env.WAE_MEDIA_SECRET_ACCESS_KEY.length > 256 ||
      /[\u0000-\u001f\u007f]/.test(env.WAE_MEDIA_SECRET_ACCESS_KEY))
    return null;
  return {
    origin:endpoint.origin, bucket:env.WAE_MEDIA_BUCKET,
    region:env.WAE_MEDIA_REGION, accessKey:env.WAE_MEDIA_ACCESS_KEY_ID,
    secret:env.WAE_MEDIA_SECRET_ACCESS_KEY
  };
}
function validKey(key) {
  return typeof key === "string" && /^marketplace\/[a-f0-9-]{36}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.jpg$/.test(key) &&
    key.split("/").slice(1,3).every(id => UUID.test(id));
}
function objectPath(config, key) {
  if (!validKey(key)) fail("media_key_invalid",400);
  return "/" + config.bucket + "/" + key.split("/").map(esc).join("/");
}
function signingKey(config, date) {
  let key = hmac("AWS4" + config.secret, date);
  for (const part of [config.region,"s3","aws4_request"]) key = hmac(key, part);
  return key;
}
function dates(now) {
  const amz = new Date(now).toISOString().replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
  return { amz, day:amz.slice(0,8) };
}
function scope(config, day) {
  return day + "/" + config.region + "/s3/aws4_request";
}
export function decodeMarketPhoto(data) {
  if (typeof data !== "string" || data.length > MAX_MEDIA_BYTES * 1.4 + 100)
    fail("media_too_large",413);
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if (!match) fail("media_format",422);
  const bytes = Buffer.from(match[1],"base64");
  if (bytes.length < 8 || bytes.length > MAX_MEDIA_BYTES ||
      bytes.toString("base64") !== match[1] ||
      bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff ||
      bytes[bytes.length-2] !== 0xff || bytes[bytes.length-1] !== 0xd9)
    fail("media_format",422);
  return bytes;
}
export function makeMediaKey(businessId, listingId) {
  if (!UUID.test(businessId || "") || !UUID.test(listingId || ""))
    fail("media_key_invalid",400);
  return "marketplace/" + businessId.toLowerCase() + "/" +
    listingId.toLowerCase() + "/" + randomUUID() + ".jpg";
}
function host(config) { return new URL(config.origin).host; }
export function presignedMarketImage(config, key, now = Date.now()) {
  if (!config) fail("media_unavailable",503);
  const path=objectPath(config,key);
  const { amz, day }=dates(now), credentialScope=scope(config,day);
  const query=[
    ["X-Amz-Algorithm","AWS4-HMAC-SHA256"],
    ["X-Amz-Credential",config.accessKey + "/" + credentialScope],
    ["X-Amz-Date",amz],["X-Amz-Expires","120"],
    ["X-Amz-SignedHeaders","host"]
  ].sort(([a],[b])=>a.localeCompare(b,"en")).map(([a,b])=>esc(a)+"="+esc(b)).join("&");
  const request="GET\n"+path+"\n"+query+"\nhost:"+host(config)+"\n\nhost\nUNSIGNED-PAYLOAD";
  const toSign="AWS4-HMAC-SHA256\n"+amz+"\n"+credentialScope+"\n"+hex(request);
  const signature=createHmac("sha256",signingKey(config,day)).update(toSign).digest("hex");
  return config.origin + path + "?" + query + "&X-Amz-Signature=" + signature;
}
export async function putMarketImage(config, key, bytes, transport = fetch, now = Date.now(),
    { ifAbsent = false } = {}) {
  if (!config) fail("media_unavailable",503);
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_MEDIA_BYTES || !bytes.length)
    fail("media_too_large",413);
  const path=objectPath(config,key);
  const {amz,day}=dates(now), credentialScope=scope(config,day);
  const payloadHash=hex(bytes), endpointHost=host(config);
  const canonicalHeaders="content-type:image/jpeg\nhost:"+endpointHost+
    (ifAbsent?"\nif-none-match:*":"")+
    "\nx-amz-content-sha256:"+payloadHash+"\nx-amz-date:"+amz+"\n";
  const signedHeaders="content-type;host;"+
    (ifAbsent?"if-none-match;":"")+"x-amz-content-sha256;x-amz-date";
  const request="PUT\n"+path+"\n\n"+canonicalHeaders+"\n"+signedHeaders+"\n"+payloadHash;
  const toSign="AWS4-HMAC-SHA256\n"+amz+"\n"+credentialScope+"\n"+hex(request);
  const signature=createHmac("sha256",signingKey(config,day)).update(toSign).digest("hex");
  let response;
  try {
    response=await transport(config.origin+path,{
      method:"PUT",headers:{
        "content-type":"image/jpeg",...(ifAbsent?{"if-none-match":"*"}:{}),
        "x-amz-content-sha256":payloadHash,"x-amz-date":amz,
        authorization:"AWS4-HMAC-SHA256 Credential="+config.accessKey+"/"+credentialScope+
          ", SignedHeaders="+signedHeaders+", Signature="+signature
      },body:bytes,redirect:"manual",signal:AbortSignal.timeout(12000)
    });
  } catch { fail("media_provider_unavailable",503); }
  if(ifAbsent&&response.status===412)fail("media_object_already_exists",409);
  if (![200,201,204].includes(response.status)) fail("media_provider_unavailable",503);
  return { key, contentType:"image/jpeg", size:bytes.length, checksum:payloadHash };
}
// RC20 restore-only conditional PUT; no blind overwrites.
export const putMarketImageIfAbsent=(config,key,bytes,transport=fetch,now=Date.now())=>
  putMarketImage(config,key,bytes,transport,now,{ifAbsent:true});

export async function deleteMarketImage(config,key,transport=fetch,now=Date.now()) {
  if (!config) fail("media_unavailable",503);
  const path=objectPath(config,key);
  const {amz,day}=dates(now),credentialScope=scope(config,day);
  const payloadHash=hex(Buffer.alloc(0)),endpointHost=host(config);
  const canonicalHeaders="host:"+endpointHost+"\nx-amz-content-sha256:"+payloadHash+
    "\nx-amz-date:"+amz+"\n";
  const signedHeaders="host;x-amz-content-sha256;x-amz-date";
  const request="DELETE\n"+path+"\n\n"+canonicalHeaders+"\n"+signedHeaders+"\n"+payloadHash;
  const toSign="AWS4-HMAC-SHA256\n"+amz+"\n"+credentialScope+"\n"+hex(request);
  const signature=createHmac("sha256",signingKey(config,day)).update(toSign).digest("hex");
  let response;
  try {
    response=await transport(config.origin+path,{method:"DELETE",
      headers:{"x-amz-content-sha256":payloadHash,"x-amz-date":amz,
        authorization:"AWS4-HMAC-SHA256 Credential="+config.accessKey+"/"+credentialScope+
        ", SignedHeaders="+signedHeaders+", Signature="+signature},
      redirect:"manual",signal:AbortSignal.timeout(12000)});
  } catch { fail("media_provider_unavailable",503); }
  if (![200,202,204].includes(response.status)) fail("media_provider_unavailable",503);
  return {removed:true};
}
export const imageUrl = (businessId,listingId) => "/api/marketplace/images/"+
  encodeURIComponent(businessId)+"/"+encodeURIComponent(listingId);
export const ownerImageUrl = (businessId,listingId) => "/api/businesses/"+
  encodeURIComponent(businessId)+"/listings/"+encodeURIComponent(listingId)+"/image";
export const MAX_MARKET_MEDIA_BYTES = MAX_MEDIA_BYTES;

// RC17: READ-ONLY object existence/size probe. Does not verify bytes, retention or backups.
// The result intentionally contains no object key, provider URL or credentials.
export async function headMarketImage(config, key, transport=fetch, now=Date.now()) {
  if (!config) fail("media_unavailable",503);
  const path=objectPath(config,key);
  const {amz,day}=dates(now), credentialScope=scope(config,day);
  const payloadHash=hex(Buffer.alloc(0)),endpointHost=host(config);
  const canonicalHeaders="host:"+endpointHost+"\nx-amz-content-sha256:"+payloadHash+
    "\nx-amz-date:"+amz+"\n";
  const signedHeaders="host;x-amz-content-sha256;x-amz-date";
  const request="HEAD\n"+path+"\n\n"+canonicalHeaders+"\n"+signedHeaders+"\n"+payloadHash;
  const toSign="AWS4-HMAC-SHA256\n"+amz+"\n"+credentialScope+"\n"+hex(request);
  const signature=createHmac("sha256",signingKey(config,day)).update(toSign).digest("hex");
  let response;
  try {
    response=await transport(config.origin+path,{
      method:"HEAD",headers:{"x-amz-content-sha256":payloadHash,"x-amz-date":amz,
        authorization:"AWS4-HMAC-SHA256 Credential="+config.accessKey+"/"+credentialScope+
        ", SignedHeaders="+signedHeaders+", Signature="+signature},
      redirect:"manual",signal:AbortSignal.timeout(12000)
    });
  } catch { return {state:"unavailable"}; }
  if(response.status===404)return {state:"missing"};
  if(response.status===401||response.status===403)return {state:"denied"};
  if(response.status!==200)return {state:"unavailable"};
  const length=Number(response.headers.get("content-length"));
  if(!Number.isSafeInteger(length)||length<8||length>MAX_MEDIA_BYTES)
    return {state:"invalid_size"};
  return {state:"present"};
}

