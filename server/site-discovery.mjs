// Navigational sites are NOT a replacement for a general web index.
// Directory entries are a small, explicitly curated fallback; arbitrary
// organisations are discovered only from Wikidata P856 source records.
const fold=value=>String(value??"").normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("es")
  .replace(/\s+/g," ").trim();
export function navigationalName(query){
  const raw=fold(query);
  if(!raw||raw.length>120||/["]|(?:^|\s)(?:site:|source:|after:|before:)/.test(raw))
    return null;
  const prefix=/^(?:ir a|visitar|abrir|entrar a|buscar|portal oficial|sitio web|sitio oficial|sitio|pagina web|pagina oficial|web oficial|web|pagina|oficial)\s+(?:de\s+|del\s+|la\s+|el\s+)?/;
  const suffix=/\s+(?:pagina oficial|sitio oficial|web oficial|pagina web|sitio web|oficial)$/;
  const explicit=prefix.test(raw)||suffix.test(raw);
  const name=raw.replace(prefix,"").replace(suffix,"").trim();
  // Long institution names can be searched directly; other long, topical
  // questions require explicit website intent before requesting P856.
  const institution=/^(?:instituto|universidad|secretaria|ministerio|gobierno|museo|hospital|fundacion|university|national|world health)\b/.test(name);
  const longName=explicit||institution;
  if(!name||name.split(/\s+/).length>(longName?9:4)||
    name.length>(longName?100:60)||
    !/^[\p{L}\p{N} .&+-]+$/u.test(name))return null;
  return name;
}
// Only clearly navigational intent or a short, exact brand name triggers
// an extra remote early lookup. Topical queries keep their existing federation.
export function earlyWikidataSiteEligible(query){
  const raw=fold(query),name=navigationalName(query);
  if(!name||directorySites(query).length)return false;
  const explicit=/^(?:ir a|visitar|abrir|entrar a|buscar|portal oficial|sitio web|sitio oficial|sitio|pagina web|pagina oficial|web oficial|web|pagina|oficial)\s/.test(raw)||
    /\s(?:pagina oficial|sitio oficial|web oficial|pagina web|sitio web|oficial)$/.test(raw);
  const institution=/^(?:instituto|universidad|secretaria|ministerio|gobierno|museo|hospital|fundacion|university|national|world health)\b/.test(name);
  return explicit||institution||(name.length>=3&&name.length<=45&&
    /^[\p{L}\p{N}.&+-]+$/u.test(name));
}
export function publicSiteUrl(value){
  try{
    const u=new URL(value);
    const host=u.hostname.toLowerCase().replace(/\.$/,"");
    if(u.protocol!=="https:"||u.username||u.password||
      (u.port&&u.port!=="443")||!host.includes(".")||
      !/^[a-z0-9.-]+$/.test(host)||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(host)||
      /^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)||u.href.length>1400)return null;
    u.hash="";return u.href;
  }catch{return null;}
}
const DIRECTORY=[
  ["GitHub","https://github.com/","Plataforma para proyectos y repositorios de software",["github"]],
  ["Mercado Libre México","https://www.mercadolibre.com.mx/","Comercio electrónico · sitio de México",["mercado libre","mercadolibre","mercado livre","mercado libre mexico","mercado libre mx","mercadolibre mexico","mercadolibre mx"]],
  ["Facebook","https://www.facebook.com/","Red social",["facebook","fb"]],
  ["Instagram","https://www.instagram.com/","Red social y contenido visual",["instagram"]],
  ["TikTok","https://www.tiktok.com/","Red social de vídeo",["tiktok","tik tok"]],
  ["YouTube","https://www.youtube.com/","Plataforma de vídeos",["youtube","you tube"]],
  ["LinkedIn","https://www.linkedin.com/","Red profesional",["linkedin"]],
  ["X","https://x.com/","Red social anteriormente Twitter",["x","twitter","x twitter"]],
  ["WhatsApp","https://www.whatsapp.com/","Mensajería",["whatsapp","whats app"]],
  ["Reddit","https://www.reddit.com/","Comunidades y discusión",["reddit"]],
  ["Google","https://www.google.com/","Buscador web",["google"]],
  ["GitLab","https://gitlab.com/","Plataforma de proyectos y repositorios de software",["gitlab"]],
  ["Pinterest","https://www.pinterest.com/","Colecciones y descubrimiento visual",["pinterest"]],
  ["OpenAI","https://openai.com/","Sitio de la organización de inteligencia artificial",["openai"]],
  ["NASA","https://www.nasa.gov/","Portal de la agencia espacial de Estados Unidos",["nasa"]],
  ["Amazon México","https://www.amazon.com.mx/","Comercio electrónico · sitio de México",["amazon mexico","amazon mx","amazon"]],
  ["UNAM","https://www.unam.mx/","Universidad Nacional Autónoma de México",["unam"]]
];
export function directorySites(query){
  const name=navigationalName(query);
  if(!name)return [];
  return DIRECTORY.filter(([,url,,aliases])=>aliases.includes(name)||
    fold(new URL(url).hostname.replace(/^www\./,""))===name)
    .map(([title,url,description])=>({
      title,url,snippet:description+" · Enlace del directorio WAE WEB; disponibilidad no comprobada en tiempo real.",
      source:"WAE WEB · directorio navegacional",date:null,image:null,
      siteLink:true,linkBasis:"curated_directory",indexedScope:"limited_named_sites"
    }));
}
function matchingName(entity,query){
  const names=[...Object.values(entity.labels||{}).map(v=>v?.value),
    ...Object.values(entity.aliases||{}).flatMap(arr=>
      Array.isArray(arr)?arr.map(x=>x?.value):[])];
  return names.some(value=>fold(value)===query);
}
export function wikidataSiteRecords(data,query){
  const name=navigationalName(query);
  if(!name||!data||typeof data.entities!=="object")return [];
  const results=[];
  for(const [id,entity] of Object.entries(data.entities)){
    if(!/^Q[1-9]\d*$/.test(id)||!entity||entity.missing||
      !matchingName(entity,name))continue;
    const record=(entity.claims?.P856||[]).find(value=>
      value.rank!=="deprecated"&&
      publicSiteUrl(value.mainsnak?.datavalue?.value));
    const url=publicSiteUrl(record?.mainsnak?.datavalue?.value);
    if(!url)continue;
    const label=entity.labels?.es?.value||entity.labels?.en?.value||
      Object.values(entity.labels||{})[0]?.value||name;
    const description=entity.descriptions?.es?.value||
      entity.descriptions?.en?.value||"Sitio web asociado a esta entidad";
    results.push({
      title:String(label).slice(0,240),url,
      snippet:String(description).slice(0,500)+
        " · Enlace declarado en Wikidata (P856); WAE WEB no verifica la titularidad ni disponibilidad.",
      source:"Wikidata · sitio web declarado",date:null,image:null,
      siteLink:true,linkBasis:"wikidata_P856",
      provenanceUrl:"https://www.wikidata.org/wiki/"+id
    });
    if(results.length>=4)break;
  }
  return results;
}
async function sourceJson(url){
  const response=await fetch(url,{headers:{accept:"application/json",
    "user-agent":"WAE-Web/1.0 (+https://github.com/aleexwae4-lab/Waeweb)"},
    signal:AbortSignal.timeout(3000)});
  if(!response.ok)throw Error("wikidata_sites_status_"+response.status);
  const raw=await response.text();
  if(raw.length>900000)throw Error("wikidata_sites_too_large");
  return JSON.parse(raw);
}
// Coalesce identical in-flight P856 requests from the instant lookup and
// the full SERP. No result or outage is cached after the request settles.
const inFlightSites=new Map();
export function wikidataOfficialSites(query){
  const name=navigationalName(query);
  if(!name)return Promise.resolve([]);
  if(inFlightSites.has(name))return inFlightSites.get(name);
  const task=loadWikidataOfficialSites(name);
  inFlightSites.set(name,task);
  void task.then(()=>{if(inFlightSites.get(name)===task)inFlightSites.delete(name);},
    ()=>{if(inFlightSites.get(name)===task)inFlightSites.delete(name);});
  return task;
}
async function loadWikidataOfficialSites(query){
  const name=navigationalName(query);
  if(!name)return [];
  // Query the two Wikidata name indexes concurrently: an institution can
  // have no Spanish search entry even when its English label is an exact
  // match. One language outage must not discard the other language's hits.
  const searches=["es","en"].map(language=>{
    const url=new URL("https://www.wikidata.org/w/api.php");
    url.search=new URLSearchParams({action:"wbsearchentities",
      search:name,language,uselang:language,limit:"5",format:"json"}).toString();
    return sourceJson(url);
  });
  const found=await Promise.allSettled(searches);
  if(found.every(value=>value.status==="rejected"))
    throw Error("wikidata_sites_search_unavailable");
  const ids=[...new Set(found.flatMap(value=>
    value.status==="fulfilled"&&Array.isArray(value.value?.search)
      ?value.value.search.map(item=>item.id):[])
    .filter(id=>/^Q[1-9]\d*$/.test(id||"")))].slice(0,8);
  if(!ids.length)return [];
  const details=new URL("https://www.wikidata.org/w/api.php");
  details.search=new URLSearchParams({action:"wbgetentities",ids:ids.join("|"),
    props:"labels|descriptions|aliases|claims",
    languages:"es|en",languagefallback:"1",format:"json"}).toString();
  return wikidataSiteRecords(await sourceJson(details),name);
}
