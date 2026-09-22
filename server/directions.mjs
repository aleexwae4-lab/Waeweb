// RC30: opt-in, credentialed route planning. No demo servers and no straight-line
// substitutes are ever returned as a road route.
import {findPlaces, mapCoordinates, MapsError} from "./maps.mjs";

const MODES=Object.freeze({
  driving:"driving-car",walking:"foot-walking",cycling:"cycling-regular"
});
const FINITE=(x)=>typeof x==="number"&&Number.isFinite(x);
const coordsValid=([lon,lat])=>FINITE(lon)&&FINITE(lat)&&lon>=-180&&lon<=180&&lat>=-90&&lat<=90;
export class DirectionsError extends Error {
  constructor(message,status=400,code="directions_invalid"){
    super(message);this.status=status;this.code=code;
  }
}
export function routingCapabilities(){
  const enabled=process.env.WAE_ROUTING_PROVIDER==="ors" &&
    typeof process.env.WAE_ROUTING_API_KEY==="string" &&
    process.env.WAE_ROUTING_API_KEY.trim().length>=16;
  return {
    enabled,provider:enabled?"openrouteservice":null,
    modes:Object.keys(MODES),
    requiresExplicitRequest:true,liveNavigation:false,
    geocodingPrecision:"selected_address_or_user_coordinates",
    note:enabled
      ?"Rutas estimadas. Selecciona una coincidencia geográfica o utiliza coordenadas; no hay tráfico en tiempo real."
      :"Cómo llegar requiere un proveedor de rutas configurado. No se simulan rutas ni indicaciones."
  };
}
function locationValue(value,label){
  if(typeof value!=="string"||value.length>180||value.trim().length<2)
    throw new DirectionsError("Escribe un "+label+" válido (ciudad o coordenadas).");
  return value.trim();
}
async function resolveLocation(raw,label){
  if(!mapCoordinates(raw))
    throw new DirectionsError("Busca el "+label+" y elige una coincidencia, o escribe latitud,longitud. No se calculará una ruta desde una dirección ambigua.",409,"selection_required");
  let result;
  try { result=await findPlaces(raw); }
  catch(error){
    if(error instanceof MapsError)throw new DirectionsError(error.message,error.status,error.code);
    throw error;
  }
  const place=result.results?.[0];
  if(!place || !FINITE(place.latitude) || !FINITE(place.longitude))
    throw new DirectionsError("No se encontró el "+label+". Prueba con una ciudad o coordenadas verificables.",422,"place_not_found");
  return {
    name:place.name,detail:place.detail||"",latitude:place.latitude,longitude:place.longitude,
    precision:place.precision,
    alternatives:(result.results||[]).length>1?
      (result.results||[]).slice(1,5).map(x=>({name:x.name,detail:x.detail})):[],
    source:result.source
  };
}
function decodeRoute(data,origin,destination,mode){
  const feature=data?.features?.[0];
  const raw=feature?.geometry?.coordinates;
  const summary=feature?.properties?.summary;
  if(data?.type!=="FeatureCollection"||feature?.geometry?.type!=="LineString"||
     !Array.isArray(raw)||raw.length<2||raw.length>6000||
     !raw.every(x=>Array.isArray(x)&&x.length>=2&&coordsValid(x)))
    throw new DirectionsError("El proveedor devolvió una geometría de ruta inválida.",502,"invalid_route");
  if(!FINITE(summary?.distance)||summary.distance<=0||!FINITE(summary?.duration)||summary.duration<=0)
    throw new DirectionsError("El proveedor no devolvió distancia o duración válidas.",502,"invalid_route");
  const steps=feature.properties?.segments?.flatMap(segment=>
    Array.isArray(segment.steps)?segment.steps:[])||[];
  const instructions=steps.filter(step=>
    typeof step.instruction==="string"&&step.instruction.trim()&&
    FINITE(step.distance)&&step.distance>=0&&
    FINITE(step.duration)&&step.duration>=0
  ).slice(0,160).map((step,i)=>({
    number:i+1,instruction:step.instruction.slice(0,320),
    distanceMeters:step.distance,durationSeconds:step.duration,
    road:typeof step.name==="string"?step.name.slice(0,150):""
  }));
  if(!instructions.length)
    throw new DirectionsError("El proveedor no devolvió indicaciones paso a paso verificables.",502,"steps_missing");
  // Reduced geometry avoids large payloads while retaining real road vertices.
  const points=raw.length<=2200?raw:raw.filter((_,i)=>i===0||i===raw.length-1||i%Math.ceil(raw.length/2200)===0);
  return {
    mode,origin,destination,geometry:points.map(([longitude,latitude])=>[longitude,latitude]),
    distanceMeters:summary.distance,durationSeconds:summary.duration,
    steps:instructions,
    source:"openrouteservice",attribution:"© OpenStreetMap contributors · openrouteservice",
    caveat:"Ruta estimada, sin tráfico en tiempo real ni navegación GPS. Los puntos fueron seleccionados por coordenadas; su dirección y acceso vial no se verifican automáticamente."
  };
}
export async function planDirections(payload){
  const caps=routingCapabilities();
  if(!caps.enabled)throw new DirectionsError(caps.note,503,"routing_unavailable");
  if(!payload||typeof payload!=="object"||Array.isArray(payload))
    throw new DirectionsError("Solicitud de ruta inválida.");
  const origin=locationValue(payload.origin,"origen");
  const destination=locationValue(payload.destination,"destino");
  if(!Object.hasOwn(MODES,payload.mode))
    throw new DirectionsError("Elige automóvil, caminando o bicicleta.");
  // Explicit, non-background geocoding only. No Nominatim use, no invented addresses.
  const from=await resolveLocation(origin,"origen");
  const to=await resolveLocation(destination,"destino");
  if(from.latitude===to.latitude&&from.longitude===to.longitude)
    throw new DirectionsError("El origen y el destino corresponden al mismo punto.");
  const endpoint=new URL("https://api.openrouteservice.org/v2/directions/"+MODES[payload.mode]+"/geojson");
  const response=await (async()=>{
    try{
      return await fetch(endpoint,{
        method:"POST",redirect:"error",
        headers:{"content-type":"application/json",accept:"application/geo+json, application/json",
          authorization:process.env.WAE_ROUTING_API_KEY.trim()},
        body:JSON.stringify({coordinates:[
          [from.longitude,from.latitude],[to.longitude,to.latitude]
        ],instructions:true}),
        signal:AbortSignal.timeout(10500)
      });
    }catch{throw new DirectionsError("No se pudo contactar con el motor de rutas.",502,"routing_source_unavailable");}
  })();
  if(response.status===429)throw new DirectionsError(
    "El motor de rutas alcanzó su cuota. Intenta de nuevo más tarde.",429,"routing_quota");
  if(!response.ok)throw new DirectionsError(
    response.status===404?"No existe una ruta disponible entre los puntos seleccionados.":
      "El proveedor de rutas no pudo calcular el recorrido.",
    response.status===404?422:502,"routing_source_unavailable");
  let data;
  try{
    const text=await response.text();
    if(text.length>1200000)throw Error("too_large");
    data=JSON.parse(text);
  }catch{throw new DirectionsError("Respuesta inválida del motor de rutas.",502,"invalid_route");}
  return decodeRoute(data,from,to,payload.mode);
}
