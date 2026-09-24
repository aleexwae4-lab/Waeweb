import test from "node:test";
import assert from "node:assert/strict";
import {parseLocalPoiIntent,searchLocalPlaces} from "../server/poi.mjs";

test("natural POI queries detect category and city without inventing a location",()=>{
 assert.deepEqual(parseLocalPoiIntent("OXXO en Zapopan, Jalisco"),{
  category:"oxxo",location:"Zapopan, Jalisco",needsLocation:false,
  nearMe:false,originalQuery:"OXXO en Zapopan, Jalisco"
 });
 assert.equal(parseLocalPoiIntent("bancos en Guadalajara").category,"bancos");
 assert.equal(parseLocalPoiIntent("cafeterías cerca de Zapopan").category,"cafeterias");
 assert.equal(parseLocalPoiIntent("cines en CDMX").location,"CDMX");
 assert.equal(parseLocalPoiIntent("GitHub"),null);
 assert.equal(parseLocalPoiIntent("dirección de OXXO"),null);
 assert.equal(parseLocalPoiIntent("OXXO cerca de mí").needsLocation,true);
});
test("location-less queries never ask network or infer a location",async()=>{
 let calls=0;
 const result=await searchLocalPlaces("OXXO cerca de mí",{
  geocode:()=>{calls++;throw Error("geocode forbidden");},
  poi:()=>{calls++;throw Error("poi forbidden");}
 });
 assert.equal(result.status,"need_location");
 assert.equal(result.suggestedCategory,"oxxo");
 assert.equal(calls,0);
});
test("unambiguous city resolves through Overpass and retains provenance",async()=>{
 let calls=0;
 const result=await searchLocalPlaces("OXXO en Guadalajara",{
  geocode:async value=>{
   assert.equal(value,"Guadalajara");calls++;
   return {source:"OpenStreetMap · Nominatim",results:[
    {name:"Guadalajara",latitude:20.6767,longitude:-103.3475,precision:"geocoded"}
   ]};
  },
  poi:async params=>{
   calls++;assert.equal(params.category,"oxxo");assert.equal(params.radius,5000);
   assert.equal(params.latitude,20.6767);
   return {source:"OpenStreetMap · Overpass",
    center:{latitude:params.latitude,longitude:params.longitude},radiusMeters:5000,
    results:[{name:"OXXO Centro",latitude:20.67,longitude:-103.34,source:"OpenStreetMap · Overpass"}]};
  }
 });
 assert.equal(calls,2);
 assert.equal(result.status,"results");
 assert.equal(result.locationLabel,"Guadalajara");
 assert.equal(result.results[0].source,"OpenStreetMap · Overpass");
});
test("ambiguous city requires selection before nearby network request",async()=>{
 let poiCalls=0;
 const result=await searchLocalPlaces("bancos en Guadalupe",{
  geocode:async()=>({source:"OpenStreetMap · Nominatim",results:[
   {name:"Guadalupe NL",latitude:25.67,longitude:-100.25},
   {name:"Guadalupe Zac",latitude:22.75,longitude:-102.51}
  ]}),
  poi:()=>{poiCalls++;throw Error("must not guess center");}
 });
 assert.equal(result.status,"choose_location");
 assert.equal(result.results.length,2);
 assert.equal(result.suggestedCategory,"bancos");
 assert.equal(poiCalls,0);
});
test("empty POI lists stay empty and retain accurate center/radius",async()=>{
 const result=await searchLocalPlaces("cines en Zapopan",{
  geocode:async()=>({results:[{name:"Zapopan",latitude:20.72,longitude:-103.39}]}),
  poi:async({latitude,longitude,radius})=>({
   source:"OpenStreetMap · Overpass",center:{latitude,longitude},
   radiusMeters:radius,results:[]
  })
 });
 assert.equal(result.status,"empty");
 assert.deepEqual(result.results,[]);
 assert.equal(result.radiusMeters,5000);
 assert.match(result.message,/Amplía el radio/);
});
