import {readPage, ReaderError} from "./reader.mjs";
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
    if(!/^[a-z0-9.-]+$/.test(h)||!h.includes(".")||
      /\.(?:local|localhost|internal|test|invalid|onion)$/.test(h)||
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
  // Re-discovery does not discard a previously retrieved, robots-permitted
  // page body for the same canonical URL during this server instance.
  const previous=local.get(url);
  if(previous?.contentRecovered && now-Date.parse(previous.fetchedAt)<TTL){
    for(const key of ["contentRecovered","indexedText","fingerprint","fetchedAt"])
      entry[key]=previous[key];
    entry.snippet=previous.snippet;
  }
  local.delete(url);
  while(local.size>=LIMIT)local.delete(local.keys().next().value);
  local.set(url,entry);
  return entry;
}
// Bounded BM25 on genuine metadata / robots-permitted content only.
// This is NOT a global web ranking engine: the local corpus is 500 volatile docs.
function bag(value){const counts=new Map();for(const word of (fold(value).match(/[\\p{L}\\p{N}]{3,}/gu)||[])){
 counts.set(word,(counts.get(word)||0)+1);}return counts;}
export function rankLocalBM25(items,query){
 const terms=tokenise(query);if(!terms.length||items.length<2)return [...items];
 const docs=items.map((item,index)=>{
   const title=bag(item.title),snippet=bag(item.snippet),
     body=bag(item.contentRecovered?item.indexedText:"");
   const length=[...title.values()].reduce((a,b)=>a+b,0)*3+
     [...snippet.values()].reduce((a,b)=>a+b,0)*1.5+
     [...body.values()].reduce((a,b)=>a+b,0);
   return {item,index,title,snippet,body,length:Math.max(1,length)};
 });
 const average=docs.reduce((sum,doc)=>sum+doc.length,0)/docs.length;
 const frequencies=new Map(terms.map(term=>[term,docs.filter(doc=>doc.title.has(term)||doc.snippet.has(term)||doc.body.has(term)).length]));
 const ranked=docs.map(doc=>{
  let score=0;
  for(const term of terms){
    const tf=(doc.title.get(term)||0)*3+(doc.snippet.get(term)||0)*1.5+(doc.body.get(term)||0);
    const n=frequencies.get(term)||0;
    const idf=Math.log(1+(docs.length-n+0.5)/(n+0.5));
    if(tf)score+=idf*tf*2.2/(tf+1.2*(0.25+0.75*doc.length/average));
    else if(fold(doc.item.title+" "+doc.item.snippet).includes(term))score+=0.01;
  }
  return {...doc,score};
 });
 return ranked.sort((a,b)=>b.score-a.score||a.index-b.index).map(x=>x.item);
}
export function localWebSearch(query,now=Date.now()){
  const terms=tokenise(query);
  if(!terms.length)return [];
  const matched=[];
  for(const [url,item] of local){
    if(now-Date.parse(item.indexedAt)>TTL){local.delete(url);continue;}
    const title=fold(item.title),snippet=fold(item.snippet);
    const body=item.contentRecovered?fold(item.indexedText):"";
    const found=terms.filter(t=>title.includes(t)||snippet.includes(t)||body.includes(t));
    if(found.length===terms.length)matched.push({
      ...item,source:"WAE Index local · HN",indexPersistence:"memory_only",
      indexScope:"previously_discovered_HN_links"
    });
  }
  return rankLocalBM25(matched,query).slice(0,25);
}
export function webIndexStats(){return {documents:local.size,maxDocuments:LIMIT,
  enrichedDocuments:[...local.values()].filter(item=>item.contentRecovered).length,
  persistence:"memory_only",coverage:"HN linked-page metadata; not the entire web"};}
export async function enrichIndexedPage(value,options={}){
  const url=indexedUrl(value),entry=url?local.get(url):null;
  if(!entry)throw new ReaderError("not_discovered",
    "Solo pueden indexarse páginas descubiertas previamente como enlaces públicos; busca primero la página.");
  // Reuse one bounded document for an hour to avoid repeatedly fetching a
  // remote website; this local copy vanishes when the Render instance restarts.
  if(entry.contentRecovered&&Date.now()-Date.parse(entry.fetchedAt)<3600000)
    return {url:entry.url,title:entry.title,snippet:entry.snippet,
      fetchedAt:entry.fetchedAt,fingerprint:entry.fingerprint,
      contentRecovered:true,persistence:"memory_only",cached:true};
  const page=await readPage(url,options); // DNS-pinned HTTPS + robots + no redirects
  if(indexedUrl(page.url)!==url)throw new ReaderError("redirected",
    "El sitio cambió de dirección; no se indexó sin revisar el destino.");
  const updated={...entry,title:page.title||entry.title,
    snippet:page.text.slice(0,450),indexedText:page.text.slice(0,6000),
    contentRecovered:true,fingerprint:page.fingerprint,fetchedAt:page.fetchedAt};
  local.delete(url);
  local.set(url,updated);
  return {url:updated.url,title:updated.title,snippet:updated.snippet,
    fetchedAt:updated.fetchedAt,fingerprint:updated.fingerprint,
    contentRecovered:true,persistence:"memory_only",cached:false};
}
// Share only concurrent identical discovery requests. The result is NOT
// persistently cached; each completed search can refresh source metadata.
// This avoids doubling unauthenticated public API traffic when the same
// user requests progressive pages and the complete federated SERP.
const pendingDiscovery=new Map();
export function discoverOpenWeb(query){
  const key=String(query??"").trim().toLocaleLowerCase("es");
  if(!key)return Promise.resolve([]);
  if(pendingDiscovery.has(key))return pendingDiscovery.get(key);
  const task=loadOpenWeb(key);
  pendingDiscovery.set(key,task);
  void task.then(()=>{if(pendingDiscovery.get(key)===task)pendingDiscovery.delete(key);},
    ()=>{if(pendingDiscovery.get(key)===task)pendingDiscovery.delete(key);});
  return task;
}
async function loadOpenWeb(query){
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
