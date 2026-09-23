// WAEWEB Discovery Index v1. Public linked-page metadata, never a fabricated
// copy of the full web. No article text is scraped or third-party credentials used.
// This bounded per-instance index is volatile on Render free restarts.
const LIMIT=500,TTL=24*60*60*1000;
const local=new Map();
const text=v=>String(v??"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim();
const fold=v=>text(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const tokenise=v=>[...new Set(fold(v).match(/[\p{L}\p{N}]{3,}/gu)||[])].slice(0,16);
export function indexedUrl(value){
  try{
    const u=new URL(value);
    if(u.protocol!=="https:"||u.username||u.password||u.port&&u.port!=="443")return null;
    const h=u.hostname.toLowerCase().replace(/\.$/,"");
    if(!h.includes(".")||/\.(?:local|localhost|internal|test|invalid|onion)$/.test(h)||
      /^(?:localhost|\d{1,3}(?:\.\d{1,3}){3})$/.test(h)||
      /^(?:wikimedia\.org|wikipedia\.org|wikidata\.org)$/.test(h)||
      /\.(?:wikimedia|wikipedia|wikidata)\.org$/.test(h))return null;
    u.hash="";
    for(const key of [...u.searchParams.keys()])
      if(/^utm_/i.test(key)||/^(fbclid|gclid|msclkid)$/i.test(key))u.searchParams.delete(key);
    return u.href.length<=1800?u.href:null;
  }catch{return null;}
}
export function indexLinkedPage(hit,now=Date.now()){
  const url=indexedUrl(hit?.url),title=text(hit?.title).slice(0,230);
  if(!url||title.length<4||!/^\d{1,15}$/.test(String(hit.objectID||"")))return null;
  const story="https://news.ycombinator.com/item?id="+hit.objectID;
  const entry={
    title,url,snippet:text(hit.story_text).slice(0,260)||
      "Enlace publicado por la comunidad de Hacker News; contenido del sitio original no verificado por WAEWEB.",
    source:"Hacker News · web abierta",hnStory:story,
    date:/^\d{4}-\d{2}-\d{2}/.test(hit.created_at||"")?hit.created_at.slice(0,10):null,
    indexedAt:new Date(now).toISOString(),
    provenance:"Hacker News / Algolia (metadatos de enlace)"
  };
  local.delete(url);
  while(local.size>=LIMIT)local.delete(local.keys().next().value);
  local.set(url,entry);
  return entry;
}
export function localWebSearch(query,now=Date.now()){
  const terms=tokenise(query);
  if(!terms.length)return [];
  const matched=[];
  for(const [url,item] of local){
    if(now-Date.parse(item.indexedAt)>TTL){local.delete(url);continue;}
    const title=fold(item.title),snippet=fold(item.snippet);
    const found=terms.filter(t=>title.includes(t)||snippet.includes(t));
    if(found.length===terms.length)matched.push({
      ...item,source:"WAE Index local · HN",indexPersistence:"memory_only",
      indexScope:"previously_discovered_HN_links"
    });
  }
  return matched.slice(0,25);
}
export function webIndexStats(){return {documents:local.size,maxDocuments:LIMIT,
  persistence:"memory_only",coverage:"HN linked-page metadata; not the entire web"};}
export async function discoverOpenWeb(query){
  const u=new URL("https://hn.algolia.com/api/v1/search");
  u.search=new URLSearchParams({query,tags:"story",hitsPerPage:"20",page:"0"}).toString();
  const response=await fetch(u,{headers:{accept:"application/json",
    "user-agent":"WAEWEB-Discovery/1.0 (https://github.com/aleexwae4-lab/Waeweb)"},
    signal:AbortSignal.timeout(5500)});
  if(!response.ok)throw Error("hn_status_"+response.status);
  const raw=await response.text();
  if(raw.length>1100000)throw Error("hn_response_too_large");
  const data=JSON.parse(raw);
  if(!Array.isArray(data.hits))throw Error("hn_invalid_results");
  const found=data.hits.slice(0,20).map(hit=>indexLinkedPage(hit)).filter(Boolean);
  return found;
}
