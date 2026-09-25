// WAEWEB text-only translation gateway. No chat/vault text, persistence,
// automatic requests or provider secrets are exposed to the frontend.
import {guardedProvider,providerCircuitSnapshot,ProviderCircuitOpenError} from "./provider-resilience.mjs";
const languages = Object.freeze({
  es:"Español",en:"Inglés",fr:"Francés",de:"Alemán",it:"Italiano",
  pt:"Portugués",ja:"Japonés",ko:"Coreano",zh:"Chino",ar:"Árabe",
  ru:"Ruso",hi:"Hindi",nl:"Neerlandés",tr:"Turco"
});
export const languageOptions = Object.entries(languages).map(([code,name])=>({code,name}));
const QUOTA_DEFAULT_SECONDS=300, QUOTA_MAX_SECONDS=600;
const quotas=new Map();
const remainingQuota=provider=>Math.max(0,Math.ceil(((quotas.get(provider)||0)-Date.now())/1000));
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
  quotas.set(provider,Date.now()+wait*1000);
  return new TranslateError("provider_quota",
    "El servicio externo alcanzó su cuota. Intenta de nuevo más tarde o usa traducción local.",429,wait);
}
// In-process breaker (one instance only), never persisted and never used to
// claim that the upstream quota has recovered. Tests can reset it explicitly.
export function resetTranslationCooldown(){quotas.clear();}

export class TranslateError extends Error {
  constructor(code,message,status=400,retryAfterSeconds=0){
    super(message);this.code=code;this.status=status;
    this.retryAfterSeconds=retryAfterSeconds;
  }
}
function providerConfig(provider){
  if(provider==="libretranslate"){
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
  if(provider==="mymemory")return {provider:"mymemory",available:true,autoDetect:false,maxBytes:450};
  return {provider:"off",available:false,autoDetect:false,maxBytes:0};
}
export function translatorConfig() {
  const requested=(process.env.WAE_TRANSLATE_PROVIDER||"auto").trim().toLowerCase();
  if(requested==="off")return {...providerConfig("off"),mode:"off",chain:[]};
  if(["libretranslate","mymemory"].includes(requested)){
    const exact=providerConfig(requested);
    return {...exact,mode:"explicit",chain:exact.available?[requested]:[]};
  }
  if(requested!=="auto")return {...providerConfig("off"),mode:"off",chain:[]};
  // Prefer an operator-controlled LibreTranslate instance. MyMemory remains a
  // separate, keyless fallback for short explicit-language requests.
  const libre=providerConfig("libretranslate"),memory=providerConfig("mymemory");
  const chain=[...(libre.available?["libretranslate"]:[]),"mymemory"];
  const primary=providerConfig(chain[0]);
  return {...primary,mode:"auto",chain,available:true,
    autoDetect:libre.available,maxBytes:libre.available?6000:memory.maxBytes};
}
export function publicTranslateConfig() {
  const config=translatorConfig();
  const providerStates=(config.chain||[]).map(name=>{
    const item=providerConfig(name),retryAfterSeconds=remainingQuota(name);
    const runtime=name==="libretranslate"
      ?providerCircuitSnapshot("libretranslate",{configured:item.available})
      :{state:retryAfterSeconds?"quota_limited":"idle"};
    return {provider:name,available:item.available&&!retryAfterSeconds&&runtime.state!=="circuit_open",
      configured:item.available,quotaLimited:retryAfterSeconds>0,
      retryAfterSeconds:Math.max(retryAfterSeconds,runtime.retryAfterSeconds||0),
      runtimeState:runtime.state,autoDetect:item.autoDetect,maxBytes:item.maxBytes};
  });
  const usable=providerStates.filter(item=>item.available);
  const waits=providerStates.map(item=>item.retryAfterSeconds).filter(Boolean);
  const retryAfterSeconds=usable.length||!waits.length?0:Math.min(...waits);
  return {provider:config.provider,mode:config.mode,providers:providerStates,
    redundancy:providerStates.length>1,available:usable.length>0,
    configured:config.available,quotaLimited:!usable.length&&providerStates.some(item=>item.quotaLimited),retryAfterSeconds,
    autoDetect:config.autoDetect,maxBytes:config.maxBytes,
    languages:languageOptions,
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
  const runMyMemory=async()=>{
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
  };
  const runLibre=async()=>{
    const execute=async()=>{
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
    };
    try{
      return await guardedProvider("libretranslate",execute,{
        threshold:2,cooldownMs:60_000,
        retryable:error=>["provider_quota","provider_unavailable","invalid_provider_response"].includes(error?.code)||
          /fetch|timeout|abort/i.test(String(error?.message||""))
      });
    }catch(error){
      if(error instanceof ProviderCircuitOpenError)
        throw new TranslateError("provider_unavailable",
          "LibreTranslate está temporalmente en recuperación; se intentará el respaldo disponible.",503,error.retryAfterSeconds);
      throw error;
    }
  };
  let lastError=null,compatible=0;
  for(const provider of config.chain||[]){
    const candidate=providerConfig(provider),bytes=Buffer.byteLength(text,"utf8");
    if(!candidate.available||bytes>candidate.maxBytes||source==="auto"&&!candidate.autoDetect)continue;
    compatible++;
    const retryAfterSeconds=remainingQuota(provider);
    if(retryAfterSeconds){
      lastError=new TranslateError("provider_quota",
        "El proveedor alcanzó su cuota. Prueba el motor local o inténtalo más tarde.",429,retryAfterSeconds);
      continue;
    }
    try{return provider==="mymemory"?await runMyMemory():await runLibre();}
    catch(error){
      if(!(error instanceof TranslateError))throw error;
      lastError=error;
      if(!["provider_quota","provider_unavailable","invalid_provider_response"].includes(error.code))throw error;
    }
  }
  if(lastError)throw lastError;
  if(!compatible)throw new TranslateError("translator_unavailable",
    source==="auto"?"La detección automática necesita LibreTranslate configurado.":
      "Ningún proveedor disponible admite el tamaño de este texto.",503);
  throw new TranslateError("provider_unavailable","La traducción no está disponible en este momento.",502);
}
