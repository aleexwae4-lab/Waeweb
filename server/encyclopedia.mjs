// On-demand encyclopedic introduction from an exact MediaWiki page ID.
// Fixed upstream host; no user URL, third-party scraping or fake AI answers.
const cache=new Map(),TTL=15*60_000,LIMIT=180;
export class EncyclopediaError extends Error{
  constructor(code,message,status=422){super(message);this.name="EncyclopediaError";this.code=code;this.status=status;}
}
export function validWikiPageId(value){
  return typeof value==="string"&&/^[1-9][0-9]{0,11}$/.test(value);
}
export async function wikipediaIntroduction(pageid,{now=Date.now(),fetcher=fetch}={}){
  if(!validWikiPageId(pageid))
    throw new EncyclopediaError("invalid_pageid","El identificador de artículo no es válido.",400);
  const saved=cache.get(pageid);
  if(saved&&saved.expires>now)return saved.value;
  const url=new URL("https://es.wikipedia.org/w/api.php");
  url.search=new URLSearchParams({
    action:"query",prop:"extracts",exintro:"1",explaintext:"1",
    exchars:"2100",pageids:pageid,format:"json",formatversion:"2"
  }).toString();
  const response=await fetcher(url,{
    headers:{accept:"application/json",
      "user-agent":"WAE-Web/1.0 (+https://github.com/aleexwae4-lab/Waeweb)"},
    redirect:"error",signal:AbortSignal.timeout(6500)
  });
  if(!response.ok)
    throw new EncyclopediaError("upstream_status","Wikipedia no respondió a la consulta.",502);
  const raw=await response.text();
  if(raw.length>900000)
    throw new EncyclopediaError("oversized","La respuesta del catálogo supera el límite.",502);
  let data;
  try{data=JSON.parse(raw);}
  catch{throw new EncyclopediaError("invalid_response","La fuente devolvió datos inválidos.",502);}
  const item=Array.isArray(data.query?.pages)?data.query.pages.find(x=>
    String(x.pageid)===pageid&&!x.missing&&!x.invalid):null;
  const title=String(item?.title||"").replace(/\s+/g," ").trim().slice(0,240);
  const extract=String(item?.extract||"").replace(/<[^>]+>/g," ")
    .replace(/\s+/g," ").trim().slice(0,2100);
  if(!title||extract.length<45)
    throw new EncyclopediaError("no_extract","Este artículo no ofrece una introducción legible.",404);
  const value={
    pageid,title,extract,url:"https://es.wikipedia.org/?curid="+pageid,
    source:"Wikipedia · artículo original",language:"es",
    kind:"encyclopedia_introduction",fetchedAt:new Date(now).toISOString(),
    disclaimer:"Introducción recuperada de Wikipedia en español; no es una síntesis de IA ni una verificación independiente. Consulta el artículo original y su historial."
  };
  if(cache.size>=LIMIT)cache.clear();
  cache.set(pageid,{value,expires:now+TTL});
  return value;
}
