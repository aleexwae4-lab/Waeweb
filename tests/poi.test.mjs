import test from "node:test";
import assert from "node:assert/strict";
import {detectPOI,lookupPOI,POIError} from "../server/poi.mjs";
import {findPlaces,mapCoordinates} from "../server/maps.mjs";

test("categorizes local searches with accent normalization",()=>{
  assert.deepEqual(detectPOI("OXXO en Zapopan"),{
    label:"OXXO",tag:"name",value:"OXXO",city:"zapopan",nearMe:false});
  assert.equal(detectPOI("cines en Guadalajara")?.city,"guadalajara");
  assert.equal(detectPOI("restaurantes cerca de mí")?.nearMe,true);
  assert.equal(detectPOI("Historia de México"),null);
});
test("does not invent a location for brand-only or near-me requests",async()=>{
  const result=await lookupPOI("OXXO");
  assert.equal(result.needsLocation,true);
  assert.deepEqual(result.results,[]);
  const nearby=await lookupPOI("bancos cerca de mí");
  assert.equal(nearby.needsLocation,true);
});
test("rejects invalid user coordinates before external calls",async()=>{
  await assert.rejects(()=>lookupPOI("bancos",{lat:91,lon:-103}),
    error=>error instanceof POIError&&error.code==="poi_invalid_position");
});
test("retains explicit coordinate behavior in the existing map",async()=>{
  assert.deepEqual(mapCoordinates("20.7,-103.4"),{latitude:20.7,longitude:-103.4});
  const result=await findPlaces("20.7,-103.4");
  assert.equal(result.precision,"coordinate");
});
test("returns source-backed POIs without inventing names or addresses",async()=>{
  const calls=[];
  const fake=async (url,options)=>{
    calls.push({url:String(url),options});
    return {ok:true,text:async()=>JSON.stringify({
      elements:[{type:"node",id:123,lat:20.7,lon:-103.4,
        tags:{name:"OXXO", "addr:street":"Av. Ejemplo"}}]})};
  };
  const found=await lookupPOI("OXXO",{lat:20.7,lon:-103.4,transport:fake});
  assert.equal(calls.length,1);
  assert.ok(calls[0].url.startsWith("https://overpass-api.de/"));
  assert.equal(found.results.length,1);
  assert.equal(found.results[0].osmUrl,"https://www.openstreetmap.org/node/123");
  assert.equal(found.results[0].name,"OXXO");
  assert.equal(found.results[0].detail,"Av. Ejemplo");
});
