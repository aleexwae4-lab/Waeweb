// Offline, operator-run transformation of licensed OSM-derived GeoJSON
// FeatureCollection or GeoJSON Sequence into the WAEWEB point index.
// Usage: node scripts/import-pois.mjs ./extract.geojsonseq [./data/pois.ndjson]
import {createReadStream,createWriteStream} from "node:fs";
import {readFile,rename,rm,stat,mkdir} from "node:fs/promises";
import {dirname,resolve} from "node:path";
import {createInterface} from "node:readline";
import {once} from "node:events";
import {fileURLToPath} from "node:url";
import {validPoi} from "../server/native-poi.mjs";
const OUT=fileURLToPath(new URL("../data/pois.ndjson",import.meta.url));
const CATEGORIES=new Set(["bank","atm","cinema","pharmacy","restaurant","fuel","hospital"]);
const SHOPS=new Set(["convenience","mobile_phone","chemist","supermarket"]);
const str=v=>typeof v==="string"?v.trim().slice(0,120):"";
export function extractPoi(feature){
  if(feature?.type!=="Feature"||feature.geometry?.type!=="Point"||
    !Array.isArray(feature.geometry.coordinates))return null;
  const p=feature.properties||{},tags=p.tags&&typeof p.tags==="object"?p.tags:p;
  const raw=str(p["@id"]||p.osm_id);
  const id=/^(node|way|relation)\/\d+$/.test(raw)?raw:
    /^(node|way|relation)$/.test(p.osm_type)&&/^\d+$/.test(String(p.osm_id||""))
      ?p.osm_type+"/"+p.osm_id:null;
  const name=str(tags.name),amenity=str(tags.amenity),shop=str(tags.shop);
  const [longitude,latitude]=feature.geometry.coordinates;
  const row={id,name,latitude,longitude,amenity,shop,
    brand:str(tags.brand),street:str(tags["addr:street"]),
    houseNumber:str(tags["addr:housenumber"]),city:str(tags["addr:city"])};
  return id&&(CATEGORIES.has(amenity)||SHOPS.has(shop))&&validPoi(row)?row:null;
}
async function* records(path){
  if(/\.geojson$|\.json$/i.test(path)){
    const size=(await stat(path)).size;
    if(size>50_000_000)throw Error("Large dataset: export GeoJSON Sequence for streaming");
    const json=JSON.parse(await readFile(path,"utf8"));
    if(json.type!=="FeatureCollection"||!Array.isArray(json.features))
      throw Error("Expected GeoJSON FeatureCollection");
    yield* json.features;
  }else{
    const rl=createInterface({input:createReadStream(path,{encoding:"utf8"}),crlfDelay:Infinity});
    for await(const line of rl){
      if(!line.trim())continue;
      const entry=JSON.parse(line.replace(/^\x1e/,""));
      yield entry;
    }
  }
}
export async function importPois(input,output=OUT,{snapshot=new Date().toISOString().slice(0,10),
  coverage="operator-supplied OSM extract"}={}){
  if(!input||resolve(input)===resolve(output))throw Error("Input must differ from output");
  await mkdir(dirname(output),{recursive:true});
  const tmp=output+".tmp-"+process.pid;
  const stream=createWriteStream(tmp,{encoding:"utf8",flags:"wx"});
  let count=0,seen=new Set();
  try{
    const header={kind:"wae_poi_header",schema:1,license:"ODbL-1.0",
      snapshot,coverage};
    stream.write(JSON.stringify(header)+"\n");
    for await(const feature of records(input)){
      const poi=extractPoi(feature);
      if(!poi||seen.has(poi.id))continue;
      seen.add(poi.id);
      if(!stream.write(JSON.stringify(poi)+"\n"))await once(stream,"drain");
      if(++count>120000)throw Error("Pilot index exceeded 120000 places; shard per region");
    }
    stream.end();await once(stream,"finish");
    await rename(tmp,output);
    return {records:count,output,license:"ODbL-1.0",snapshot,coverage};
  }catch(error){
    stream.destroy();await rm(tmp,{force:true}).catch(()=>{});
    throw error;
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  importPois(process.argv[2],process.argv[3]||OUT,{
    snapshot:process.env.WAE_OSM_SNAPSHOT||new Date().toISOString().slice(0,10),
    coverage:process.env.WAE_OSM_COVERAGE||"operator-supplied OSM extract"
  }).then(value=>console.log(JSON.stringify(value)),error=>{
    console.error(error.message);process.exitCode=1;
  });
}
