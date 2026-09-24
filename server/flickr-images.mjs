// Flickr's documented public photo feed, no API key and no scraping.
// A public Flickr photo is NOT necessarily licensed for reuse.
const words=value=>String(value||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"")
  .toLowerCase().match(/[\p{L}\p{N}]{3,}/gu)||[];
const STOP=new Set(["para","con","los","las","del","que","and","the","una","uno","unas","unos","por","foto","fotos","imagenes","imagen","images","photo","photos","fotografia","fotografias","photography","photograph","pinterest"]);
export const flickrTags=query=>[...new Set(words(query).filter(word=>!STOP.has(word)))].slice(0,4);
const validUrl=value=>{
  try{const u=new URL(value);return u.protocol==="https:"&&!u.username&&!u.password?u:null;}
  catch{return null;}
};
export async function flickrPublicImages(query){
  const tags=flickrTags(query);
  if(!tags.length)return [];
  const url=new URL("https://www.flickr.com/services/feeds/photos_public.gne");
  url.search=new URLSearchParams({
    tags:tags.join(","),tagmode:"all",format:"json",nojsoncallback:"1",lang:"es-us"
  }).toString();
  const response=await fetch(url,{headers:{accept:"application/json",
    "user-agent":"WAE-Web/1.0 (+https://github.com/aleexwae4-lab/Waeweb)"},
    redirect:"error",signal:AbortSignal.timeout(6000)});
  if(!response.ok)throw Error("flickr_feed_status_"+response.status);
  const raw=await response.text();
  if(raw.length>1250000)throw Error("flickr_feed_too_large");
  const data=JSON.parse(raw);
  if(!Array.isArray(data.items))throw Error("flickr_feed_invalid_response");
  return data.items.slice(0,28).flatMap(item=>{
    const origin=validUrl(item.link),asset=validUrl(item.media?.m);
    if(!origin||!["flickr.com","www.flickr.com","m.flickr.com"].includes(origin.hostname)||
      !/^\/photos\/[^/]+\/\d+\/?$/.test(origin.pathname)||!asset)return [];
    const title=String(item.title||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,220);
    const keywords=words([title,item.tags].filter(Boolean).join(" "));
    // All meaningful query terms must appear in source metadata.
    // Any-tag matching was flooding AI searches with unrelated photographs.
    if(!tags.every(t=>keywords.some(w=>w.includes(t)||t.includes(w))))return [];
    const creator=String(item.author||"").replace(/<[^>]*>/g," ").trim().slice(0,110);
    return [{
      title:title||"Fotografía pública",url:origin.href,
      snippet:creator?"Autoría indicada: "+creator:"Foto pública de Flickr; consulta derechos en el origen.",
      source:"Flickr · fotos públicas",date:null,image:asset.href,
      fullImage:null,width:null,height:null,mime:null,license:null
    }];
  });
}
