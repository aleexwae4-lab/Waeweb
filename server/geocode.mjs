// WAEWEB P0 address/POI geocoder: keyless OpenStreetMap Nominatim.
// For production volume set WAE_NOMINATIM_URL to a self-hosted compatible instance.
import {mapCoordinates} from "./maps.mjs";
export class GeocodeError extends Error{constructor(message,status=400,code="geocode_invalid"){super(message);this.status=status;this.code=code;}}
const finite=n=>Number.isFinite(Number(n));
const clean=x=>String(x??"").replace(/[\u0000-\u001F\u007F]/g," ").replace(/\s+/g," ").trim();
export function addressCapabilities(){return {enabled:true,provider:"OpenStreetMap · Nominatim",manualSearchOnly:false,maxQueryChars:180,requiresSelection:true,
  note:"Busca direcciones, lugares y comercios indexados en OpenStreetMap. Para alto volumen se requiere instancia propia o compatible."};}
export async function searchAddress(query,transport=fetch){
  if(typeof query!=="string"||query.length>180||query.trim().length<2)throw new GeocodeError("Escribe al menos dos caracteres para buscar una dirección o lugar.");
  const q=clean(query);const pair=mapCoordinates(q);
  if(pair)return {query:q,source:"Coordenadas proporcionadas",results:[{id:"manual-coordinate",name:"Ubicación por coordenadas",detail:"Punto indicado por el usuario · dirección no verificada",...pair,precision:"coordinate",layer:"coordinate"}]};
  const base=(process.env.WAE_NOMINATIM_URL||"https://nominatim.openstreetmap.org").trim().replace(/\/+$/,"");
  let endpoint;try{endpoint=new URL(base+"/search");}catch{throw new GeocodeError("El geocodificador no está configurado correctamente.",503,"geocode_unavailable");}
  endpoint.search=new URLSearchParams({q,format:"jsonv2",addressdetails:"1",namedetails:"1",limit:"8","accept-language":"es-MX,es,en",dedupe:"1",countrycodes:process.env.WAE_MAP_COUNTRY_CODES||"mx"}).toString();
  let response;try{response=await transport(endpoint,{headers:{accept:"application/json","user-agent":"WAEWEB/1.0 (https://github.com/aleexwae4-lab/Waeweb)"},redirect:"error",signal:AbortSignal.timeout(6000)});}
  catch{throw new GeocodeError("No se pudo consultar el proveedor de direcciones.",502,"geocode_source_unavailable");}
  if(response.status===429)throw new GeocodeError("El proveedor geográfico alcanzó temporalmente su límite.",429,"geocode_quota");
  if(!response.ok)throw new GeocodeError("El proveedor de direcciones no respondió correctamente.",502,"geocode_source_unavailable");
  let data;try{const raw=await response.text();if(raw.length>700000)throw Error("oversize");data=JSON.parse(raw);}catch{throw new GeocodeError("Respuesta inválida del proveedor de direcciones.",502,"geocode_invalid_response");}
  if(!Array.isArray(data))throw new GeocodeError("Datos de direcciones incompletos.",502,"geocode_invalid_response");
  const seen=new Set(),results=data.flatMap((item,index)=>{
    if(!finite(item.lat)||!finite(item.lon))return[];const latitude=Number(item.lat),longitude=Number(item.lon);
    if(Math.abs(latitude)>90||Math.abs(longitude)>180)return[];
    const label=clean(item.display_name).slice(0,260),name=clean(item.name||item.namedetails?.name||label.split(",")[0]).slice(0,120);
    if(!name)return[];const layer=clean(item.type||item.addresstype||item.class||"place").slice(0,40);
    const precise=/house|building|amenity|shop|office|tourism|leisure/.test(layer);
    return [{id:String(item.osm_type||index)+":"+String(item.osm_id||index),name,detail:label,latitude,longitude,
      precision:precise?"place_point":"geocoded",layer,approximate:!precise}];
  }).filter(place=>{const key=place.latitude.toFixed(6)+","+place.longitude.toFixed(6);if(seen.has(key))return false;seen.add(key);return true;}).slice(0,8);
  return {query:q,source:"OpenStreetMap · Nominatim",results,message:results.length?null:"No hay coincidencias. Añade colonia, ciudad, estado o país.",
    notice:"Las coincidencias proceden de OpenStreetMap; no prueban titularidad, horarios ni accesibilidad del establecimiento."};
}
