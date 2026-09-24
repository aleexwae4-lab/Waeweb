// Public, explicitly package-scoped discovery. This is npm registry
// metadata, NOT web-wide search and NOT a guessed npm package link.
const LABEL="npm · paquetes publicados";
const pending=new Map();
const fold=value=>String(value??"").normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
export function npmPackageIntentTerms(input){
  const raw=String(input??"").trim();
  const q=fold(raw);
  if(!q||raw.length>140||!(/\bnpm\b/.test(q)&&
    /\b(?:paquetes?|librerias?|bibliotecas?|packages?|libraries?)\b/.test(q)))
    return null;
  const terms=raw.replace(/\b(?:npm|paquetes?|librer[ií]as?|bibliotecas?|packages?|libraries?|de|del|para|en|sobre|for|with|using|con)\b/gi,"")
    .replace(/\s+/g," ").trim();
  // A naked "npm packages" is not permission to show unrelated software.
  return terms.length>=2&&/[\p{L}\p{N}]/u.test(terms)?terms:null;
}
export function npmPublicPackages(terms){
  const query=String(terms??"").trim();
  if(query.length<2||query.length>140)return Promise.resolve([]);
  if(pending.has(query))return pending.get(query);
  const task=loadPackages(query);
  pending.set(query,task);
  void task.then(()=>{if(pending.get(query)===task)pending.delete(query);},
    ()=>{if(pending.get(query)===task)pending.delete(query);});
  return task;
}
export function normalizeNpmPackage(item){
  const pkg=item?.package;
  if(!pkg||typeof pkg!=="object")return null;
  const name=String(pkg.name??"");
  if(!/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name)||
    name.length>214)return null;
  const claimed=pkg.links?.npm;
  if(typeof claimed!=="string")return null;
  let url;
  try{
    const u=new URL(claimed);
    if(u.protocol!=="https:"||u.hostname!=="www.npmjs.com"||
      u.username||u.password||u.port||u.search||u.hash||
      !u.pathname.startsWith("/package/")||
      decodeURIComponent(u.pathname.slice("/package/".length))!==name)
      return null;
    url=u.href;
  }catch{return null;}
  const cleaned=value=>String(value??"").replace(/<[^>]*>/g," ")
    .replace(/\s+/g," ").trim();
  const desc=cleaned(pkg.description).slice(0,550);
  const version=typeof pkg.version==="string"&&
    /^[0-9A-Za-z.+-]{1,70}$/.test(pkg.version)?pkg.version:null;
  return {
    title:name,url,source:LABEL,
    snippet:[desc,version?"Versión publicada: "+version:null]
      .filter(Boolean).join(" · ").slice(0,700),
    date:null,image:null,indexedScope:"package_registry_metadata_only",
    provenanceUrl:"https://registry.npmjs.org/"
  };
}
async function loadPackages(query){
  const endpoint=new URL("https://registry.npmjs.org/-/v1/search");
  endpoint.search=new URLSearchParams({text:query,size:"10",from:"0"}).toString();
  const response=await fetch(endpoint,{headers:{accept:"application/json",
    "user-agent":"WAE-Web/1.0 (+https://github.com/aleexwae4-lab/Waeweb)"},
    redirect:"error",signal:AbortSignal.timeout(5500)});
  if(!response.ok)throw Error("npm_registry_status_"+response.status);
  const body=await response.text();
  if(body.length>1100000)throw Error("npm_registry_too_large");
  const data=JSON.parse(body);
  if(!Array.isArray(data.objects))throw Error("npm_registry_invalid_response");
  return data.objects.slice(0,10).map(normalizeNpmPackage)
    .filter(Boolean).slice(0,8);
}
