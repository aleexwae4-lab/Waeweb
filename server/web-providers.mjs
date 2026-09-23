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
const TECH=/\b(?:javascript|typescript|python|react|node(?:\.js)?|linux|android|sql|html|css|api|github|git|programaci[oó]n|codigo|c[oó]digo|backend|frontend|servidor|error|bug|docker|postgres|supabase|vercel|render|prisma|npm|web|desarrollo|development)\b/i;
export const technicalWebQuery=(query,site=null,source=null)=>
  ["stackoverflow","superuser","mdn"].includes(source)||
  ["stackoverflow.com","superuser.com","developer.mozilla.org"].includes(site)||
  TECH.test(query);
export async function stackExchangeWeb(query,site="stackoverflow"){
  if(!["stackoverflow","superuser"].includes(site))throw Error("invalid_stackexchange_site");
  const url=new URL("https://api.stackexchange.com/2.3/search/advanced");
  url.search=new URLSearchParams({q:query,site,order:"desc",sort:"relevance",pagesize:"8"}).toString();
  const data=await loadJson(url);
  if(!Array.isArray(data.items))throw Error("stackexchange_invalid_response");
  const origin=site==="stackoverflow"?"stackoverflow.com":"superuser.com";
  return data.items.slice(0,8).flatMap(item=>{
    const link=safeUrl(item.link);
    if(!link||!new URL(link).hostname.endsWith(origin)||!item.title)return [];
    const votes=Number.isFinite(item.score)?item.score:null;
    const answers=Number.isFinite(item.answer_count)?item.answer_count:null;
    const description=[answers!==null?answers+" respuestas":null,
      votes!==null?votes+" votos":null].filter(Boolean).join(" · ");
    const created=Number(item.creation_date)*1000;
    return [{title:decodeWebText(item.title).slice(0,240),url:link,
      snippet:description||"Pregunta publicada en la comunidad técnica",
      source:site==="stackoverflow"?"Stack Overflow · comunidad":"Super User · comunidad",
      date:Number.isFinite(created)&&created>0?new Date(created).toISOString().slice(0,10):null,
      image:null}];
  });
}
export async function mdnWeb(query){
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
