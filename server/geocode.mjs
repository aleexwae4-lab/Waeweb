// RC31: explicit, keyed address/place lookup (Pelias via openrouteservice).
// Not a public autocomplete scraper, not Open-Meteo address approximation.
import {mapCoordinates} from "./maps.mjs";
export class GeocodeError extends Error {
  constructor(message,status=400,code="geocode_invalid"){
    super(message);this.status=status;this.code=code;
  }
}
const finite=n=>typeof n==="number"&&Number.isFinite(n);
const validCoords=p=>Array.isArray(p)&&p.length>=2&&
  finite(p[0])&&finite(p[1])&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90;
export function addressCapabilities(){
  const enabled=process.env.WAE_ROUTING_PROVIDER==="ors" &&
    typeof process.env.WAE_ROUTING_API_KEY==="string" &&
    process.env.WAE_ROUTING_API_KEY.trim().length>=16;
  return {
    enabled,provider:enabled?"openrouteservice Pelias":null,
    manualSearchOnly:true,maxQueryChars:180,requiresSelection:true,
    note:enabled
      ?"Escribe una dirección o lugar y elige una coincidencia. Un resultado de geocodificación no verifica la existencia del local ni su acceso por carretera."
      :"La búsqueda precisa de direcciones necesita un motor geográfico autorizado. Usa coordenadas manuales o activa openrouteservice."
  };
}
function precision(p){
  const layer=p.layer,accuracy=p.accuracy;
  if(layer==="address"&&accuracy==="point")return "address_point";
  if(layer==="venue"&&accuracy==="point")return "place_point";
  if(layer==="address"||layer==="venue")return "approximate_address";
  if(layer==="street")return "street_centroid";
  return "locality_centroid";
}
export async function searchAddress(query,transport=fetch){
  const caps=addressCapabilities();
  if(!caps.enabled)throw new GeocodeError(caps.note,503,"geocode_unavailable");
  if(typeof query!=="string"||query.length>180||query.trim().length<3)
    throw new GeocodeError("Escribe al menos tres caracteres para buscar una dirección o un lugar.");
  const q=query.replace(/[\u0000-\u001F\u007F]/g," ").replace(/\s+/g," ").trim();
  const match=mapCoordinates(q);
  if(match)return {
    query:q,source:"Coordenadas proporcionadas",results:[{
      id:"manual-coordinate",name:"Ubicación por coordenadas",
      detail:"Punto indicado por el usuario · dirección no verificada",
      latitude:match.latitude,longitude:match.longitude,precision:"coordinate",layer:"coordinate"
    }]
  };
  const endpoint=new URL("https://api.openrouteservice.org/geocode/search");
  endpoint.searchParams.set("text",q);
  endpoint.searchParams.set("size","6");
  let response;
  try{
    response=await transport(endpoint,{headers:{
      accept:"application/json",
      authorization:process.env.WAE_ROUTING_API_KEY.trim()
    },redirect:"error",signal:AbortSignal.timeout(7000)});
  }catch{
    throw new GeocodeError("No se pudo consultar el proveedor de direcciones.",502,"geocode_source_unavailable");
  }
  if(response.status===429)throw new GeocodeError(
    "La búsqueda de direcciones alcanzó su cuota. Intenta de nuevo más tarde.",429,"geocode_quota");
  if(!response.ok)throw new GeocodeError(
    "El proveedor de direcciones no respondió correctamente.",502,"geocode_source_unavailable");
  let data;
  try{
    const text=await response.text();
    if(text.length>300000)throw Error("oversize");
    data=JSON.parse(text);
  }catch{throw new GeocodeError("Respuesta inválida del proveedor de direcciones.",502,"geocode_invalid_response");}
  if(!data||data.type!=="FeatureCollection"||!Array.isArray(data.features))
    throw new GeocodeError("Datos de direcciones incompletos.",502,"geocode_invalid_response");
  const seen=new Set();
  const results=data.features.slice(0,20).filter(feature=>
    feature?.geometry?.type==="Point"&&validCoords(feature.geometry.coordinates)&&
    typeof feature.properties?.label==="string"&&feature.properties.label.trim()
  ).map((feature,index)=>{
    const props=feature.properties;
    const [longitude,latitude]=feature.geometry.coordinates;
    const label=props.label.trim().slice(0,240);
    const name=typeof props.name==="string"&&props.name.trim()?
      props.name.trim().slice(0,120):label.slice(0,120);
    const level=precision(props);
    return {id:String(index)+":"+latitude.toFixed(6)+":"+longitude.toFixed(6),
      name,detail:label,latitude,longitude,precision:level,
      layer:typeof props.layer==="string"?props.layer.slice(0,40):"unknown",
      approximate:!["address_point","place_point"].includes(level)};
  }).filter(place=>{
    const key=place.latitude.toFixed(6)+","+place.longitude.toFixed(6);
    if(seen.has(key))return false;seen.add(key);return true;
  }).slice(0,6);
  return {
    query:q,source:"openrouteservice Pelias",results,
    message:results.length?null:
      "No hay coincidencias geográficas verificables. Añade ciudad, estado o país, o introduce coordenadas.",
    notice:"Las coincidencias son datos del proveedor; no prueban titularidad, accesibilidad ni exactitud postal."
  };
}
