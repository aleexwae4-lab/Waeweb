import {readPage,safeReaderUrl,sameSiteRedirect,ReaderError} from "./reader.mjs";
// Read only a result actually returned by WAE WEB recently. Public excerpt,
// not a copy of paywalled content or a permanent full-web crawler.
const links=new Map();
const MAX_LINKS=600,TTL=20*60_000;
const canonical=value=>{
  const u=new URL(value);u.hash="";
  return safeReaderUrl(u.href).href;
};
export function registerWebHits(items,now=Date.now()){
  for(const item of items){
    try{
      const url=canonical(item.url);
      if(!item.title)continue;
      if(links.has(url))links.delete(url);
      while(links.size>=MAX_LINKS)links.delete(links.keys().next().value);
      links.set(url,{title:String(item.title).slice(0,240),
        source:String(item.source||"Fuente original").slice(0,100),expires:now+TTL});
    }catch{/* non-HTTPS, blocked, or malformed result: never register */}
  }
}
export async function previewWebHit(input,{now=Date.now(),read=readPage}={}){
  let url;
  try{url=canonical(input);}catch{throw new ReaderError("invalid_url","Página pública no válida.");}
  const entry=links.get(url);
  if(!entry||now>entry.expires){
    links.delete(url);
    throw new ReaderError("not_search_result",
      "La página no pertenece a una búsqueda reciente. Búscala nuevamente.");
  }
  const page=await read(url);
  let resolvedUrl;
  try{resolvedUrl=canonical(page.url);}
  catch{throw new ReaderError("redirected","La página cambió de dirección.");}
  // Keep the searched URL as the reading authorization key, while exposing
  // the actual on-site HTTPS canonical destination for provenance.
  if(resolvedUrl!==url&&!sameSiteRedirect(url,resolvedUrl))
    throw new ReaderError("redirected","La página cambió de sitio.");
  const excerpt=String(page.text||"").slice(0,1200);
  if(excerpt.length<30)
    throw new ReaderError("empty_page","La página no contiene texto legible.");
  return {url,resolvedUrl,title:page.title||entry.title,source:entry.source,
    excerpt,hasMore:String(page.text||"").length>1200,
    fetchedAt:page.fetchedAt,kind:"source_excerpt",
    disclaimer:"Extracto limitado de la página original, sujeto a robots.txt. No verificado como verdadero. Consulta la fuente para el texto completo."};
}
