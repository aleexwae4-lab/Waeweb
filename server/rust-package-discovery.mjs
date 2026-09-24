// Source-attributed discovery from the public Cargo crate registry.
// These entries are package metadata, never general Internet search results.
export const CRATES_SOURCE="crates.io · paquetes Rust";
const pending=new Map();
const fold=value=>String(value??"").normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").toLowerCase();
const ASK=/\b(?:crates(?:\.io)?|paquetes?|librerias?|bibliotecas?|packages?)\b/;
const RUST=/\b(?:rust|cargo|crates(?:\.io)?)\b/;
export function rustPackageIntentTerms(input){
  const query=String(input??"").trim();
  const normalized=fold(query);
  if(query.length>140||!ASK.test(normalized)||!RUST.test(normalized)||
    /\b(?:npm|pypi|python|javascript|typescript|github|gitlab)\b/.test(normalized))
    return null;
  const terms=query.normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .replace(/\b(?:rust|cargo|crates(?:\.io)?|paquetes?|librerias?|bibliotecas?|packages?|para|de|del|en|for|with|using|con|sobre|of)\b/gi," ")
    .replace(/\s+/g," ").trim();
  return terms.length>=2?terms:null;
}
export function normalizeRustCrate(crate){
  if(!crate||typeof crate!=="object")return null;
  const name=String(crate.name??"");
  if(name.length>64||!/^[a-z][a-z0-9_-]*$/i.test(name)||
    name==="."||name==="..")return null;
  if(crate.id!==undefined&&crate.id!==name)return null;
  const url="https://crates.io/crates/"+encodeURIComponent(name);
  const clean=value=>String(value??"").replace(/<[^>]*>/g," ")
    .replace(/\s+/g," ").trim();
  const version=typeof crate.max_version==="string"
    ?clean(crate.max_version).slice(0,50):"";
  const downloads=Number.isSafeInteger(crate.downloads)&&crate.downloads>=0
    ?crate.downloads:null;
  const snippet=[clean(crate.description).slice(0,520),
    version?"Versión publicada: "+version:null,
    downloads!==null?"Descargas registradas: "+downloads:null]
    .filter(Boolean).join(" · ");
  return {title:name,url,snippet:snippet.slice(0,700),
    source:CRATES_SOURCE,date:null,image:null,
    indexedScope:"package_registry_metadata_only"};
}
export function rustPublicCrates(query){
  const key=String(query??"").trim();
  if(key.length<2||key.length>140)return Promise.resolve([]);
  if(pending.has(key))return pending.get(key);
  const task=loadCrates(key);
  pending.set(key,task);
  void task.then(()=>{if(pending.get(key)===task)pending.delete(key);},
    ()=>{if(pending.get(key)===task)pending.delete(key);});
  return task;
}
async function loadCrates(query){
  const target=new URL("https://crates.io/api/v1/crates");
  target.search=new URLSearchParams({q:query,per_page:"10"}).toString();
  const response=await fetch(target,{headers:{accept:"application/json",
    "user-agent":"WAE-Web/1.0 (+https://github.com/aleexwae4-lab/Waeweb)"},
    redirect:"error",signal:AbortSignal.timeout(5600)});
  if(!response.ok)throw Error("crates_status_"+response.status);
  const body=await response.text();
  if(body.length>1100000)throw Error("crates_too_large");
  const data=JSON.parse(body);
  if(!Array.isArray(data.crates))throw Error("crates_invalid_response");
  return data.crates.slice(0,10).map(normalizeRustCrate).filter(Boolean).slice(0,8);
}
