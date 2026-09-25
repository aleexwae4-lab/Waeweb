// WAEWEB-owned, read-only POI index. Imported operator data, not a live map API.
// Data must originate from a licensed geographic extract; no invented branches.
import {readFileSync,statSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {nearbyIntent} from "../public/local-intent.js";
const DEFAULT_PATH=fileURLToPath(new URL("../data/pois.ndjson",import.meta.url));
const STEP=0.025,MAX_BYTES=40_000_000,DEFAULT_RADIUS=3500;
const byPath=new Map();
const fold=value=>String(value??"").normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").toLowerCase().trim();
const cell=(a,b)=>Math.floor(a/STEP)+":"+Math.floor(b/STEP);
const finite=n=>typeof n==="number"&&Number.isFinite(n);
export function validPoi(row){
  if(!row||typeof row!=="object"||
    !/^(?:node|way|relation)\/\d+$/.test(row.id||"")||
    !String(row.name||"").trim()||!finite(row.latitude)||!finite(row.longitude)||
    Math.abs(row.latitude)>90||Math.abs(row.longitude)>180)return false;
  return true;
}
function load(filePath=process.env.WAE_POI_INDEX_PATH||DEFAULT_PATH){
  let stat;
  try{stat=statSync(filePath);}catch{return null;}
  if(!stat.isFile()||stat.size>MAX_BYTES)return null;
  const old=byPath.get(filePath);
  if(old?.mtimeMs===stat.mtimeMs&&old.size===stat.size)return old;
  const buckets=new Map(),seen=new Set();
  let lines;
  try{lines=readFileSync(filePath,"utf8").split("\n");}
  catch{return null;}
  let header=null,count=0,minLat=90,maxLat=-90,minLon=180,maxLon=-180;
  for(const line of lines){
    if(!line.trim())continue;
    let record;
    try{record=JSON.parse(line);}catch{return null;}
    if(!header){
      if(record.kind!=="wae_poi_header"||record.schema!==1||
        record.license!=="ODbL-1.0"||typeof record.snapshot!=="string")
        return null;
      header=record;continue;
    }
    if(!validPoi(record)||seen.has(record.id))continue;
    seen.add(record.id);count++;
    minLat=Math.min(minLat,record.latitude);maxLat=Math.max(maxLat,record.latitude);
    minLon=Math.min(minLon,record.longitude);maxLon=Math.max(maxLon,record.longitude);
    const key=cell(record.latitude,record.longitude);
    if(!buckets.has(key))buckets.set(key,[]);
    buckets.get(key).push(record);
  }
  if(!header)return null;
  const index={mtimeMs:stat.mtimeMs,size:stat.size,buckets,count,
    bounds:[minLat,minLon,maxLat,maxLon],
    snapshot:header.snapshot,coverage:header.coverage||"unknown"};
  byPath.set(filePath,index);
  return index;
}
function matches(row,category){
  const name=fold(row.name),brand=fold(row.brand);
  switch(category){
    case "oxxo":return (name+" "+brand).includes("oxxo")&&row.shop==="convenience";
    case "telcel":return (name+" "+brand).includes("telcel")&&row.shop==="mobile_phone";
    case "bank":return row.amenity==="bank";
    case "atm":return row.amenity==="atm";
    case "cinema":return row.amenity==="cinema";
    case "convenience":return row.shop==="convenience";
    case "pharmacy":return row.amenity==="pharmacy"||row.shop==="chemist";
    case "supermarket":return row.shop==="supermarket";
    case "restaurant":return row.amenity==="restaurant";
    case "fuel":return row.amenity==="fuel";
    case "hospital":return row.amenity==="hospital";
    case "cafe":return row.amenity==="cafe";
    case "hotel":return row.tourism==="hotel";
    default:return false;
  }
}
const CATEGORY_ALIASES=Object.freeze({
  oxxo:"oxxo",bancos:"bank",bank:"bank",cajeros:"atm",atm:"atm",
  cines:"cinema",cinema:"cinema",conveniencia:"convenience",convenience:"convenience",
  farmacias:"pharmacy",pharmacy:"pharmacy",supermercados:"supermarket",
  supermarket:"supermarket",restaurantes:"restaurant",restaurant:"restaurant",
  gasolineras:"fuel",fuel:"fuel",hospitales:"hospital",hospital:"hospital",
  cafeterias:"cafe",cafe:"cafe",hoteles:"hotel",hotel:"hotel",telcel:"telcel"
});
const radians=n=>n*Math.PI/180;
function distance(a,b,c,d){
  const dlat=radians(c-a),dlon=radians(d-b);
  const h=Math.sin(dlat/2)**2+
    Math.cos(radians(a))*Math.cos(radians(c))*Math.sin(dlon/2)**2;
  return Math.round(12742000*Math.asin(Math.min(1,Math.sqrt(h))));
}
export function nativePoiStatus({filePath}={}){
  const index=load(filePath);
  return index?{ready:index.count>0,documents:index.count,
    snapshot:index.snapshot,coverage:index.coverage,source:"WAEWEB native POI index"}:
    {ready:false,documents:0,source:"WAEWEB native POI index",
      reason:"No valid operator-imported OSM snapshot on this instance"};
}
export function searchNativePoi({query="",category,latitude,longitude,
  radius=DEFAULT_RADIUS,filePath}={}){
  const index=load(filePath),normalizedCategory=CATEGORY_ALIASES[fold(category)];
  if(!index?.count||!normalizedCategory)return null;
  const lat=Number(latitude),lon=Number(longitude);
  if(latitude==null||longitude==null||latitude===""||longitude===""||
    !Number.isFinite(lat)||!Number.isFinite(lon)||
    Math.abs(lat)>90||Math.abs(lon)>180)return null;
  const metres=Number(radius);
  if(!Number.isFinite(metres)||metres<100||metres>10000)return null;
  const dy=metres/111000,dx=metres/(111000*Math.max(.1,Math.cos(radians(lat))));
  // Never imply a regional extract covers a coordinate outside its extent.
  const [south,west,north,east]=index.bounds;
  if(lat<south-dy||lat>north+dy||lon<west-dx||lon>east+dx)return null;
  const hits=[];
  for(let y=Math.floor((lat-dy)/STEP);y<=Math.floor((lat+dy)/STEP);y++)
    for(let x=Math.floor((lon-dx)/STEP);x<=Math.floor((lon+dx)/STEP);x++)
      for(const row of index.buckets.get(y+":"+x)||[]){
        if(!matches(row,normalizedCategory))continue;
        const meters=distance(lat,lon,row.latitude,row.longitude);
        if(meters>metres)continue;
        hits.push({id:row.id.replace("/",":"),name:row.name,
          latitude:row.latitude,longitude:row.longitude,
          detail:[row.street,row.houseNumber,row.city].filter(Boolean).join(" ")||
            "Registrado en OpenStreetMap · dirección no verificada",
          precision:"place_point",distanceMeters:meters,
          category:normalizedCategory,phone:row.phone||null,
          website:row.website||null,openingHours:row.openingHours||null});
      }
  hits.sort((a,b)=>a.distanceMeters-b.distanceMeters);
  return {query,source:"WAEWEB · índice geográfico nativo (© OpenStreetMap contributors)",
    engine:"native",indexPersistence:"operator_snapshot",
    datasetSnapshot:index.snapshot,coverage:index.coverage,
    precision:"poi",center:{latitude:lat,longitude:lon},radiusMeters:metres,
    results:hits.slice(0,60),
    message:hits.length?null:
      "No hay puntos registrados en el índice local dentro del radio elegido. La cobertura puede ser incompleta.",
    notice:"Datos ODbL de OpenStreetMap. Distancias aproximadas en línea recta; no confirma horarios ni operación."};
}

export function searchNativeNearby({query,latitude,longitude,filePath}){
  const intent=nearbyIntent(query);
  if(!intent)return null;
  return searchNativePoi({query,category:intent.category,latitude,longitude,
    radius:DEFAULT_RADIUS,filePath});
}
