import {nearbyIntent} from "../public/local-intent.js";
import {searchNativeNearby} from "./native-poi.mjs";
export class NearbyError extends Error {
  constructor(message,status=400){super(message);this.status=status;}
}
const filters={
  oxxo:'[shop=convenience][name~"OXXO",i]',
  bank:"[amenity=bank]",atm:"[amenity=atm]",cinema:"[amenity=cinema]",
  convenience:"[shop=convenience]",pharmacy:"[amenity=pharmacy]",
  supermarket:"[shop=supermarket]",restaurant:"[amenity=restaurant]",
  fuel:"[amenity=fuel]",hospital:"[amenity=hospital]",
  telcel:'[shop=mobile_phone][name~"Telcel",i]'
};
const cache=new Map();
export async function searchNearby({query,latitude,longitude},transport=fetch){
  const intent=nearbyIntent(query),lat=Number(latitude),lon=Number(longitude);
  if(!intent)throw new NearbyError("Consulta de lugares no reconocida.");
  if(latitude===null||latitude===undefined||longitude===null||longitude===undefined||
    latitude===""||longitude===""||!Number.isFinite(lat)||!Number.isFinite(lon)||
    Math.abs(lat)>90||Math.abs(lon)>180)
    throw new NearbyError("Necesitamos una ubicación autorizada y válida.");
  // A populated owned index answers immediately without any upstream request.
  const native=searchNativeNearby({query,latitude:lat,longitude:lon});
  if(native)return native;
  // Migration escape hatch. Strict native-only mode never contacts Overpass.
  if(process.env.WAE_NEARBY_EXTERNAL_FALLBACK==="false")
    throw new NearbyError("El índice geográfico nativo aún no tiene datos. Importa un extracto OSM de tu región.",503);
  const key=[intent.category,lat.toFixed(3),lon.toFixed(3)].join(":");
  const cached=cache.get(key);
  if(cached&&cached.expires>Date.now())return {...cached.value,query};
  const expression="[out:json][timeout:10];nwr(around:3500,"+lat+","+lon+")"+
    filters[intent.category]+";out center 100;";
  let response;
  try{
    response=await transport("https://overpass-api.de/api/interpreter",{
      method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({data:expression}).toString(),
      signal:AbortSignal.timeout(11000)});
  }catch{throw new NearbyError("La fuente comunitaria no respondió.",503);}
  if(!response.ok)throw new NearbyError("El índice geográfico no está disponible.",503);
  let parsed;
  try{
    const raw=await response.text();
    if(raw.length>1300000)throw Error("large");
    parsed=JSON.parse(raw);
    if(!Array.isArray(parsed.elements))throw Error("invalid");
  }catch{throw new NearbyError("Respuesta geográfica inválida.",502);}
  const distance=(a,b)=>{
    const r=Math.PI/180,dlat=(a-lat)*r,dlon=(b-lon)*r;
    const s=Math.sin(dlat/2)**2+Math.cos(lat*r)*Math.cos(a*r)*Math.sin(dlon/2)**2;
    return Math.round(12742000*Math.asin(Math.min(1,Math.sqrt(s))));
  };
  const seen=new Set(),results=[];
  for(const e of parsed.elements){
    const a=e.lat??e.center?.lat,b=e.lon??e.center?.lon;
    if(!Number.isFinite(a)||!Number.isFinite(b)||!Number.isInteger(e.id)||
      !["node","way","relation"].includes(e.type))continue;
    const name=String(e.tags?.name??"").trim();
    if(!name||distance(a,b)>3500)continue;
    const id=e.type+":"+e.id;
    if(seen.has(id))continue;seen.add(id);
    results.push({id,name:name.slice(0,120),latitude:a,longitude:b,
      detail:"Registrado en OpenStreetMap · dirección no verificada",
      precision:"place_point",distanceMeters:distance(a,b)});
  }
  results.sort((a,b)=>a.distanceMeters-b.distanceMeters);
  const value={query,source:"OpenStreetMap · Overpass",
    precision:"address_or_place",results:results.slice(0,30),
    message:results.length?null:"Sin negocios registrados en un radio de 3.5 km. Los datos pueden estar incompletos."};
  if(cache.size>150)cache.clear();
  cache.set(key,{value,expires:Date.now()+120000});
  return value;
}
