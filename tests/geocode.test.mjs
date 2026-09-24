import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFile} from "node:fs/promises";
import {searchAddress,addressCapabilities,GeocodeError} from "../server/geocode.mjs";
import {planDirections} from "../server/directions.mjs";
import placesAPI from "../api/places.js";

const keys=["WAE_ROUTING_PROVIDER","WAE_ROUTING_API_KEY","WAE_PREVIEW_MODE","VERCEL_ENV"];
const save=()=>Object.fromEntries(keys.map(key=>[key,process.env[key]]));
function restore(values){
  for(const [key,value]of Object.entries(values))
    if(value===undefined)delete process.env[key];else process.env[key]=value;
}
const sample=()=>({
  type:"FeatureCollection",
  features:[
    {type:"Feature",geometry:{type:"Point",coordinates:[-103.3475,20.6767]},
      properties:{name:"Calle 100",label:"Calle 100, Guadalajara, Jalisco, México",
        layer:"address",accuracy:"point"}},
    {type:"Feature",geometry:{type:"Point",coordinates:[-103.3410,20.6751]},
      properties:{name:"Calle 100",label:"Calle 100, Zapopan, Jalisco, México",
        layer:"street",accuracy:"centroid"}},
    {type:"Feature",geometry:{type:"Point",coordinates:[-103.3410,20.6751]},
      properties:{name:"Duplicate",label:"Duplicate street",
        layer:"address",accuracy:"point"}},
    {type:"Feature",geometry:{type:"Point",coordinates:[999,999]},
      properties:{name:"invalid",label:"invalid",layer:"venue"}}
  ]
});
test("Nominatim address lookup is keyless and enabled",async()=>{
  assert.equal(addressCapabilities().enabled,true);
  const data=await searchAddress("OXXO Zapopan",async(url,options)=>{
    const u=new URL(url);
    assert.equal(u.origin,"https://nominatim.openstreetmap.org");
    assert.equal(u.pathname,"/search");
    assert.equal(u.searchParams.get("q"),"OXXO Zapopan");
    assert.equal(u.searchParams.get("format"),"jsonv2");
    assert.equal(options.headers.authorization,undefined);
    return new Response(JSON.stringify([
      {osm_type:"node",osm_id:1,name:"OXXO",display_name:"OXXO, Zapopan, Jalisco, México",lat:"20.70",lon:"-103.40",type:"convenience"}
    ]),{status:200});
  });
  assert.equal(data.results.length,1);
  assert.equal(data.results[0].name,"OXXO");
  assert.equal(data.results[0].precision,"geocoded");
});
test("manual coordinates pass without external lookup and never become claimed postal addresses",async()=>{
  const old=save();
  try{
    process.env.WAE_ROUTING_PROVIDER="ors";
    process.env.WAE_ROUTING_API_KEY="test-placeholder-only-key";
    const data=await searchAddress("20.6767,-103.3475",()=>{throw Error("network unwanted")});
    assert.equal(data.source,"Coordenadas proporcionadas");
    assert.equal(data.results[0].precision,"coordinate");
    await assert.rejects(searchAddress("91,0"),e=>e.status===400);
    await assert.rejects(searchAddress("x"),e=>e instanceof GeocodeError&&e.status===400);
  }finally{restore(old);}
});
test("routes with ambiguous named places fail closed until user chooses coordinates",async()=>{
  const old=save(),prior=globalThis.fetch;
  try{
    process.env.WAE_ROUTING_PROVIDER="ors";
    process.env.WAE_ROUTING_API_KEY="test-placeholder-only-key";
    let calls=0;globalThis.fetch=()=>{calls++;throw Error("should not geocode silently")};
    await assert.rejects(planDirections({
      origin:"Calle 100, Guadalajara",destination:"20.6767,-103.3475",
      mode:"driving"
    }),error=>error.code==="selection_required"&&error.status===409);
    assert.equal(calls,0,"no fallback to first street or city centroid");
  }finally{globalThis.fetch=prior;restore(old);}
});
test("geocoder provider limit, invalid output and empty results show honest statuses",async()=>{
  await assert.rejects(searchAddress("Calle 100, Guadalajara",async()=>new Response("[]",{status:429})),e=>e.code==="geocode_quota"&&e.status===429);
  await assert.rejects(searchAddress("Calle 100, Guadalajara",async()=>new Response("{}",{status:200})),e=>e.code==="geocode_invalid_response"&&e.status===502);
  const result=await searchAddress("Calle 100, Guadalajara",async()=>new Response("[]",{status:200}));
  assert.deepEqual(result.results,[]);assert.match(result.message,/No hay coincidencias/);
});
test("named public /api/places route stays public in preview while signup remains blocked",async()=>{
  const old=save(),prior=globalThis.fetch;const server=http.createServer(placesAPI);
  try{
    process.env.WAE_PREVIEW_MODE="true";
    process.env.WAE_ROUTING_PROVIDER="ors";
    process.env.WAE_ROUTING_API_KEY="test-placeholder-only-key";
    globalThis.fetch=async(url,options)=>{
      if(String(url).startsWith("https://nominatim.openstreetmap.org/search"))
        return new Response(JSON.stringify([{osm_type:"node",osm_id:1,name:"Calle 100",display_name:"Calle 100, Guadalajara, Jalisco, México",lat:"20.6767",lon:"-103.3475",type:"house"}]),{status:200});
      return prior(url,options);
    };
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+server.address().port;
    const result=await fetch(base+"/api/places?q="+encodeURIComponent("Calle 100, Guadalajara"));
    assert.equal(result.status,200);
    assert.equal(result.headers.get("x-waeweb-api"),"1");
    assert.equal((await result.json()).results.length,1);
    assert.equal((await fetch(base+"/api/places",{method:"POST"})).status,503);
    assert.equal((await fetch(base+"/api/account/register",{method:"POST"})).status,503);
    assert.equal((await fetch(base+"/api/directions/capabilities")).status,200);
  }finally{
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    globalThis.fetch=prior;restore(old);
  }
});
test("WAEWEB map remains accessible for address query without locality result",async()=>{
  const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  const ui=await readFile(new URL("../public/directions.js",import.meta.url),"utf8");
  const server=await readFile(new URL("../server/index.mjs",import.meta.url),"utf8");
  assert.match(app,/function showDirectionsWithoutLocality/);
  assert.match(app,/showDirectionsWithoutLocality\(\)/);
  assert.match(app,/onDestinationSelect/);
  assert.match(ui,/\/api\/places\?q=/);
  assert.match(ui,/no se selecciona automáticamente la primera/);
  assert.match(ui,/lookups\[side\]\?\.abort/);
  assert.match(ui,/chosen\[side\]/);
  assert.match(server,/\/api\/places/);
  assert.match(server,/geolocation=\(self\)/);
});
