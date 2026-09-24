// OpenStreetMap Overpass POI discovery. No paid API, no user-supplied query language.
const cache=new Map(),pending=new Map(),TTL=10*60_000;
const CATEGORIES=Object.freeze({
  oxxo:{label:"OXXO",filters:['["name"~"^OXXO( |$)",i]','["brand"~"^OXXO$",i]']},
  bancos:{label:"Bancos",filters:['["amenity"="bank"]']},
  cajeros:{label:"Cajeros",filters:['["amenity"="atm"]']},
  cines:{label:"Cines",filters:['["amenity"="cinema"]']},
  restaurantes:{label:"Restaurantes",filters:['["amenity"="restaurant"]']},
  gasolineras:{label:"Gasolineras",filters:['["amenity"="fuel"]']},
  farmacias:{label:"Farmacias",filters:['["amenity"="pharmacy"]','["shop"="chemist"]']},
  supermercados:{label:"Supermercados",filters:['["shop"="supermarket"]']},
  cafeterias:{label:"Cafeterías",filters:['["amenity"="cafe"]']},
  hospitales:{label:"Hospitales",filters:['["amenity"="hospital"]']},
  hoteles:{label:"Hoteles",filters:['["tourism"="hotel"]']}
});
const ALIASES=Object.freeze({"banco":"bancos","cine":"cines","restaurante":"restaurantes",
 "gasolinera":"gasolineras","gasolina":"gasolineras","farmacia":"farmacias",
 "supermercado":"supermercados","cafe":"cafeterias","cafeteria":"cafeterias",
 "hospital":"hospitales","hotel":"hoteles","cajero":"cajeros"});
const fold=x=>String(x??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase();
export const poiCategories=()=>Object.entries(CATEGORIES).map(([id,v])=>({id,label:v.label}));
export class PoiError extends Error{constructor(message,status=400,code="poi_invalid"){super(message);this.status=status;this.code=code;}}
const numeric=(v,min,max)=>v!==null&&v!==undefined&&String(v).trim()!==""&&Number.isFinite(Number(v))&&Number(v)>=min&&Number(v)<=max;
const clean=x=>String(x??"").replace(/<[^>]*>/g," ").replace(/[\u0000-\u001F\u007F]/g," ").replace(/\s+/g," ").trim();
const earthDistance=(a,b,c,d)=>{const rad=Math.PI/180,p=(c-a)*rad,l=(d-b)*rad,h=Math.sin(p/2)**2+Math.cos(a*rad)*Math.cos(c*rad)*Math.sin(l/2)**2;return Math.round(12742000*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h))));};
function osmURL(item){
 if(!["node","way","relation"].includes(item.type)||!Number.isSafeInteger(item.id)||item.id<=0)return null;
 return "https://www.openstreetmap.org/"+item.type+"/"+item.id;
}
export function compilePoiQuery({latitude,longitude,radius=2500,category}={}){
 if(!numeric(latitude,-90,90)||!numeric(longitude,-180,180))
   throw new PoiError("Selecciona una ubicación real antes de buscar comercios.");
 if(!numeric(radius,100,10000))throw new PoiError("El radio permitido está entre 100 y 10 000 metros.");
 if(typeof category!=="string"||category.length>40)throw new PoiError("Selecciona una categoría de establecimientos.");
 const key=ALIASES[fold(category)]||fold(category),definition=CATEGORIES[key];
 if(!definition)throw new PoiError("Categoría no disponible. Elige una de las categorías del mapa.");
 const lat=Number(latitude),lon=Number(longitude),metres=Math.round(Number(radius));
 const selectors=definition.filters.map(filter=>`nwr(around:${metres},${lat.toFixed(6)},${lon.toFixed(6)})${filter};`).join("");
 return {key,definition,lat,lon,metres,ql:`[out:json][timeout:12];(${selectors});out center 80;`};
}
export async function searchPOI(input,{transport=fetch}={}){
 const spec=compilePoiQuery(input),key=[spec.key,spec.lat.toFixed(5),spec.lon.toFixed(5),spec.metres].join(":");
 const shared=transport===globalThis.fetch,old=shared?cache.get(key):null;
 if(old&&old.expiry>Date.now())return old.data;
 if(shared&&pending.has(key))return pending.get(key);
 const task=(async()=>{
 const base=(process.env.WAE_OVERPASS_URL||"https://overpass-api.de/api/interpreter").trim();
 let url;try{url=new URL(base);}catch{throw new PoiError("El índice de comercios no está configurado.",503,"poi_configuration");}
 if(url.protocol!=="https:"||url.username||url.password||url.hash)
   throw new PoiError("El índice de comercios requiere una URL HTTPS válida.",503,"poi_configuration");
 let response;
 try{response=await transport(url,{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded;charset=UTF-8",accept:"application/json",
   "user-agent":"WAEWEB/1.0 (https://github.com/aleexwae4-lab/Waeweb)"},body:new URLSearchParams({data:spec.ql}).toString(),
   redirect:"error",signal:AbortSignal.timeout(14000)});}
 catch{throw new PoiError("El índice de comercios no respondió.",502,"poi_source_unavailable");}
 if(response.status===429||response.status===503)throw new PoiError("El índice de comercios está temporalmente ocupado.",503,"poi_provider_busy");
 if(!response.ok)throw new PoiError("El índice de comercios no devolvió resultados.",502,"poi_source_unavailable");
 let raw;try{raw=await response.text();if(raw.length>2000000)throw Error("too_large");raw=JSON.parse(raw);}
 catch{throw new PoiError("Respuesta inválida del índice de comercios.",502,"poi_invalid_response");}
 if(!raw||!Array.isArray(raw.elements))throw new PoiError("Respuesta incompleta del índice de comercios.",502,"poi_invalid_response");
 const seen=new Set();
 const results=raw.elements.flatMap(item=>{
  const url=osmURL(item),latitude=Number(item.lat??item.center?.lat),longitude=Number(item.lon??item.center?.lon);
  if(!url||!Number.isFinite(latitude)||!Number.isFinite(longitude)||Math.abs(latitude)>90||Math.abs(longitude)>180)return [];
  const distanceMeters=earthDistance(spec.lat,spec.lon,latitude,longitude);
  if(distanceMeters>spec.metres+100)return [];
  const tags=item.tags&&typeof item.tags==="object"?item.tags:{};
  const name=clean(tags.name||tags.brand||spec.definition.label).slice(0,120);
  const address=clean([tags["addr:street"],tags["addr:housenumber"],tags["addr:city"]].filter(Boolean).join(" ")).slice(0,200);
  if(seen.has(url))return [];seen.add(url);
  return [{id:item.type+":"+item.id,name,detail:address||clean(tags.description).slice(0,180)||spec.definition.label,
    latitude,longitude,precision:"place_point",category:spec.definition.label,
    distanceMeters,website:typeof tags.website==="string"&&/^https?:\/\//.test(tags.website)?tags.website:null,
    phone:clean(tags.phone||tags["contact:phone"]).slice(0,60)||null,
    openingHours:clean(tags.opening_hours).slice(0,160)||null,url,source:"OpenStreetMap · Overpass"}];
 }).sort((a,b)=>a.distanceMeters-b.distanceMeters).slice(0,60);
 const data={query:spec.definition.label,category:spec.key,source:"OpenStreetMap · Overpass",precision:"poi",
  center:{latitude:spec.lat,longitude:spec.lon},radiusMeters:spec.metres,results,
  attribution:"© OpenStreetMap contributors · ODbL. Datos comunitarios; horarios y fichas pueden estar incompletos.",
  message:results.length?null:"No hay comercios de esa categoría registrados en OpenStreetMap para este radio."};
 if(shared){if(cache.size>250)cache.clear();cache.set(key,{data,expiry:Date.now()+(results.length?TTL:90_000)});}
 return data;
 })();
 if(!shared)return task;pending.set(key,task);
 try{return await task;}finally{if(pending.get(key)===task)pending.delete(key);}
}
