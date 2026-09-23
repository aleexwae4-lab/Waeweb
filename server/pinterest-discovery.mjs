// Pinterest discovery via authenticated general search indexes only. No
// Pinterest API token, scraper, fabricated pin or republished image bytes.
export function pinterestPinUrl(value){
  try{
    const u=new URL(value);
    if(u.protocol!=="https:"||u.username||u.password)return null;
    if(!["pinterest.com","www.pinterest.com","mx.pinterest.com","es.pinterest.com",
      "uk.pinterest.com","fr.pinterest.com","de.pinterest.com","br.pinterest.com",
      "it.pinterest.com","ca.pinterest.com","au.pinterest.com","in.pinterest.com"].includes(u.hostname.toLowerCase()))
      return null;
    const match=u.pathname.match(/^\/pin\/([0-9]{6,25})\/?$/);
    return match?"https://www.pinterest.com/pin/"+match[1]+"/":null;
  }catch{return null;}
}
export function pinterestQuery(query){
  return String(query||"").trim()+" site:pinterest.com/pin/";
}
export function pinterestVisualIntent(query,intent="general"){
  return ["productos","arte","lugares","logotipos"].includes(intent)||
    /\b(pinterest|inspiracion|ideas|moda|fashion|bolsas?|bolsos?|monederos?|outfit|decoracion|interior|estilo|diseno|diseño|recetas?|manualidades|wedding|boda|inspiration|aesthetic)\b/i.test(query);
}
export function verifiedPinterestImages(items,indexLabel){
  if(!Array.isArray(items))return items===null?null:[];
  return items.flatMap(item=>{
    const url=pinterestPinUrl(item.url);
    if(!url||!item.image||!item.title)return [];
    return [{...item,url,source:"Pinterest · vía "+indexLabel,
      imagePlatform:"Pinterest",pinId:url.match(/\/pin\/([0-9]+)\//)?.[1],
      discoveryIndex:indexLabel,license:null}];
  });
}
// Pinterest links already present in general image results must carry the
// same attribution; image URLs alone are not evidence that an actual pin exists.
export function labelPinterestImages(items){
  return items.map(item=>{
    const url=pinterestPinUrl(item.url);
    if(!url||!item.image)return item;
    const origin=item.source==="Brave Search"?"Brave":
      item.source==="Google Programmable Search"?"Google":
      item.source==="SearXNG · imágenes"?"SearXNG":null;
    return origin?{...item,url,source:"Pinterest · vía "+origin,
      imagePlatform:"Pinterest",pinId:url.match(/\/pin\/([0-9]+)\//)?.[1],
      discoveryIndex:origin,license:null}:item;
  });
}
