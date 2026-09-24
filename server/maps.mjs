// WAEWEB P0 maps: free/open geographic search.
// Nominatim resolves addresses + named POIs. Results are cached aggressively to
// respect the public service policy; production scale should use a self-hosted
// instance or another OSM-compatible endpoint. No paid API is required.
const cache=new Map();
const inflight=new Map();
let nextPublicSlot=0;
const TTL_MS=30*60_000;
const COORDS=/^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*[,;]\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*$/;
const HEADERS={accept:"application/json","user-agent":"WAEWEB/1.0 (https://github.com/aleexwae4-lab/Waeweb)"};
export class MapsError extends Error{constructor(message,status=400,code="map_query_invalid"){super(message);this.status=status;this.code=code;}}
export function mapCoordinates(value){
  const match=String(value??"").match(COORDS);if(!match)return null;
  const latitude=Number(match[1]),longitude=Number(match[2]);
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||latitude < -90||latitude > 90||longitude < -180||longitude > 180)
    throw new MapsError("Coordenadas fuera de rango: latitud -90 a 90 y longitud -180 a 180.");
  return {latitude,longitude};
}
const finite=n=>Number.isFinite(Number(n));
const sanitize=value=>String(value??"").replace(/<[^>]*>/g," ").replace(/[\u0000-\u001F\u007F]/g," ").replace(/\s+/g," ").trim();
const kindOf=x=>x.type||x.addresstype||x.class||"place";
const category=x=>[x.category||x.class,x.type||x.addresstype].filter(Boolean).join(" · ");
function normalizeNominatim(item,index){
  if(!finite(item.lat)||!finite(item.lon))return null;
  const latitude=Number(item.lat),longitude=Number(item.lon);
  if(Math.abs(latitude)>90||Math.abs(longitude)>180)return null;
  const display=sanitize(item.display_name).slice(0,280);
  const named=sanitize(item.name||item.namedetails?.name||display.split(",")[0]).slice(0,140);
  if(!named)return null;
  const address=item.address&&typeof item.address==="object"?item.address:{};
  const locality=sanitize(address.city||address.town||address.village||address.municipality||address.county);
  const state=sanitize(address.state),country=sanitize(address.country);
  const detail=display||[named,locality,state,country].filter(Boolean).join(", ");
  const osmType=String(item.osm_type||"").toLowerCase(),osmId=String(item.osm_id||"");
  return {id:(osmType&&osmId?osmType+":"+osmId:String(index)+":"+latitude.toFixed(6)+":"+longitude.toFixed(6)),
    name:named,detail,latitude,longitude,precision:["house","building","amenity","shop","office","tourism","leisure"].includes(kindOf(item))?"place_point":"geocoded",
    category:category(item)||null,osmType:osmType||null,osmId:osmId||null,
    importance:finite(item.importance)?Number(item.importance):null,
    boundingBox:Array.isArray(item.boundingbox)?item.boundingbox.map(Number).filter(Number.isFinite):null};
}
async function nominatim(query,transport=fetch){
  const base=(process.env.WAE_NOMINATIM_URL||"https://nominatim.openstreetmap.org").trim().replace(/\/+$/,"");
  let endpoint;try{endpoint=new URL(base+"/search");}catch{throw new MapsError("El motor geográfico no está configurado correctamente.",503,"map_config_invalid");}
  endpoint.search=new URLSearchParams({q:query,format:"jsonv2",addressdetails:"1",namedetails:"1",limit:"20",
    "accept-language":"es-MX,es,en",dedupe:"1",...(process.env.WAE_MAP_COUNTRY_CODES?{countrycodes:process.env.WAE_MAP_COUNTRY_CODES}:{})}).toString();
  let response;
  try{
    // Nominatim's public endpoint: at most one request/second per process.
    // This does not enforce a global limit across multiple serverless instances.
    if(endpoint.hostname==="nominatim.openstreetmap.org" && transport===globalThis.fetch){
      const slot=Math.max(Date.now(),nextPublicSlot);
      nextPublicSlot=slot+1100;
      if(slot>Date.now())await new Promise(resolve=>setTimeout(resolve,slot-Date.now()));
    }
    response=await transport(endpoint,{headers:HEADERS,signal:AbortSignal.timeout(6000),redirect:"error"});
  }
  catch{throw new MapsError("No se pudo consultar el índice geográfico de OpenStreetMap.",502,"map_source_unavailable");}
  if(response.status===429)throw new MapsError("El índice geográfico está limitando solicitudes. Intenta nuevamente en unos segundos.",429,"map_rate_limited");
  if(!response.ok)throw new MapsError("El índice geográfico no respondió correctamente.",502,"map_source_unavailable");
  const raw=await response.text();if(raw.length>900000)throw new MapsError("Respuesta geográfica demasiado grande.",502,"map_invalid_response");
  let data;try{data=JSON.parse(raw);}catch{throw new MapsError("Respuesta geográfica inválida.",502,"map_invalid_response");}
  if(!Array.isArray(data))throw new MapsError("Respuesta geográfica inválida.",502,"map_invalid_response");
  const seen=new Set();
  return data.map(normalizeNominatim).filter(Boolean).filter(place=>{
    const key=place.latitude.toFixed(6)+","+place.longitude.toFixed(6)+":"+place.name.toLowerCase();
    if(seen.has(key))return false;seen.add(key);return true;
  }).slice(0,12);
}
export async function findPlaces(input,{fresh=false,transport=fetch}={}){
  if(typeof input!=="string"||input.length>180)throw new MapsError("La consulta geográfica supera 180 caracteres.");
  const query=sanitize(input);if(query.length<2)throw new MapsError("Escribe un lugar, negocio, dirección o dos coordenadas.");
  const pair=mapCoordinates(query);
  if(pair)return {query,source:"Coordenadas proporcionadas",precision:"coordinate",results:[{id:"coordinates",name:"Ubicación por coordenadas",detail:"Punto indicado por el usuario · sin dirección verificada",...pair,precision:"coordinate"}]};
  const key=query.normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
  const shared=transport===globalThis.fetch;
  const old=shared?cache.get(key):null;if(!fresh&&old&&old.expires>Date.now())return old.value;
  if(shared && inflight.has(key))return inflight.get(key);
  const task=(async()=>{
  const results=await nominatim(query,transport);
  const value={query,source:"OpenStreetMap · Nominatim",precision:"mixed",
    attribution:"Datos © colaboradores de OpenStreetMap · ODbL. Nominatim localiza direcciones, lugares y POI indexados.",
    results,message:results.length?null:"No se encontraron coincidencias. Añade colonia, ciudad o estado para precisar la búsqueda.",
    capabilities:{addresses:true,namedPlaces:true,businesses:true,poi:true,routing:false,
      note:"Las rutas se resuelven por el módulo de direcciones. Para búsquedas masivas de categorías se integrará Overpass con caché."}};
  if(shared){if(cache.size>500)cache.clear();cache.set(key,{value,expires:Date.now()+(results.length?TTL_MS:90_000)});}
  return value;
  })();
  if(!shared)return task;
  inflight.set(key,task);
  try{return await task;}finally{if(inflight.get(key)===task)inflight.delete(key);}
}
