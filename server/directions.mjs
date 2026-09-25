// WAEWEB route planning. Providers are opt-in and routes are always based on
// provider-returned road geometry; no straight-line or demo route is fabricated.
import {isIP} from "node:net";
import {findPlaces, mapCoordinates, MapsError} from "./maps.mjs";
import {guardedProvider,providerCircuitSnapshot,ProviderCircuitOpenError} from "./provider-resilience.mjs";

const ORS_MODES=Object.freeze({
  driving:"driving-car",walking:"foot-walking",cycling:"cycling-regular"
});
const OSRM_PROFILES=Object.freeze({
  driving:"driving",walking:"foot",cycling:"bike"
});
const OSRM_ENV=Object.freeze({
  driving:"WAE_OSRM_DRIVING_URL",walking:"WAE_OSRM_WALKING_URL",
  cycling:"WAE_OSRM_CYCLING_URL"
});
const FINITE=(x)=>typeof x==="number"&&Number.isFinite(x);
const coordsValid=([lon,lat])=>FINITE(lon)&&FINITE(lat)&&lon>=-180&&lon<=180&&lat>=-90&&lat<=90;
const clean=(value,max=240)=>String(value??"").replace(/[\u0000-\u001F\u007F]/g," ")
  .replace(/\s+/g," ").trim().slice(0,max);

export class DirectionsError extends Error {
  constructor(message,status=400,code="directions_invalid"){
    super(message);this.status=status;this.code=code;
  }
}

function safeOsrmBase(raw){
  if(typeof raw!=="string"||!raw.trim())return null;
  try{
    const u=new URL(raw.trim()),host=u.hostname.toLowerCase().replace(/\.$/,"");
    const local=process.env.WAE_ROUTING_ALLOW_LOCAL==="true"&&
      ["localhost","127.0.0.1","::1","[::1]"].includes(host);
    if(!(u.protocol==="https:"||u.protocol==="http:"&&local)||
      u.username||u.password||u.search||u.hash||
      (!local&&(isIP(host)||!host.includes("."))))return null;
    return u.origin+u.pathname.replace(/\/+$/,"");
  }catch{return null;}
}
function osrmBase(mode){
  const specific=process.env[OSRM_ENV[mode]]?.trim();
  const fallback=mode==="driving"?process.env.WAE_OSRM_URL?.trim():"";
  return safeOsrmBase(specific||fallback||"");
}
function osrmModes(){
  return Object.keys(OSRM_PROFILES).filter(mode=>Boolean(osrmBase(mode)));
}

export function routingCapabilities(){
  const requested=String(process.env.WAE_ROUTING_PROVIDER||"off").trim().toLowerCase();
  if(requested==="osrm"){
    const modes=osrmModes();
    const runtime=Object.fromEntries(modes.map(mode=>[
      mode,providerCircuitSnapshot("osrm:"+mode,{configured:true})
    ]));
    return {
      enabled:modes.length>0,provider:modes.length?"osrm":null,modes,
      keyRequired:false,selfHosted:true,requiresExplicitRequest:true,liveNavigation:false,
      geocodingPrecision:"selected_address_or_user_coordinates",runtime,
      note:modes.length
        ?"Rutas calculadas por OSRM configurado por el operador. Sin tráfico en tiempo real; cada modo requiere su propio perfil/endpoint."
        :"OSRM está seleccionado pero no tiene un endpoint HTTPS válido. No se usan servidores demo."
    };
  }
  const orsEnabled=requested==="ors" &&
    typeof process.env.WAE_ROUTING_API_KEY==="string" &&
    process.env.WAE_ROUTING_API_KEY.trim().length>=16;
  return {
    enabled:orsEnabled,provider:orsEnabled?"openrouteservice":null,
    modes:Object.keys(ORS_MODES),keyRequired:true,selfHosted:false,
    requiresExplicitRequest:true,liveNavigation:false,
    geocodingPrecision:"selected_address_or_user_coordinates",
    note:orsEnabled
      ?"Rutas estimadas. Selecciona una coincidencia geográfica o utiliza coordenadas; no hay tráfico en tiempo real."
      :"Cómo llegar requiere OSRM autohospedado o un proveedor de rutas configurado. No se simulan rutas ni indicaciones."
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
function boundedGeometry(raw){
  if(!Array.isArray(raw)||raw.length<2||raw.length>12000||
    !raw.every(x=>Array.isArray(x)&&x.length>=2&&coordsValid(x)))
    throw new DirectionsError("El proveedor devolvió una geometría de ruta inválida.",502,"invalid_route");
  return raw.length<=2200?raw:raw.filter((_,i)=>
    i===0||i===raw.length-1||i%Math.ceil(raw.length/2200)===0);
}
function decodeOrsRoute(data,origin,destination,mode){
  const feature=data?.features?.[0];
  const raw=feature?.geometry?.coordinates;
  const summary=feature?.properties?.summary;
  if(data?.type!=="FeatureCollection"||feature?.geometry?.type!=="LineString")
    throw new DirectionsError("El proveedor devolvió una geometría de ruta inválida.",502,"invalid_route");
  const points=boundedGeometry(raw);
  if(!FINITE(summary?.distance)||summary.distance<=0||!FINITE(summary?.duration)||summary.duration<=0)
    throw new DirectionsError("El proveedor no devolvió distancia o duración válidas.",502,"invalid_route");
  const steps=feature.properties?.segments?.flatMap(segment=>
    Array.isArray(segment.steps)?segment.steps:[])||[];
  const instructions=steps.filter(step=>
    typeof step.instruction==="string"&&step.instruction.trim()&&
    FINITE(step.distance)&&step.distance>=0&&FINITE(step.duration)&&step.duration>=0
  ).slice(0,160).map((step,i)=>({
    number:i+1,instruction:step.instruction.slice(0,320),
    distanceMeters:step.distance,durationSeconds:step.duration,
    road:typeof step.name==="string"?step.name.slice(0,150):""
  }));
  if(!instructions.length)
    throw new DirectionsError("El proveedor no devolvió indicaciones paso a paso verificables.",502,"steps_missing");
  return {
    mode,origin,destination,geometry:points.map(([longitude,latitude])=>[longitude,latitude]),
    distanceMeters:summary.distance,durationSeconds:summary.duration,steps:instructions,
    source:"openrouteservice",attribution:"© OpenStreetMap contributors · openrouteservice",
    caveat:"Ruta estimada, sin tráfico en tiempo real ni navegación GPS. Los puntos fueron seleccionados por coordenadas; su dirección y acceso vial no se verifican automáticamente."
  };
}
const MODIFIER_ES=Object.freeze({
  right:"a la derecha",left:"a la izquierda","slight right":"ligeramente a la derecha",
  "slight left":"ligeramente a la izquierda","sharp right":"pronunciadamente a la derecha",
  "sharp left":"pronunciadamente a la izquierda",straight:"recto",uturn:"en U"
});
function osrmInstruction(step,index,total){
  const maneuver=step?.maneuver&&typeof step.maneuver==="object"?step.maneuver:{};
  const type=clean(maneuver.type,40).toLowerCase();
  const modifier=MODIFIER_ES[clean(maneuver.modifier,40).toLowerCase()]||"";
  const road=clean(step?.name,140);
  const toward=road?" hacia "+road:"";
  if(type==="depart")return "Inicia el recorrido"+toward+".";
  if(type==="arrive"||index===total-1)return "Llegaste al destino.";
  if(type==="roundabout"||type==="rotary"){
    const exit=Number(maneuver.exit);
    return "En la glorieta, toma "+(Number.isInteger(exit)&&exit>0?"la salida "+exit:"la salida indicada")+toward+".";
  }
  if(["turn","fork","end of road","merge","on ramp","off ramp","continue","new name"].includes(type))
    return (type==="continue"?"Continúa":"Avanza")+(modifier?" "+modifier:"")+toward+".";
  return "Continúa"+(modifier?" "+modifier:"")+toward+".";
}
function decodeOsrmRoute(data,origin,destination,mode){
  if(data?.code!=="Ok"||!Array.isArray(data.routes)||!data.routes.length)
    throw new DirectionsError(
      data?.code==="NoRoute"?"No existe una ruta disponible entre los puntos seleccionados.":
        "OSRM no pudo calcular el recorrido.",
      data?.code==="NoRoute"?422:502,"routing_source_unavailable");
  const route=data.routes[0],geometry=route?.geometry;
  if(geometry?.type!=="LineString")
    throw new DirectionsError("OSRM no devolvió geometría GeoJSON válida.",502,"invalid_route");
  const points=boundedGeometry(geometry.coordinates);
  if(!FINITE(route.distance)||route.distance<=0||!FINITE(route.duration)||route.duration<=0)
    throw new DirectionsError("OSRM no devolvió distancia o duración válidas.",502,"invalid_route");
  const rawSteps=(Array.isArray(route.legs)?route.legs:[]).flatMap(leg=>
    Array.isArray(leg?.steps)?leg.steps:[]);
  const valid=rawSteps.filter(step=>FINITE(step?.distance)&&step.distance>=0&&
    FINITE(step?.duration)&&step.duration>=0&&step?.maneuver&&typeof step.maneuver==="object")
    .slice(0,160);
  if(!valid.length)
    throw new DirectionsError("OSRM no devolvió maniobras paso a paso verificables.",502,"steps_missing");
  const steps=valid.map((step,i)=>({
    number:i+1,instruction:osrmInstruction(step,i,valid.length),
    distanceMeters:step.distance,durationSeconds:step.duration,
    road:clean(step.name,150),
    maneuver:{type:clean(step.maneuver.type,40)||null,
      modifier:clean(step.maneuver.modifier,40)||null,
      exit:Number.isInteger(step.maneuver.exit)?step.maneuver.exit:null}
  }));
  return {
    mode,origin,destination,geometry:points.map(([longitude,latitude])=>[longitude,latitude]),
    distanceMeters:route.distance,durationSeconds:route.duration,steps,
    source:"OSRM",attribution:"© OpenStreetMap contributors · OSRM",
    caveat:"Ruta estimada, sin tráfico en tiempo real ni navegación GPS. Las instrucciones textuales se derivan de las maniobras y nombres de vía devueltos por OSRM."
  };
}
async function fetchOsrm(from,to,mode){
  const base=osrmBase(mode);
  if(!base)throw new DirectionsError(
    "OSRM no tiene un endpoint configurado para este modo de transporte.",503,"routing_unavailable");
  const profile=OSRM_PROFILES[mode];
  const coordinates=from.longitude.toFixed(6)+","+from.latitude.toFixed(6)+";"+
    to.longitude.toFixed(6)+","+to.latitude.toFixed(6);
  const endpoint=new URL(base+"/route/v1/"+profile+"/"+coordinates);
  endpoint.search=new URLSearchParams({
    alternatives:"false",steps:"true",geometries:"geojson",overview:"full"
  }).toString();
  const run=async()=>{
    let response;
    try{
      response=await fetch(endpoint,{headers:{accept:"application/json",
        "user-agent":"WAEWEB/1.0 (+https://github.com/aleexwae4-lab/Waeweb)"},
        redirect:"error",signal:AbortSignal.timeout(10_500)});
    }catch{throw new DirectionsError("No se pudo contactar con OSRM.",502,"routing_source_unavailable");}
    if(response.status===429||response.status===503)
      throw new DirectionsError("OSRM está temporalmente ocupado.",503,"routing_provider_busy");
    if(!response.ok)
      throw new DirectionsError("OSRM no pudo calcular el recorrido.",502,"routing_source_unavailable");
    return response;
  };
  let response;
  try{
    response=await guardedProvider("osrm:"+mode,run,{threshold:2,cooldownMs:45_000,
      retryable:error=>["routing_source_unavailable","routing_provider_busy","invalid_route"].includes(error?.code)||
        /fetch|timeout|abort/i.test(String(error?.message||""))});
  }catch(error){
    if(error instanceof ProviderCircuitOpenError)
      throw new DirectionsError("OSRM está temporalmente en recuperación. Intenta nuevamente en unos segundos.",503,"routing_circuit_open");
    throw error;
  }
  let data;
  try{
    const text=await response.text();
    if(text.length>1_500_000)throw Error("too_large");
    data=JSON.parse(text);
  }catch{throw new DirectionsError("Respuesta inválida de OSRM.",502,"invalid_route");}
  return decodeOsrmRoute(data,from,to,mode);
}
async function fetchOrs(from,to,mode){
  const endpoint=new URL("https://api.openrouteservice.org/v2/directions/"+ORS_MODES[mode]+"/geojson");
  let response;
  try{
    response=await fetch(endpoint,{
      method:"POST",redirect:"error",
      headers:{"content-type":"application/json",accept:"application/geo+json, application/json",
        authorization:process.env.WAE_ROUTING_API_KEY.trim()},
      body:JSON.stringify({coordinates:[
        [from.longitude,from.latitude],[to.longitude,to.latitude]
      ],instructions:true}),
      signal:AbortSignal.timeout(10_500)
    });
  }catch{throw new DirectionsError("No se pudo contactar con el motor de rutas.",502,"routing_source_unavailable");}
  if(response.status===429)throw new DirectionsError(
    "El motor de rutas alcanzó su cuota. Intenta de nuevo más tarde.",429,"routing_quota");
  if(!response.ok)throw new DirectionsError(
    response.status===404?"No existe una ruta disponible entre los puntos seleccionados.":
      "El proveedor de rutas no pudo calcular el recorrido.",
    response.status===404?422:502,"routing_source_unavailable");
  let data;
  try{
    const text=await response.text();
    if(text.length>1_200_000)throw Error("too_large");
    data=JSON.parse(text);
  }catch{throw new DirectionsError("Respuesta inválida del motor de rutas.",502,"invalid_route");}
  return decodeOrsRoute(data,from,to,mode);
}
export async function planDirections(payload){
  const caps=routingCapabilities();
  if(!caps.enabled)throw new DirectionsError(caps.note,503,"routing_unavailable");
  if(!payload||typeof payload!=="object"||Array.isArray(payload))
    throw new DirectionsError("Solicitud de ruta inválida.");
  const origin=locationValue(payload.origin,"origen");
  const destination=locationValue(payload.destination,"destino");
  if(!Object.hasOwn(OSRM_PROFILES,payload.mode))
    throw new DirectionsError("Elige automóvil, caminando o bicicleta.");
  if(!caps.modes.includes(payload.mode))
    throw new DirectionsError("El modo seleccionado no está configurado en el motor de rutas.",503,"routing_mode_unavailable");
  const from=await resolveLocation(origin,"origen");
  const to=await resolveLocation(destination,"destino");
  if(from.latitude===to.latitude&&from.longitude===to.longitude)
    throw new DirectionsError("El origen y el destino corresponden al mismo punto.");
  return caps.provider==="osrm"
    ?fetchOsrm(from,to,payload.mode)
    :fetchOrs(from,to,payload.mode);
}
