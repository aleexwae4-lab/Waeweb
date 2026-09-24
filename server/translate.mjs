// WAEWEB text-only translation gateway. No chat/vault text, persistence,
// automatic requests or provider secrets are exposed to the frontend.
const languages = Object.freeze({
  es:"Español",en:"Inglés",fr:"Francés",de:"Alemán",it:"Italiano",
  pt:"Portugués",ja:"Japonés",ko:"Coreano",zh:"Chino",ar:"Árabe",
  ru:"Ruso",hi:"Hindi",nl:"Neerlandés",tr:"Turco"
});
export const languageOptions = Object.entries(languages).map(([code,name])=>({code,name}));
const QUOTA_DEFAULT_SECONDS=300, QUOTA_MAX_SECONDS=600;
let quota={provider:null,until:0};
const remainingQuota=provider=>quota.provider===provider
  ?Math.max(0,Math.ceil((quota.until-Date.now())/1000)):0;
function quotaSeconds(header){
  if(header==null||String(header).trim()==="")return QUOTA_DEFAULT_SECONDS;
  const parsed=Number(header);
  if(Number.isFinite(parsed)&&parsed>=0)return Math.max(30,Math.min(QUOTA_MAX_SECONDS,Math.ceil(parsed)));
  const date=Date.parse(String(header||""));
  if(Number.isFinite(date))return Math.max(30,Math.min(QUOTA_MAX_SECONDS,
    Math.ceil((date-Date.now())/1000)));
  return QUOTA_DEFAULT_SECONDS;
}
function pauseProvider(provider,seconds=QUOTA_DEFAULT_SECONDS){
  const wait=Math.max(30,Math.min(QUOTA_MAX_SECONDS,seconds));
  quota={provider,until:Date.now()+wait*1000};
  return new TranslateError("provider_quota",
    "El servicio externo alcanzó su cuota. Intenta de nuevo más tarde o usa traducción local.",429,wait);
}
// In-process breaker (one instance only), never persisted and never used to
// claim that the upstream quota has recovered. Tests can reset it explicitly.
export function resetTranslationCooldown(){quota={provider:null,until:0};}

export class TranslateError extends Error {
  constructor(code,message,status=400,retryAfterSeconds=0){
    super(message);this.code=code;this.status=status;
    this.retryAfterSeconds=retryAfterSeconds;
  }
}
export function translatorConfig() {
  const requested=(process.env.WAE_TRANSLATE_PROVIDER||"mymemory").trim().toLowerCase();
  if (requested==="off") return {provider:"off",available:false,autoDetect:false,maxBytes:0};
  if (requested==="libretranslate") {
    const raw=process.env.WAE_TRANSLATE_URL?.trim();
    if (!raw) return {provider:"libretranslate",available:false,autoDetect:true,maxBytes:6000};
    let u;
    try {u=new URL(raw);} catch {return {provider:"libretranslate",available:false,autoDetect:true,maxBytes:6000};}
    const local = process.env.WAE_TRANSLATE_ALLOW_LOCAL === "true" &&
      ["127.0.0.1","localhost","::1","[::1]"].includes(u.hostname);
    const valid = (u.protocol==="https:" || (u.protocol==="http:" && local)) &&
      !u.username && !u.password && !u.search && !u.hash;
    return {provider:"libretranslate",available:valid,autoDetect:true,maxBytes:6000};
  }
  // Short, explicitly submitted text only. Public MyMemory has low quotas;
  // no anonymous bulk service or false promises of unlimited translation.
  if(requested==="mymemory") return {provider:"mymemory",available:true,autoDetect:false,maxBytes:450};
  return {provider:"off",available:false,autoDetect:false,maxBytes:0};
}
export function publicTranslateConfig() {
  const {provider,available,autoDetect,maxBytes}=translatorConfig();
  const retryAfterSeconds=available?remainingQuota(provider):0;
  return {provider,available:available&&!retryAfterSeconds,
    configured:available,quotaLimited:retryAfterSeconds>0,retryAfterSeconds,
    autoDetect,maxBytes,languages:languageOptions,
    privacy:"El texto se envía al proveedor externo únicamente cuando pulsas Traducir. No introduzcas datos confidenciales."};
}
function validate(payload,config) {
  if (!payload || typeof payload!=="object" || Array.isArray(payload))
    throw new TranslateError("invalid_request","Se requiere un objeto JSON.");
  const {text,source,target}=payload;
  if (typeof text!=="string" || !text.trim())
    throw new TranslateError("empty_text","Escribe texto para traducir.");
  if (typeof source!=="string" || typeof target!=="string" ||
      !(source==="auto"&&config.autoDetect || Object.hasOwn(languages,source)) ||
      !Object.hasOwn(languages,target))
    throw new TranslateError("invalid_language","Selecciona idiomas disponibles para el proveedor.");
  if (source===target)
    throw new TranslateError("same_language","Elige dos idiomas diferentes.");
  const bytes=Buffer.byteLength(text,"utf8");
  if(bytes>config.maxBytes)
    throw new TranslateError("text_too_long","El proveedor admite un máximo de "+config.maxBytes+" bytes por solicitud.");
  if(bytes<1)throw new TranslateError("empty_text","Escribe texto para traducir.");
  return {text,source,target};
}
async function jsonResponse(url,options) {
  let response,body;
  try {
    const {provider,...requestOptions}=options;
    response=await fetch(url,{...requestOptions,redirect:"error",signal:AbortSignal.timeout(9000)});
    if(response.status===429)throw pauseProvider(options.provider,
      quotaSeconds(response.headers.get("retry-after")));
    if(!response.ok)throw new TranslateError("provider_unavailable","El proveedor de traducción no respondió correctamente.",502);
    body=await response.text();
    if(body.length>150000)throw new TranslateError("invalid_provider_response","Respuesta del proveedor demasiado grande.",502);
    return JSON.parse(body);
  }catch(error){
    if(error instanceof TranslateError)throw error;
    throw new TranslateError("provider_unavailable","La traducción no está disponible en este momento.",502);
  }
}
export async function translateText(payload) {
  const config=translatorConfig();
  if(!config.available)throw new TranslateError("translator_unavailable",
    "El motor de traducción está desactivado o no está configurado.",503);
  const {text,source,target}=validate(payload,config);
  const retryAfterSeconds=remainingQuota(config.provider);
  if(retryAfterSeconds)throw new TranslateError("provider_quota",
    "El proveedor alcanzó su cuota. Prueba el motor local o inténtalo más tarde.",429,
    retryAfterSeconds);
  if(config.provider==="mymemory"){
    const url=new URL("https://api.mymemory.translated.net/get");
    url.search=new URLSearchParams({q:text,langpair:source+"|"+target}).toString();
    const data=await jsonResponse(url,{provider:"mymemory",headers:{accept:"application/json"}});
    if(Number(data.responseStatus)===429 || /quota|daily limit/i.test(String(data.responseDetails||"")))
      throw pauseProvider("mymemory");
    if(Number(data.responseStatus)!==200 || typeof data.responseData?.translatedText!=="string" ||
       !data.responseData.translatedText.trim())
      throw new TranslateError("provider_unavailable","El proveedor no devolvió una traducción válida.",502);
    return {translatedText:data.responseData.translatedText,source,target,
      detectedLanguage:null,provider:"MyMemory",sourceTextBytes:Buffer.byteLength(text,"utf8")};
  }
  const url=new URL(process.env.WAE_TRANSLATE_URL);
  url.pathname=url.pathname.replace(/\/+$/,"")+"/translate";
  const key=process.env.WAE_TRANSLATE_API_KEY?.trim();
  const body={q:text,source,target,format:"text"};
  if(key)body.api_key=key;
  const data=await jsonResponse(url,{
    provider:"libretranslate",method:"POST",
    headers:{"content-type":"application/json",accept:"application/json"},
    body:JSON.stringify(body)
  });
  if(typeof data.translatedText!=="string" || !data.translatedText.trim())
    throw new TranslateError("provider_unavailable","El proveedor no devolvió una traducción válida.",502);
  return {translatedText:data.translatedText,source,target,
    detectedLanguage:typeof data.detectedLanguage?.language==="string"
      ?data.detectedLanguage.language:null,
    provider:"LibreTranslate",sourceTextBytes:Buffer.byteLength(text,"utf8")};
}
