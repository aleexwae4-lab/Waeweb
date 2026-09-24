// Complementary, source-attributed discovery for WAE WEB. These catalogs are
// not substitutes for a general Internet index.
import {isIP} from "node:net";
const MAX_BYTES=1100000;
const HEADERS={accept:"application/json","user-agent":"WAE-Web/1.0 (+https://github.com/aleexwae4-lab/Waeweb)"};
const text=value=>String(value??"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,850);
const entities={amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "};
export const decodeWebText=value=>text(value).replace(/&#(x[0-9a-f]+|\d+);|&([a-z]+);/gi,(whole,num,name)=>{
  if(name)return entities[name.toLowerCase()]??whole;
  const n=num.toLowerCase().startsWith("x")?parseInt(num.slice(1),16):Number(num);
  return n>0&&n<=0x10ffff&&!(n>=0xd800&&n<=0xdfff)?String.fromCodePoint(n):"";
});
const safeUrl=value=>{
  try{const u=new URL(value);return ["https:","http:"].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}
  catch{return null;}
};
async function loadJson(url,timeout=5600){
  const response=await fetch(url,{headers:HEADERS,redirect:"error",signal:AbortSignal.timeout(timeout)});
  if(!response.ok)throw Error("discovery_status_"+response.status);
  const body=await response.text();
  if(body.length>MAX_BYTES)throw Error("discovery_too_large");
  return JSON.parse(body);
}
export function searxngConfig(){
  const input=process.env.WAE_SEARXNG_URL?.trim();
  if(!input)return null;
  try{
    const u=new URL(input),host=u.hostname.toLowerCase().replace(/\.$/,"");
    if(u.protocol!=="https:"||u.username||u.password||u.search||u.hash||
      u.port&&u.port!=="443"||!host.includes(".")||isIP(host)||
      !/^[a-z0-9.-]+$/.test(host)||
      /(?:^|\.)(?:localhost|local|internal|test|invalid|onion)$/.test(host))
      return null;
    return u.origin+u.pathname.replace(/\/+$/,"");
  }catch{return null;}
}
export async function searxngWeb(query,page=1){
  const configured=searxngConfig();
  if(!configured)return null;
  const url=new URL(configured+"/search");
  url.search=new URLSearchParams({q:query,format:"json",
    categories:"general",language:"es",safesearch:"1",pageno:String(page)}).toString();
  const data=await loadJson(url);
  if(!Array.isArray(data.results))throw Error("searxng_invalid_response");
  const items=data.results.slice(0,30).flatMap(item=>{
    const link=safeUrl(item.url),title=decodeWebText(item.title).slice(0,240);
    if(!link||!title)return [];
    return [{title,url:link,snippet:decodeWebText(item.content),
      source:"SearXNG · índice web",date:null,image:null,
      provenance:item.engine?String(item.engine).slice(0,70):null}];
  });
  // Engine-specific pagination varies; never claim more pages from a tiny response.
  items.hasMorePage=data.results.length>=10;
  return items;
}
// An operator-controlled SearXNG instance can return real image records.
// Never substitute generic web links or fabricate missing image previews.
export async function searxngImages(query){
  const configured=searxngConfig();
  if(!configured)return null;
  const url=new URL(configured+"/search");
  url.search=new URLSearchParams({q:query,format:"json",
    categories:"images",language:"es",safesearch:"1",pageno:"1"}).toString();
  const data=await loadJson(url);
  if(!Array.isArray(data.results))throw Error("searxng_images_invalid_response");
  return data.results.slice(0,35).flatMap(item=>{
    const link=safeUrl(item.url);
    const full=safeUrl(item.img_src);
    const image=safeUrl(item.thumbnail_src||item.thumbnail||item.img_src);
    const title=decodeWebText(item.title).slice(0,240);
    if(!link||!image||!title)return [];
    const sizes=typeof item.resolution==="string"
      ?item.resolution.match(/^\s*(\d{2,6})\s*[x×]\s*(\d{2,6})\s*$/i):null;
    const width=sizes?Number(sizes[1]):null,height=sizes?Number(sizes[2]):null;
    return [{title,url:link,snippet:decodeWebText(item.content),
      source:"SearXNG · imágenes",date:null,image,
      fullImage:full,width,height,mime:null,license:null,
      provenance:typeof item.engine==="string"?item.engine.slice(0,70):null}];
  });
}
const TECH=/\b(?:javascript|typescript|python|react|node(?:\.js)?|linux|android|sql|html|css|api|github|git|programaci[oó]n|codigo|c[oó]digo|backend|frontend|servidor|error|bug|docker|postgres|supabase|vercel|render|prisma|npm|web|desarrollo|development)\b/i;
export const technicalWebQuery=(query,site=null,source=null)=>
  ["stackoverflow","superuser","mdn"].includes(source)||
  ["stackoverflow.com","superuser.com","developer.mozilla.org"].includes(site)||
  TECH.test(query);
// Concurrent first-page and complete SERP requests reuse the SAME public
// technical-source call. Completed results and failures are not cached here.
const technicalRequests=new Map();
function shareTechnical(key,run){
  if(technicalRequests.has(key))return technicalRequests.get(key);
  const task=run();
  technicalRequests.set(key,task);
  void task.then(()=>{if(technicalRequests.get(key)===task)technicalRequests.delete(key);},
    ()=>{if(technicalRequests.get(key)===task)technicalRequests.delete(key);});
  return task;
}
export function stackExchangeWeb(query,site="stackoverflow"){
  return shareTechnical("stack:"+site+":"+query,()=>loadStackExchangeWeb(query,site));
}
async function loadStackExchangeWeb(query,site="stackoverflow"){
  if(!["stackoverflow","superuser"].includes(site))throw Error("invalid_stackexchange_site");
  const url=new URL("https://api.stackexchange.com/2.3/search/advanced");
  url.search=new URLSearchParams({q:query,site,order:"desc",sort:"relevance",pagesize:"8"}).toString();
  const data=await loadJson(url);
  if(!Array.isArray(data.items))throw Error("stackexchange_invalid_response");
  const origin=site==="stackoverflow"?"stackoverflow.com":"superuser.com";
  return data.items.slice(0,8).flatMap(item=>{
    const link=safeUrl(item.link);
    if(!link||!(new URL(link).hostname===origin||
      new URL(link).hostname.endsWith("."+origin))||!item.title)return [];
    const votes=Number.isFinite(item.score)?item.score:null;
    const answers=Number.isFinite(item.answer_count)?item.answer_count:null;
    const description=[answers!==null?answers+" respuestas":null,
      votes!==null?votes+" votos":null].filter(Boolean).join(" · ");
    const created=Number(item.creation_date)*1000;
    return [{title:decodeWebText(item.title).slice(0,240),url:link,
      snippet:description||"Pregunta publicada en la comunidad técnica",
      source:site==="stackoverflow"?"Stack Overflow · comunidad":"Super User · comunidad",
      date:Number.isFinite(created)&&created>0&&created<8640000000000000
        ?new Date(created).toISOString().slice(0,10):null,
      image:null}];
  });
}
// Public repository search, not GitHub code search and not a general
// web index. Unauthenticated REST calls can be rate limited by GitHub.
// Only specific code + repository intent receives fast GitHub discovery;
// broad "GitHub" navigational searches still use the site, not random repos.
// Normalize Spanish/English intent words WITHOUT guessing a new domain.
export function repositoryIntentTerms(query){
  const raw=String(query??"").trim();
  const folded=raw.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const asksRepos=/\b(?:repo(?:s|sitory|sitories|sitorio|sitorios)?|repositorios?|repositories|codigo fuente|source code)\b/.test(folded);
  const namesTech=/\b(?:javascript|typescript|python|react|next\.?js|node\.?js|java|kotlin|swift|rust|golang|go|php|laravel|django|flask|postgres(?:ql)?|sqlite|supabase|docker|vue|angular|svelte|linux|android|ios|flutter|prisma|webassembly|wasm)\b/.test(folded);
  if(!asksRepos||!namesTech||raw.length>140)return null;
  const terms=raw.replace(/\b(?:github|repositorios?|repositories|repository|repos|repo|proyectos de codigo|codigo fuente|source code|para|de|del|en)\b/gi,"")
    .replace(/\s+/g," ").trim();
  return terms.length>=2?terms:null;
}
export function githubPublicRepositories(query){
  return shareTechnical("github-repos:"+query,()=>loadGithubPublicRepositories(query));
}
async function loadGithubPublicRepositories(query){
  const u=new URL("https://api.github.com/search/repositories");
  u.search=new URLSearchParams({q:query,per_page:"8",page:"1"}).toString();
  const data=await loadJson(u);
  if(!Array.isArray(data.items))throw Error("github_repo_invalid_response");
  return data.items.slice(0,8).flatMap(item=>{
    const name=String(item.full_name||"");
    if(!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(name)||
      !Number.isInteger(item.id)||item.id<=0||item.private===true)return [];
    const expected="https://github.com/"+name;
    const link=safeUrl(item.html_url);
    if(!link)return [];
    const page=new URL(link);
    if(page.protocol!=="https:"||page.hostname!=="github.com"||
      page.pathname.replace(/\/$/,"").toLowerCase()!==("/"+name).toLowerCase())return [];
    const language=typeof item.language==="string"?item.language.slice(0,45):null;
    const stars=Number.isInteger(item.stargazers_count)&&item.stargazers_count>=0
      ?item.stargazers_count:null;
    const description=[decodeWebText(item.description||""),
      language?"Lenguaje: "+language:null,
      stars!==null?"Estrellas públicas: "+stars:null].filter(Boolean).join(" · ");
    return [{title:decodeWebText(item.full_name).slice(0,240),
      url:expected,snippet:description.slice(0,850),
      source:"GitHub · repositorios públicos",date:null,image:null,
      updatedAt:typeof item.updated_at==="string"?item.updated_at:null,
      indexedScope:"repository_metadata_only"}];
  });
}
export function mdnWeb(query){
  return shareTechnical("mdn:"+query,()=>loadMdnWeb(query));
}
async function loadMdnWeb(query){
  const url=new URL("https://developer.mozilla.org/api/v1/search");
  url.search=new URLSearchParams({q:query,locale:"en-US"}).toString();
  const data=await loadJson(url);
  if(!Array.isArray(data.documents))throw Error("mdn_invalid_response");
  return data.documents.slice(0,8).flatMap(item=>{
    const path=item.mdn_url;
    if(typeof path!=="string"||!path.startsWith("/")||path.startsWith("//"))return [];
    const link=safeUrl(new URL(path,"https://developer.mozilla.org").href);
    if(!link||new URL(link).hostname!=="developer.mozilla.org"||!item.title)return [];
    return [{title:decodeWebText(item.title).slice(0,240),url:link,
      snippet:decodeWebText(item.summary||"Documentación de MDN Web Docs"),
      source:"MDN Web Docs · documentación",date:null,image:null}];
  });
}
