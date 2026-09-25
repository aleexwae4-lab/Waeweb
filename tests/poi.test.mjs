import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {compilePoiQuery,searchPOI,PoiError,poiCategories} from "../server/poi.mjs";
import poiAPI from "../api/poi.js";

const sample=[
 {type:"node",id:123,lat:20.6767,lon:-103.3475,tags:{name:"OXXO Plaza",brand:"OXXO",opening_hours:"Mo-Su 07:00-23:00",phone:"123456"}},
 {type:"way",id:124,center:{lat:20.6769,lon:-103.3476},tags:{name:"OXXO Centro",website:"https://example.org"}},
 {type:"node",id:125,lat:89,lon:0,tags:{name:"Invalid far POI"}},
 {type:"node",id:-1,lat:20.6767,lon:-103.3475,tags:{name:"Invalid ID"}}
];
test("POI catalog is allowlisted and query language cannot be injected",()=>{
 assert.ok(poiCategories().find(item=>item.id==="oxxo"));
 const query=compilePoiQuery({latitude:20.6767,longitude:-103.3475,radius:2500,category:"oxxo"});
 assert.match(query.ql,/nwr\(around:2500,20\.676700,-103\.347500\)/);
 assert.match(query.ql,/\[out:json\]\[timeout:12\]/);
 assert.match(query.ql,/\["name"="OXXO"\]/);
 assert.doesNotMatch(query.ql,/\["name"~/);
 assert.throws(()=>compilePoiQuery({latitude:20.6,longitude:-103.3,category:'oxxo"];out body;'}),PoiError);
 assert.throws(()=>compilePoiQuery({latitude:20.6,longitude:-103.3,radius:100000,category:"oxxo"}),PoiError);
 assert.throws(()=>compilePoiQuery({latitude:999,longitude:-103.3,category:"oxxo"}),PoiError);
});
test("Overpass parser returns actual bounded and attributed POIs",async()=>{
 let count=0;
 const r=await searchPOI({latitude:20.6767,longitude:-103.3475,radius:2500,category:"oxxo"},
   {transport:async(url,options)=>{
     count++;
     assert.equal(new URL(url).pathname,"/api/interpreter");
     assert.equal(options.method,"POST");
     assert.ok(new URLSearchParams(options.body).get("data").includes("OXXO"));
     return new Response(JSON.stringify({elements:sample}),{status:200});
   }});
 assert.equal(count,1);
 assert.equal(r.results.length,2);
 assert.match(r.results[0].url,/openstreetmap\.org\/node\/123/);
 assert.equal(r.results[0].name,"OXXO Plaza");
 assert.equal(r.results[0].openingHours,"Mo-Su 07:00-23:00");
 assert.equal(r.results[0].source,"OpenStreetMap · Overpass");
 assert.ok(r.results.every(item=>item.distanceMeters<=2500));
});
test("POI outage and invalid payload do not invent local businesses",async()=>{
 const input={latitude:20.6767,longitude:-103.3475,category:"bancos"};
 await assert.rejects(searchPOI(input,{transport:async()=>new Response("fail",{status:503})}),
   e=>e.code==="poi_provider_busy");
 await assert.rejects(searchPOI(input,{transport:async()=>new Response("{}",{status:200})}),
   e=>e.code==="poi_invalid_response");
 const empty=await searchPOI(input,{transport:async()=>new Response('{"elements":[]}',{status:200})});
 assert.deepEqual(empty.results,[]);
 assert.match(empty.message,/No hay comercios/);
});
test("GET /api/poi stays public in preview; unsafe methods blocked",async()=>{
 const old=process.env.WAE_PREVIEW_MODE,original=globalThis.fetch;
 process.env.WAE_PREVIEW_MODE="true";
 globalThis.fetch=async (url,options)=>{
   if(String(url).startsWith("https://overpass-api.de/api/interpreter"))
     return new Response(JSON.stringify({elements:sample}),{status:200});
   return original(url,options);
 };
 const server=http.createServer(poiAPI);
 try{
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+server.address().port;
  const reply=await original(base+"/api/poi?lat=20.6767&lon=-103.3475&category=oxxo");
  assert.equal(reply.status,200);
  assert.equal((await reply.json()).results.length,2);
  const status=await original(base+"/api/poi/status");
  assert.equal(status.status,200);
  assert.equal(typeof (await status.json()).native.ready,"boolean");
  assert.equal((await original(base+"/api/poi?lat=999&lon=0&category=oxxo")).status,400);
  assert.equal((await original(base+"/api/poi",{method:"POST"})).status,503);
 }finally{
  if(server.listening)await new Promise(resolve=>server.close(resolve));
  globalThis.fetch=original;
  if(old===undefined)delete process.env.WAE_PREVIEW_MODE;else process.env.WAE_PREVIEW_MODE=old;
 }
});
