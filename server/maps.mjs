// WAEWEB P0 maps: free/open geographic search.
// Nominatim resolves addresses and named places. Category/nearby searches use
// the dedicated POI modules so this endpoint never duplicates Overpass calls.
import {guardedProvider,providerCircuitSnapshot,ProviderCircuitOpenError} from "./provider-resilience.mjs";
const cache=new Map();
const inflight=new Map();
let nextPublicSlot=0;
const TTL_MS=30*60_000;
const COORDS=/^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*[,;]\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*$/;
const HEADERS={accept:"application/json","user-agent":"WAEWEB/1.0 (+https://github.com/aleexwae4-lab/Waeweb; maps-contact: repository-issues)"};

export class MapsError extends Error{
  constructor(message,status=400,code="map_query_invalid"){
    super(message);this.status=status;this.code=code;
  }
}

export function mapsInfrastructureStatus(){
  const operator=Boolean(process.env.WAE_NOMINATIM_URL?.trim());
  return {provider:"OpenStreetMap · Nominatim",
    mode:operator?"operator_controlled":"public_shared",
    cached:true,sharedPolicy:operator?null:"max_1_request_per_second",
    ...providerCircuitSnapshot("nominatim",{configured:true})};
}

export function mapCoordinates(value){
  const match=String(value??"").match(COORDS);
  if(!match)return null;
  const latitude=Number(match[1]),longitude=Number(match[2]);
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||
    latitude< -90||latitude>90||longitude< -180||longitude>180)
    throw new MapsError("Coordenadas fuera de rango: latitud -90 a 90 y longitud -180 a 180.");
  return {latitude,longitude};
}

const finite=value=>Number.isFinite(Number(value));
const clean=(value,max=280)=>String(value??"").replace(/<[^>]*>/g," ")
  .replace(/[\u0000-\u001F\u007F]/g," ").replace(/\s+/g," ").trim().slice(0,max);
function safeWebUrl(value){
  try{
    const url=new URL(String(value||""));
    return ["https:","http:"].includes(url.protocol)?url.href:null;
  }catch{return null;}
}
function normalizedBias(value){
  if(value==null)return null;
  const latitude=Number(value.latitude),longitude=Number(value.longitude);
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||
    Math.abs(latitude)>90||Math.abs(longitude)>180)
    throw new MapsError("La ubicación usada para ordenar resultados no es válida.");
  return {latitude,longitude};
}
function distanceKm(a,b){
  if(!a)return null;
  const radians=value=>value*Math.PI/180;
  const dLat=radians(b.latitude-a.latitude),dLon=radians(b.longitude-a.longitude);
  const h=Math.sin(dLat/2)**2+Math.cos(radians(a.latitude))*
    Math.cos(radians(b.latitude))*Math.sin(dLon/2)**2;
  return 6371*2*Math.atan2(Math.sqrt(h),Math.sqrt(Math.max(0,1-h)));
}
function pointPrecision(item){
  const category=String(item.category||item.class||"").toLowerCase();
  const type=String(item.type||item.addresstype||"").toLowerCase();
  if(type==="house")return "address_point";
  if(type==="building"||["amenity","shop","office","tourism","leisure","craft"].includes(category))
    return "place_point";
  return "geocoded";
}
function normalizeNominatim(item,index,query,bias){
  if(!finite(item.lat)||!finite(item.lon))return null;
  const latitude=Number(item.lat),longitude=Number(item.lon);
  if(Math.abs(latitude)>90||Math.abs(longitude)>180)return null;
  const display=clean(item.display_name);
  const named=clean(item.namedetails?.["name:es"]||item.name||
    item.namedetails?.name||display.split(",")[0],140);
  if(!named)return null;
  const address=item.address&&typeof item.address==="object"?item.address:{};
  const detail=display||[named,address.city||address.town||address.village,
    address.state,address.country].map(value=>clean(value,100)).filter(Boolean).join(", ");
  const osmType=clean(item.osm_type,12).toLowerCase(),osmId=clean(item.osm_id,30);
  const extra=item.extratags&&typeof item.extratags==="object"?item.extratags:{};
  const distance=distanceKm(bias,{latitude,longitude});
  const importance=finite(item.importance)?Number(item.importance):0;
  const exact=named.localeCompare(query,"es",{sensitivity:"base"})===0;
  const precision=pointPrecision(item);
  return {
    id:osmType&&osmId?osmType+":"+osmId:String(index)+":"+latitude.toFixed(6)+":"+longitude.toFixed(6),
    name:named,detail,latitude,longitude,precision,
    category:clean([item.category||item.class,item.type||item.addresstype].filter(Boolean).join(" · "),80)||null,
    type:clean(item.type||item.addresstype,60)||null,
    osmType:osmType||null,osmId:osmId||null,
    importance:finite(item.importance)?Number(item.importance):null,
    boundingBox:Array.isArray(item.boundingbox)?item.boundingbox.map(Number).filter(Number.isFinite):null,
    phone:clean(extra.phone||extra["contact:phone"],60)||null,
    website:safeWebUrl(extra.website||extra["contact:website"]),
    openingHours:clean(extra.opening_hours,140)||null,
    distanceKm:distance===null?null:Number(distance.toFixed(2)),
    approximate:!["address_point","place_point"].includes(precision),
    _rank:(exact?50:0)+importance*8-(distance??0)/20
  };
}

async function nominatim(query,{transport=fetch,bias=null}={}){
  const base=(process.env.WAE_NOMINATIM_URL||"https://nominatim.openstreetmap.org")
    .trim().replace(/\/+$/,"");
  let endpoint;
  try{endpoint=new URL(base+"/search");}
  catch{throw new MapsError("El motor geográfico no está configurado correctamente.",503,"map_config_invalid");}
  endpoint.search=new URLSearchParams({q:query,format:"jsonv2",addressdetails:"1",
    namedetails:"1",extratags:"1",limit:"20","accept-language":"es-MX,es,en",
    dedupe:"1",countrycodes:(process.env.WAE_MAP_COUNTRY_CODES||"mx").slice(0,40)}).toString();
  if(bias){
    const span=.45;
    endpoint.searchParams.set("viewbox",[bias.longitude-span,bias.latitude+span,
      bias.longitude+span,bias.latitude-span].join(","));
    endpoint.searchParams.set("bounded","0");
  }
  let response;
  try{
    // Public Nominatim permits at most one request/second per application.
    if(endpoint.hostname==="nominatim.openstreetmap.org"&&transport===globalThis.fetch){
      const slot=Math.max(Date.now(),nextPublicSlot);nextPublicSlot=slot+1100;
      if(slot>Date.now())await new Promise(resolve=>setTimeout(resolve,slot-Date.now()));
    }
    const run=async()=>{
      const result=await transport(endpoint,{headers:HEADERS,signal:AbortSignal.timeout(7000),redirect:"error"});
      if(result.status===429)throw new MapsError(
        "El índice geográfico está limitando solicitudes. Intenta nuevamente en unos segundos.",429,"map_rate_limited");
      if(!result.ok)throw new MapsError(
        "El índice geográfico no respondió correctamente.",502,"map_source_unavailable");
      return result;
    };
    response=transport===globalThis.fetch
      ?await guardedProvider("nominatim",run,{threshold:2,cooldownMs:45_000,
        retryable:error=>error instanceof ProviderCircuitOpenError||
          ["map_source_unavailable","map_rate_limited","map_invalid_response"].includes(error?.code)||
          /fetch|timeout|abort/i.test(String(error?.message||""))})
      :await run();
  }catch(error){
    if(error instanceof ProviderCircuitOpenError)
      throw new MapsError("El índice geográfico está temporalmente en recuperación. Intenta nuevamente en unos segundos.",503,"map_circuit_open");
    throw new MapsError("No se pudo consultar el índice geográfico de OpenStreetMap.",502,"map_source_unavailable");
  }
  const raw=await response.text();
  if(raw.length>900000)throw new MapsError("Respuesta geográfica demasiado grande.",502,"map_invalid_response");
  let data;
  try{data=JSON.parse(raw);}catch{throw new MapsError("Respuesta geográfica inválida.",502,"map_invalid_response");}
  if(!Array.isArray(data))throw new MapsError("Respuesta geográfica inválida.",502,"map_invalid_response");
  const seen=new Set();
  return data.map((item,index)=>normalizeNominatim(item,index,query,bias)).filter(Boolean)
    .sort((a,b)=>b._rank-a._rank).filter(place=>{
      const key=place.latitude.toFixed(6)+","+place.longitude.toFixed(6)+":"+place.name.toLowerCase();
      if(seen.has(key))return false;seen.add(key);return true;
    }).slice(0,12).map(({_rank,...place})=>place);
}

export async function findPlaces(input,{fresh=false,transport=fetch,bias=null}={}){
  if(typeof input!=="string"||input.length>180)
    throw new MapsError("La consulta geográfica supera 180 caracteres.");
  const query=clean(input,180);
  if(query.length<2)throw new MapsError("Escribe un lugar, negocio, dirección o dos coordenadas.");
  const pair=mapCoordinates(query);
  if(pair)return {query,source:"Coordenadas proporcionadas",precision:"coordinate",
    results:[{id:"coordinates",name:"Ubicación por coordenadas",
      detail:"Punto indicado por el usuario · sin dirección verificada",...pair,
      precision:"coordinate",category:"coordinate",type:null,phone:null,website:null,
      openingHours:null,distanceKm:null,approximate:false}]};
  const location=normalizedBias(bias);
  const key=query.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase()+":"+
    (location?location.latitude.toFixed(3)+","+location.longitude.toFixed(3):"mx");
  const shared=transport===globalThis.fetch;
  const old=shared?cache.get(key):null;
  if(!fresh&&old&&old.expires>Date.now())return old.value;
  if(shared&&inflight.has(key))return inflight.get(key);
  const task=(async()=>{
    const results=await nominatim(query,{transport,bias:location});
    const precision=results.some(item=>["address_point","place_point"].includes(item.precision))
      ?"address_or_place":"mixed";
    const value={query,source:"OpenStreetMap · Nominatim",precision,
      attribution:"Datos © colaboradores de OpenStreetMap · ODbL. Nominatim localiza direcciones y lugares indexados.",
      locationBias:location?"user_provided":null,results,
      message:results.length?null:"No se encontraron coincidencias. Añade colonia, ciudad o estado para precisar la búsqueda.",
      capabilities:{addresses:true,namedPlaces:true,businesses:true,poi:true,routing:false,
        note:"Las búsquedas por categoría y cercanía usan el módulo POI independiente."}};
    if(shared){
      if(cache.size>500)cache.clear();
      cache.set(key,{value,expires:Date.now()+(results.length?TTL_MS:90_000)});
    }
    return value;
  })();
  if(!shared)return task;
  inflight.set(key,task);
  try{return await task;}finally{if(inflight.get(key)===task)inflight.delete(key);}
}
