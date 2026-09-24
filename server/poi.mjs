// Keyless, bounded OSM point-of-interest lookup. Never guesses a user's location.
const USER_AGENT="WAEWEB/1.0 (+https://github.com/aleexwae4-lab/Waeweb)";
const CATEGORIES=[
  ["oxxo","OXXO","name","OXXO"],
  ["bancos?","Bancos","amenity","bank"],
  ["cines?","Cines","amenity","cinema"],
  ["restaurantes?","Restaurantes","amenity","restaurant"],
  ["gasolineras?","Gasolineras","amenity","fuel"],
  ["farmacias?","Farmacias","amenity","pharmacy"],
  ["supermercados?","Supermercados","shop","supermarket"]
];
const fold=s=>String(s||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const cache=new Map();
let lastCall=0,day="",daily=0;
export class POIError extends Error{
  constructor(message,status=502,code="poi_unavailable"){
    super(message);this.status=status;this.code=code;
  }
}
export function detectPOI(query){
  const text=fold(query).trim();
  for(const [pattern,label,tag,value] of CATEGORIES){
    const re=new RegExp("\\b(?:"+pattern+")\\b","i");
    if(!re.test(text))continue;
    const nearMe=/\bcerca de mi\b/.test(text);
    const city=text.replace(re," ").replace(/\b(?:en|de|cerca|por|mi|un|una|los|las|buscar|encuentra|a)\b/g," ")
      .replace(/\s+/g," ").trim();
    return {label,tag,value,city:nearMe?"":city,nearMe};
  }
  return null;
}
async function load(response){
  if(!response.ok)throw Error("upstream_"+response.status);
  const raw=await response.text();
  if(raw.length>1100000)throw Error("oversize");
  return JSON.parse(raw);
}
const valid=(a,b)=>Number.isFinite(a)&&Math.abs(a)<=90&&Number.isFinite(b)&&Math.abs(b)<=180;
export async function lookupPOI(query,{lat,lon,transport=fetch}={}){
  const kind=detectPOI(query);
  if(!kind)return null;
  if(process.env.WAE_OVERPASS_ENABLED==="false")return null;
  const provided=lat!==undefined||lon!==undefined;
  if(provided&&!valid(Number(lat),Number(lon)))throw new POIError("Posición inválida.",400,"poi_invalid_position");
  if(!provided&&!kind.city)return {query,source:"OpenStreetMap",results:[],needsLocation:true,
    message:"Escribe una ciudad, por ejemplo: "+kind.label+" en Zapopan, o comparte tu ubicación."};
  const key=fold(query)+":"+lat+":"+lon,hit=cache.get(key);
  if(hit&&hit.until>Date.now())return hit.data;
  let center;
  try{
    if(provided)center={latitude:Number(lat),longitude:Number(lon)};
    else{
      const u=new URL("https://geocoding-api.open-meteo.com/v1/search");
      u.search=new URLSearchParams({name:kind.city,count:"3",language:"es",format:"json"}).toString();
      const geo=await load(await transport(u,{headers:{"user-agent":USER_AGENT},redirect:"error",
        signal:AbortSignal.timeout(4400)}));
      const place=(geo.results||[]).find(p=>p.country_code==="MX"&&valid(p.latitude,p.longitude));
      if(!place)return {query,source:"OpenStreetMap",results:[],
        message:"No encontré esa ciudad en México. Agrega localidad y estado."};
      center={latitude:place.latitude,longitude:place.longitude};
    }
  }catch{throw new POIError("No se pudo localizar la ciudad.",502,"poi_geocode_unavailable");}
  const today=new Date().toISOString().slice(0,10);
  if(day!==today){day=today;daily=0;}
  if(daily>=150||Date.now()-lastCall<3000)
    throw new POIError("El servidor comunitario requiere una pausa breve.",429,"poi_rate_limit");
  daily++;lastCall=Date.now();
  const around="(around:6500,"+center.latitude.toFixed(6)+","+center.longitude.toFixed(6)+")";
  const selector='nwr'+around+'["'+kind.tag+'"="'+kind.value+'"];';
  const ql="[out:json][timeout:8];"+selector+"out center 55;";
  let json;
  try{
    json=await load(await transport("https://overpass-api.de/api/interpreter",{
      method:"POST",headers:{"user-agent":USER_AGENT,"content-type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({data:ql}).toString(),
      redirect:"error",signal:AbortSignal.timeout(9500)}));
    if(!Array.isArray(json.elements))throw Error("invalid_payload");
  }catch{throw new POIError("Overpass no respondió; no se mostrarán fichas inventadas.");}
  const seen=new Set();
  const results=json.elements.flatMap(p=>{
    const latitude=Number(p.lat??p.center?.lat),longitude=Number(p.lon??p.center?.lon);
    const id=p.type+"/"+p.id;
    if(!["node","way","relation"].includes(p.type)||!Number.isSafeInteger(p.id)||
       !valid(latitude,longitude)||seen.has(id))return [];
    seen.add(id);
    const tags=p.tags||{};
    const name=String(tags.name||tags.brand||kind.label+" (sin nombre)").slice(0,130);
    const detail=[tags["addr:street"],tags["addr:housenumber"],tags["addr:city"]]
      .filter(Boolean).join(" ").slice(0,180)||"Ficha comunitaria de OpenStreetMap";
    return [{id:"osm:"+id,name,detail,latitude,longitude,precision:"poi",
      osmUrl:"https://www.openstreetmap.org/"+id}];
  }).slice(0,40);
  const data={query,source:"OpenStreetMap · Overpass",precision:"poi",results,
    attribution:"© colaboradores de OpenStreetMap",
    message:results.length?null:"No hay fichas de esta categoría en el radio consultado."};
  if(cache.size>100)cache.clear();
  cache.set(key,{data,until:Date.now()+600000});
  return data;
}
