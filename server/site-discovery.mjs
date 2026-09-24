// Navigational sites are NOT a replacement for a general web index.
// Directory entries are a small, explicitly curated fallback; arbitrary
// organisations are discovered only from Wikidata P856 source records.
const fold=value=>String(value??"").normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("es")
  .replace(/\s+/g," ").trim();
// Only explicit navigation verbs, not broad question semantics, remove
// conversational filler before exact-match brand or entity lookup.
const NAV_VERB=/^(?:(?:quiero|necesito|deseo)\s+(?:ir\s+a(?:l)?|visitar|abrir|entrar\s+(?:a(?:l)?|en)|acceder\s+a(?:l)?|navegar\s+a(?:l)?|buscar)|(?:llevame|dirigeme)\s+a(?:l)?|(?:abre|visita|entra\s+(?:a(?:l)?|en)|accede\s+a(?:l)?|navega\s+a(?:l)?)|ir\s+a(?:l)?|visitar|abrir|entrar\s+a(?:l)?|buscar)\s+/;
const NAV_PAGE=/^(?:(?:la|el)\s+)?(?:portal\s+oficial|sitio\s+web|sitio\s+oficial|sitio|pagina\s+web|pagina\s+oficial|pagina|web\s+oficial|web|oficial)\s+(?:de\s+|del\s+|la\s+|el\s+)?/;
export function navigationalName(query){
  const raw=fold(query);
  if(!raw||raw.length>120||/["]|(?:^|\s)(?:site:|source:|after:|before:)/.test(raw))
    return null;
  const suffix=/\s+(?:pagina oficial|sitio oficial|web oficial|pagina web|sitio web|oficial)$/;
  const explicit=NAV_VERB.test(raw)||NAV_PAGE.test(raw)||suffix.test(raw);
  const name=raw.replace(NAV_VERB,"").replace(NAV_PAGE,"").replace(suffix,"").trim();
  // Long institution names can be searched directly; other long, topical
  // questions require explicit website intent before requesting P856.
  const institution=/^(?:instituto|universidad|secretaria|ministerio|gobierno|museo|hospital|fundacion|diario oficial|university|national|world health)\b/.test(name);
  const longName=explicit||institution;
  // Unqualified multiword topical searches are not requests to visit a site.
  // Preserve exact named directory brands (e.g. Mercado Libre, Google Maps)
  // and explicit navigation for unknown multiword institutions/organizations.
  const directoryName=DIRECTORY.some(([,url,,aliases])=>aliases.includes(name)||
    fold(new URL(url).hostname.replace(/^www\./,""))===name.replace(/^www\./,""));
  if(!longName&&name.includes(" ")&&!directoryName)return null;
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
  const explicit=NAV_VERB.test(raw)||NAV_PAGE.test(raw)||
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
  ["Telcel México","https://www.telcel.com/","Telefonía móvil y servicios · portal de México",["telcel","telcel mexico","telcel mx"]],
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
  ["ChatGPT","https://chatgpt.com/","Asistente de inteligencia artificial",["chatgpt","chat gpt"]],
  ["Wikipedia en español","https://es.wikipedia.org/","Enciclopedia colaborativa en español",["wikipedia","wikipedia español","wikipedia en español"]],
  ["NASA","https://www.nasa.gov/","Portal de la agencia espacial de Estados Unidos",["nasa"]],
  ["Amazon México","https://www.amazon.com.mx/","Comercio electrónico · sitio de México",["amazon mexico","amazon mx","amazon"]],
  ["UNAM","https://www.unam.mx/","Universidad Nacional Autónoma de México",["unam"]],
  ["Gobierno de México","https://www.gob.mx/","Portal oficial de servicios e información del gobierno federal",["gob mx","gob.mx","gobierno de mexico","gobierno mexico"]],
  ["INEGI","https://www.inegi.org.mx/","Estadística y geografía de México",["inegi"]],
  ["Diario Oficial de la Federación","https://www.dof.gob.mx/","Publicación oficial de disposiciones federales",["dof","diario oficial de la federacion"]],
  ["Universidad de Guadalajara","https://www.udg.mx/","Portal de la Universidad de Guadalajara",["udg","universidad de guadalajara"]],
  ["Canva","https://www.canva.com/","Diseño visual y plantillas",["canva"]],
  ["Figma","https://www.figma.com/","Diseño de interfaces y colaboración",["figma"]],
  ["Stack Overflow","https://stackoverflow.com/","Comunidad de desarrollo de software",["stack overflow","stackoverflow"]],
  ["MDN Web Docs","https://developer.mozilla.org/","Documentación técnica para la web",["mdn","mdn web docs"]],
  ["npm","https://www.npmjs.com/","Registro público de paquetes JavaScript",["npm","npmjs"]],
  ["GitHub Docs","https://docs.github.com/","Documentación de GitHub",["github docs","documentacion github"]],
  ["Docker Hub","https://hub.docker.com/","Registro público de imágenes de contenedores",["docker hub"]],
  ["Google Maps","https://www.google.com/maps","Mapas y lugares",["google maps"]],
  ["Mercado Pago México","https://www.mercadopago.com.mx/","Servicios de pago digital",["mercado pago","mercadopago","mercado pago mexico"]],
  ["Microsoft","https://www.microsoft.com/es-mx/","Software y servicios",["microsoft"]],
  ["Apple México","https://www.apple.com/mx/","Tecnología y dispositivos",["apple","apple mexico"]],
  ["Netflix","https://www.netflix.com/mx/","Películas y series",["netflix"]],
  ["Zoom","https://zoom.us/","Videoconferencias",["zoom"]],
  ["Notion","https://www.notion.so/","Organización y productividad",["notion"]],
  ["Spotify","https://open.spotify.com/","Música y podcasts",["spotify"]],
  ["Telegram","https://telegram.org/","Mensajería",["telegram"]],
  ["IMSS","https://www.imss.gob.mx/","Instituto Mexicano del Seguro Social",["imss"]],
  ["SAT México","https://www.sat.gob.mx/","Servicio de Administración Tributaria de México",["sat","sat mexico"]]
];
export function directorySites(query){
  const name=navigationalName(query);
  if(!name)return [];
  const exactHost=name.replace(/^www\./,"");
  return DIRECTORY.filter(([,url,,aliases])=>aliases.includes(name)||
    fold(new URL(url).hostname.replace(/^www\./,""))===exactHost)
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
  const task=loadWikidataOfficialSites(name,query);
  inFlightSites.set(name,task);
  void task.then(()=>{if(inFlightSites.get(name)===task)inFlightSites.delete(name);},
    ()=>{if(inFlightSites.get(name)===task)inFlightSites.delete(name);});
  return task;
}
async function loadWikidataOfficialSites(name,originalQuery){
  // The public entry point has already validated the original navigation
  // intent. Re-parsing its normalized multiword name would discard valid
  // explicit website requests as if they were free-form topic searches.
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
  return wikidataSiteRecords(await sourceJson(details),originalQuery);
}
