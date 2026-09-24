// Small, bounded OSM points-of-interest search. Public Overpass is best effort,
// not a general geocoder or guaranteed commercial infrastructure.
const ENDPOINT="https://overpass-api.de/api/interpreter";
const CITIES=[
  [/zapopan/i,"Zapopan, Jalisco",20.7214,-103.3918],
  [/guadalajara|\bgdl\b/i,"Guadalajara, Jalisco",20.6767,-103.3475],
  [/ciudad de mexico|\bcdmx\b|mexico city/i,"Ciudad de México",19.4326,-99.1332],
  [/monterrey/i,"Monterrey, Nuevo León",25.6866,-100.3161],
  [/puebla/i,"Puebla, Puebla",19.0414,-98.2063],
  [/queretaro/i,"Querétaro, Querétaro",20.5888,-100.3899],
  [/tijuana/i,"Tijuana, Baja California",32.5149,-117.0382],
  [/merida/i,"Mérida, Yucatán",20.9674,-89.5926]
];
const GROUPS=[
  [/\bbancos?|cajeros?|\batm\b/i,"amenity","bank|atm"],
  [/\bcines?|cinemas?/i,"amenity","cinema"],
  [/restaurantes?|comida/i,"amenity","restaurant|fast_food"],
  [/gasolineras?|gas stations?/i,"amenity","fuel"],
  [/farmacias?/i,"amenity","pharmacy"],
  [/tiendas?|comercios?|supermercados?/i,"shop","convenience|supermarket|department_store"]
];
const BRANDS=/\b(?:oxxos?|7[\s-]?eleven|walmart|soriana|chedraui|costco|banorte|bbva|santander|banamex|citibanamex|hsbc|cinemex|cinepolis|starbucks)\b/i;
const fold=v=>String(v??"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase();
const clean=v=>String(v??"").replace(/[<>\u0000-\u001f]/g," ").replace(/\s+/g," ").trim();
const cache=new Map();
let nextRequest=0,day=-1,queriesToday=0;
export class PoiError extends Error {
  constructor(code,message,status=503){super(message);this.code=code;this.status=status;}
}
export function planPoiQuery(input){
  if(typeof input!=="string"||input.length>180)return null;
  const query=clean(input),normal=fold(query);
  const explicitCity=CITIES.find(city=>city[0].test(normal));
  const city=explicitCity||CITIES[0];
  const group=GROUPS.find(row=>row[0].test(normal));
  const brand=normal.match(BRANDS)?.[0]||null;
  if(query.length<2||!group&&!brand)return null;
  const named=brand?brand.replace(/[^a-z0-9]/g,"").replace(/^oxxos$/,"oxxo"):null;
  return {query,city,explicitCity:Boolean(explicitCity),brand:named,group,radius:4800};
}
export function overpassPoiStatement(plan){
  if(!plan||!Number.isFinite(plan.city?.[2])||!Number.isFinite(plan.city?.[3]))
    throw new PoiError("poi_invalid_query","Consulta local no válida.",400);
  const nearby="(around:"+plan.radius+","+plan.city[2]+","+plan.city[3]+")";
  const clauses=plan.brand
    ?["nwr"+nearby+"[\"name\"~\""+plan.brand+"\",i];",
      "nwr"+nearby+"[\"brand\"~\""+plan.brand+"\",i];"]
    :["nwr"+nearby+"[\""+plan.group[1]+"\"~\"^("+plan.group[2]+")$\"];"];
  return "[out:json][timeout:9];("+clauses.join("")+");out center 60;";
}
export function normalizePoiElements(elements,plan){
  const seen=new Set();
  return (Array.isArray(elements)?elements:[]).flatMap(item=>{
    const lat=Number(item?.lat??item?.center?.lat),lon=Number(item?.lon??item?.center?.lon);
    if(!Number.isFinite(lat)||!Number.isFinite(lon)||Math.abs(lat)>90||Math.abs(lon)>180||
      !["node","way","relation"].includes(item?.type)||
      !Number.isSafeInteger(item?.id)||item.id<=0)return [];
    const tags=item.tags||{},name=clean(tags.name||tags.brand||"").slice(0,120);
    if(!name||plan.brand&&!fold(name+" "+clean(tags.brand)).replace(/[^a-z0-9]/g,"").includes(plan.brand))
      return [];
    const id=item.type+"/"+item.id;
    if(seen.has(id))return [];seen.add(id);
    const address=[tags["addr:street"],tags["addr:housenumber"],tags["addr:suburb"],
      tags["addr:city"]].map(clean).filter(Boolean).join(", ");
    return [{id,name,detail:(address||plan.city[1]).slice(0,260),
      latitude:lat,longitude:lon,precision:"poi_osm",
      osmUrl:"https://www.openstreetmap.org/"+id,
      provenance:"OpenStreetMap / Overpass · ficha no verificada"}];
  }).slice(0,30);
}
export async function searchPoi(input,{transport=fetch,now=Date.now()}={}){
  const plan=planPoiQuery(input);
  if(!plan)return {query:clean(input),source:"OpenStreetMap · POI",results:[],notApplicable:true};
  const key=fold(plan.query),prior=cache.get(key);
  if(prior&&prior.expires>now)return prior.value;
  if(now<nextRequest)throw new PoiError("poi_busy","Se alcanzó el límite temporal de consultas locales.",429);
  const today=Math.floor(now/86400000);
  if(day!==today){day=today;queriesToday=0;}
  if(queriesToday>=120)throw new PoiError("poi_daily_limit",
    "Límite diario de búsquedas comunitarias alcanzado.",429);
  queriesToday++;nextRequest=now+4000;
  let data;
  try{
    const response=await transport(ENDPOINT,{
      method:"POST",headers:{"content-type":"application/x-www-form-urlencoded;charset=UTF-8",
        accept:"application/json",
        "user-agent":"WAEWEB-POI/1.0 (https://github.com/aleexwae4-lab/Waeweb)"},
      body:new URLSearchParams({data:overpassPoiStatement(plan)}),
      redirect:"error",signal:AbortSignal.timeout(10500)});
    if(!response.ok)throw Error("overpass_"+response.status);
    const body=await response.text();
    if(body.length>1200000)throw Error("overpass_oversize");
    data=JSON.parse(body);
    if(!Array.isArray(data.elements))throw Error("overpass_invalid");
  }catch{throw new PoiError("poi_source_unavailable",
    "La fuente comunitaria de comercios no respondió; el mapa de localidades sigue disponible.",502);}
  const results=normalizePoiElements(data.elements,plan);
  const value={query:plan.query,source:"OpenStreetMap · Overpass",
    precision:"poi_osm",results,searchArea:plan.city[1],
    radiusMeters:plan.radius,locationDefaulted:!plan.explicitCity,
    attribution:"© colaboradores de OpenStreetMap · ODbL; fichas no verificadas.",
    message:results.length?null:"Sin establecimientos etiquetados en esta zona. Prueba con otra ciudad."};
  if(cache.size>=220)cache.delete(cache.keys().next().value);
  cache.set(key,{value,expires:now+(results.length?600000:60000)});
  return value;
}
