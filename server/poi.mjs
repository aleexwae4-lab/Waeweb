// Explicit, bounded public OSM point-of-interest lookup. It is not a
// worldwide business directory, a verified business listing or live hours.
import {findPlaces} from "./maps.mjs";
const RADIUS=6500,MAX_RESULTS=35,TTL=2*60_000;
const cache=new Map(),inFlight=new Map();
const finite=n=>typeof n==="number"&&Number.isFinite(n);
const coords=p=>p&&finite(p.latitude)&&finite(p.longitude)&&
  Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;
const fold=s=>String(s??"").normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("es").trim();
const categories=new Map([
  ["bancos",{key:"amenity",value:"bank",label:"Bancos"}],
  ["banco",{key:"amenity",value:"bank",label:"Bancos"}],
  ["cajeros",{key:"amenity",value:"atm",label:"Cajeros automáticos"}],
  ["cajero",{key:"amenity",value:"atm",label:"Cajeros automáticos"}],
  ["cines",{key:"amenity",value:"cinema",label:"Cines"}],
  ["cine",{key:"amenity",value:"cinema",label:"Cines"}],
  ["cinemas",{key:"amenity",value:"cinema",label:"Cines"}],
  ["supermercados",{key:"shop",value:"supermarket",label:"Supermercados"}],
  ["supermercado",{key:"shop",value:"supermarket",label:"Supermercados"}],
  ["farmacias",{key:"amenity",value:"pharmacy",label:"Farmacias"}],
  ["farmacia",{key:"amenity",value:"pharmacy",label:"Farmacias"}],
  ["restaurantes",{key:"amenity",value:"restaurant",label:"Restaurantes"}],
  ["restaurante",{key:"amenity",value:"restaurant",label:"Restaurantes"}],
  ["cafeterias",{key:"amenity",value:"cafe",label:"Cafeterías"}],
  ["cafeteria",{key:"amenity",value:"cafe",label:"Cafeterías"}],
  ["gasolineras",{key:"amenity",value:"fuel",label:"Gasolineras"}],
  ["gasolinera",{key:"amenity",value:"fuel",label:"Gasolineras"}],
  ["comercios",{key:"shop",value:null,label:"Comercios"}],
  ["tiendas",{key:"shop",value:null,label:"Comercios"}],
  ["negocios",{key:"shop",value:null,label:"Comercios"}]
]);
const brands=/^(?:oxxo|oxxos|7.?eleven|seven eleven|walmart|soriana|bodega aurrera|coppel|cinepolis|cinemex|starbucks|bbva|banorte|santander|hsbc|banco azteca|farmacias? guadalajara|farmacias? del ahorro)$/i;
export class PoiError extends Error{
  constructor(message,status=400,code="poi_invalid"){
    super(message);this.status=status;this.code=code;
  }
}
export function parsePoiQuery(value){
  if(typeof value!=="string"||value.length>180)return null;
  const query=value.replace(/[\u0000-\u001f\u007f<>"]/g," ").replace(/\s+/g," ").trim();
  const match=query.match(/^(.+?)\s+(?:en|cerca de|por|alrededor de)\s+(.+)$/i);
  const term=(match?match[1]:query).trim(),locality=(match?match[2]:"").trim();
  const key=fold(term);
  const category=categories.get(key)||null;
  const explicit=Boolean(match)||/^(?:negocio|comercio|sucursal|tienda de)\s+/i.test(term);
  const brand=category?null:term.replace(/^(?:negocio|comercio|sucursal|tienda de)\s+/i,"").trim();
  if(!category&&!brands.test(key)&&!explicit)return null;
  if(locality.length>90||brand?.length>70||!category&&brand.length<2||
    brand&&/[;{}\\]/.test(brand))return null;
  return {query,term:category?category.label:brand,locality,
    category:category?{...category}:null,brand:category?null:brand};
}
const escapeRegex=s=>s.replace(/[.*+?^$()|[\]{}\\]/g,"\\$&");
export function poiOverpassQuery(intent,point){
  if(!intent||!coords(point))throw new PoiError("Selecciona una zona real para buscar comercios.");
  const around="(around:"+RADIUS+","+point.latitude+","+point.longitude+")";
  let selectors;
  if(intent.category){
    const key=intent.category.key,value=intent.category.value;
    selectors=value?['nwr["'+key+'"="'+value+'"]'+around+';']:
      ['nwr["shop"]'+around+';'];
    if(value==="pharmacy")selectors.push('nwr["shop"="chemist"]'+around+';');
  }else{
    const brand=escapeRegex(intent.brand.replace(/^oxxos$/i,"Oxxo").replace(/[^\p{L}\p{N} .&'-]/gu," ").trim());
    if(!brand)throw new PoiError("Nombre de negocio inválido.");
    selectors=['nwr["name"~"'+brand+'",i]'+around+';',
      'nwr["brand"~"'+brand+'",i]'+around+';'];
  }
  return '[out:json][timeout:12];('+selectors.join("")+');out center 65;';
}
const toRadians=n=>n*Math.PI/180;
const distance=(a,b)=>2*6371000*Math.asin(Math.min(1,Math.sqrt(
  Math.sin(toRadians(a.latitude-b.latitude)/2)**2+
  Math.cos(toRadians(a.latitude))*Math.cos(toRadians(b.latitude))*
  Math.sin(toRadians(a.longitude-b.longitude)/2)**2)));
export function poiFeatures(payload,intent,point){
  const items=Array.isArray(payload?.elements)?payload.elements:[];
  const found=[],seen=new Set();
  for(const item of items.slice(0,120)){
    if(!["node","way","relation"].includes(item?.type)||
      !Number.isSafeInteger(item.id)||item.id<=0)continue;
    const latitude=item.type==="node"?item.lat:item.center?.lat;
    const longitude=item.type==="node"?item.lon:item.center?.lon;
    const p={latitude,longitude};
    if(!coords(p)||distance(point,p)>RADIUS*1.2)continue;
    const tags=item.tags||{};
    const name=String(tags.name||tags["name:es"]||tags.brand||"").trim().slice(0,110);
    if(!name)continue;
    const detail=[
      [tags["addr:street"],tags["addr:housenumber"]].filter(Boolean).join(" "),
      tags["addr:city"],tags.amenity||tags.shop||null
    ].filter(Boolean).join(" · ").slice(0,220);
    const key=item.type+":"+item.id;
    if(seen.has(key))continue;seen.add(key);
    found.push({id:"osm:"+key,name,detail,latitude,longitude,
      precision:item.type==="node"?"place_point":"approximate_address",
      kind:"business_poi",osmType:item.type,osmId:item.id,
      distanceMeters:Math.round(distance(point,p)),approximate:item.type!=="node"});
  }
  return found.sort((a,b)=>a.distanceMeters-b.distanceMeters).slice(0,MAX_RESULTS);
}
export async function findPoi(input,{latitude,longitude,transport=fetch}={}){
  const intent=parsePoiQuery(input);
  if(!intent)throw new PoiError("Busca un comercio, categoría o nombre con ciudad: «Oxxo en Zapopan».");
  let point={latitude,longitude},zone="";
  // An explicit city always overrides the previously selected map point.
  if(intent.locality || !coords(point)){
    if(!intent.locality)return {query:intent.query,kind:"business_poi",
      needsLocation:true,results:[],source:"OpenStreetMap · Overpass",
      message:"¿En qué ciudad o zona buscas? Escribe «"+intent.term+" en Zapopan» o usa «Mi ubicación» para autorizarla."};
    const places=await findPlaces(intent.locality);
    const exact=places.results?.find(p=>fold(p.name)===fold(intent.locality))||
      places.results?.[0];
    if(!coords(exact))return {query:intent.query,kind:"business_poi",
      needsLocation:true,results:[],source:"OpenStreetMap · Overpass",
      message:"No se pudo localizar «"+intent.locality+"». Añade municipio, estado o usa coordenadas."};
    point={latitude:exact.latitude,longitude:exact.longitude};
    zone=exact.name+(exact.detail?" · "+exact.detail:"");
  }else zone="zona seleccionada en el mapa";
  const cacheKey=fold(intent.term)+"|"+(intent.category?.key||"")+
    "|"+(intent.category?.value||"")+
    "|"+fold(intent.brand||"")+
    "|"+point.latitude.toFixed(3)+","+point.longitude.toFixed(3);
  const prior=cache.get(cacheKey);
  if(prior&&prior.expires>Date.now())return {...prior.value,query:intent.query};
  if(inFlight.has(cacheKey))return {...await inFlight.get(cacheKey),query:intent.query};
  const task=(async()=>{
    const endpoint="https://overpass-api.de/api/interpreter";
    let data;
    try{
      const response=await transport(endpoint,{
        method:"POST",headers:{"content-type":"application/x-www-form-urlencoded",
          accept:"application/json"},
        body:new URLSearchParams({data:poiOverpassQuery(intent,point)}).toString(),
        redirect:"error",signal:AbortSignal.timeout(10500)
      });
      if(response.status===429||response.status===504)
        throw new PoiError("El servidor cartográfico está ocupado. Intenta de nuevo en un momento.",503,"poi_busy");
      if(!response.ok)throw Error("upstream_"+response.status);
      const raw=await response.text();
      if(raw.length>1700000)throw Error("poi_too_large");
      data=JSON.parse(raw);
      if(!data||!Array.isArray(data.elements))throw Error("poi_invalid_response");
    }catch(error){
      if(error instanceof PoiError)throw error;
      throw new PoiError("No se pudo consultar ahora el catálogo de comercios de OpenStreetMap.",502,"poi_source_unavailable");
    }
    const results=poiFeatures(data,intent,point);
    const value={query:intent.query,kind:"business_poi",needsLocation:false,
      source:"OpenStreetMap · Overpass",precision:"business_poi",
      center:point,zone,radiusMeters:RADIUS,results,
      message:results.length?null:
        "Sin establecimientos registrados en OpenStreetMap en esta zona. Prueba otro nombre, otra ciudad o acerca la búsqueda.",
      notice:"Datos comunitarios de OpenStreetMap: pueden faltar locales o estar desactualizados. No verifican horarios, apertura ni titularidad."};
    if(cache.size>150)cache.clear();
    cache.set(cacheKey,{value,expires:Date.now()+TTL});
    return value;
  })();
  inFlight.set(cacheKey,task);
  try{return await task;}
  finally{if(inFlight.get(cacheKey)===task)inFlight.delete(cacheKey);}
}
