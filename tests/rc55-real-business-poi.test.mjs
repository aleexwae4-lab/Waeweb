import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {parsePoiQuery,poiOverpassQuery,poiFeatures,findPoi} from "../server/poi.mjs";
import {isPoiMapQuery} from "../public/maps-core.js";
import {handler} from "../server/index.mjs";

const point={latitude:20.735867,longitude:-103.404757};
const sample={elements:[
  {type:"node",id:101,lat:20.736,lon:-103.405,tags:{
    name:"OXXO",shop:"convenience","addr:street":"Av. Patria"}},
  {type:"way",id:102,center:{lat:20.74,lon:-103.4},tags:{
    brand:"OXXO",shop:"convenience"}},
  {type:"node",id:101,lat:20.736,lon:-103.405,tags:{name:"OXXO"}},
  {type:"node",id:200,lat:90,lon:100,tags:{name:"No pertenece a la zona"}},
  {type:"node",id:201,lat:20.737,lon:-103.405,tags:{}}
]};
const response=data=>new Response(JSON.stringify(data),{
  status:200,headers:{"content-type":"application/json"}});

test("business intent never hijacks ordinary cities, streets or exact coordinates",()=>{
  for(const q of ["Oxxo","Oxxo en Zapopan","Bancos en Guadalajara",
    "Cines","Comercios","Farmacias","Cinépolis","negocio Librería X en Jalisco"]){
    assert.equal(isPoiMapQuery(q),true,q);
    assert.ok(parsePoiQuery(q),q);
  }
  for(const q of ["Zapopan","Guadalajara","20.735867,-103.404757",
    "Calle Juárez 50","Hospital General","Oxxos cerca en guadalajara"]){
    assert.equal(isPoiMapQuery(q),false,q);
  }
  assert.equal(parsePoiQuery("Universidad de Guadalajara"),null);
});

test("unlocated Oxxo prompts for city; never fetches or guesses the user's location",async()=>{
  let calls=0;
  const data=await findPoi("Oxxo",{transport:()=>{calls++;throw Error("network");}});
  assert.equal(data.needsLocation,true);
  assert.deepEqual(data.results,[]);
  assert.match(data.message,/ciudad o zona/i);
  assert.equal(calls,0);
});

test("named brands and category clauses stay bounded and cannot inject Overpass commands",()=>{
  const brand=poiOverpassQuery(parsePoiQuery("Oxxo"),point);
  assert.match(brand,/\["name"~"Oxxo",i\]/);
  assert.match(brand,/\["brand"~"Oxxo",i\]/);
  assert.match(brand,/around:6500,20\.735867,-103\.404757/);
  assert.match(brand,/out center 65/);
  const bank=poiOverpassQuery(parsePoiQuery("Bancos"),point);
  assert.match(bank,/\["amenity"="bank"\]/);
  assert.doesNotMatch(bank,/\["name"~/);
  const cinema=poiOverpassQuery(parsePoiQuery("Cines"),point);
  assert.match(cinema,/\["amenity"="cinema"\]/);
  const shops=poiOverpassQuery(parsePoiQuery("Comercios"),point);
  assert.match(shops,/\["shop"\]/);
  assert.ok(!parsePoiQuery("sucursal x\");out body;")),
    "unsafe dynamic name does not produce an arbitrary site or QL code");
  assert.throws(()=>poiOverpassQuery(parsePoiQuery("Oxxo"),
    {latitude:90.5,longitude:-103}),{code:"poi_invalid"});
});

test("OSM nodes and way centers become explicit selectable POIs, never synthetic stores",()=>{
  const found=poiFeatures(sample,parsePoiQuery("Oxxo"),point);
  assert.equal(found.length,2);
  assert.equal(found[0].name,"OXXO");
  assert.equal(found[0].id,"osm:node:101");
  assert.equal(found[0].precision,"place_point");
  assert.equal(found[1].id,"osm:way:102");
  assert.equal(found[1].precision,"approximate_address");
  assert.equal(found[1].approximate,true);
  assert.ok(found.every(p=>p.distanceMeters<6500));
});

test("real map API: Oxxo near explicitly selected coordinates with no ORS key",async()=>{
  const priorFetch=globalThis.fetch,save=process.env.WAE_ROUTING_PROVIDER;
  process.env.WAE_ROUTING_PROVIDER="off";
  const server=http.createServer(handler);
  let remote=0;
  try{
    globalThis.fetch=async(input,options)=>{
      if(new URL(input).hostname==="127.0.0.1")return priorFetch(input,options);
      remote++;
      assert.equal(new URL(input).hostname,"overpass-api.de");
      assert.equal(options.method,"POST");
      const q=new URLSearchParams(options.body).get("data");
      assert.match(q,/\["name"~"Oxxo",i\]/);
      return response(sample);
    };
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const url="http://127.0.0.1:"+server.address().port+
      "/api/poi?q=Oxxo&lat=20.735867&lon=-103.404757";
    const res=await fetch(url);
    assert.equal(res.status,200);
    assert.equal(res.headers.get("x-waeweb-api"),"1");
    const data=await res.json();
    assert.equal(data.kind,"business_poi");
    assert.equal(data.source,"OpenStreetMap · Overpass");
    assert.equal(data.results.length,2);
    assert.equal(data.radiusMeters,6500);
    assert.equal(remote,1);
    assert.ok(!JSON.stringify(data).includes("api_key"));
    const cached=await (await fetch(url)).json();
    assert.equal(cached.results.length,2);
    assert.equal(remote,1);
    const unlocated=await (await fetch("http://127.0.0.1:"+
      server.address().port+"/api/poi?q=Oxxo")).json();
    assert.equal(unlocated.needsLocation,true);
  }finally{
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    globalThis.fetch=priorFetch;
    if(save===undefined)delete process.env.WAE_ROUTING_PROVIDER;
    else process.env.WAE_ROUTING_PROVIDER=save;
  }
});

test("explicit city resolves Open-Meteo centroid then searches bounded OSM area",async()=>{
  const before=globalThis.fetch;
  const seen=[];
  globalThis.fetch=async (input,options)=>{
    const u=new URL(input);seen.push(u.hostname);
    if(u.hostname==="geocoding-api.open-meteo.com")
      return response({results:[{id:23,name:"Zapopan",admin1:"Jalisco",
        country:"México",latitude:20.735867,longitude:-103.404757}]});
    assert.equal(u.hostname,"overpass-api.de");
    assert.match(new URLSearchParams(options.body).get("data"),
      /around:6500,20\.735867,-103\.404757/);
    return response(sample);
  };
  try{
    const data=await findPoi("Oxxo en Zapopan");
    assert.equal(data.results.length,2);
    assert.match(data.zone,/Zapopan/);
    assert.deepEqual(seen,["geocoding-api.open-meteo.com","overpass-api.de"]);
  }finally{globalThis.fetch=before;}
});

test("unavailable OSM data fails honestly without turning city centers into stores",async()=>{
  await assert.rejects(()=>findPoi("Cines",{...point,
    transport:async()=>new Response("down",{status:503})}),{
    code:"poi_source_unavailable",status:502
  });
  const empty=await findPoi("Bancos",{...point,transport:async()=>response({elements:[]})});
  assert.equal(empty.results.length,0);
  assert.match(empty.message,/Sin establecimientos registrados/);
});

test("map and route form both use native POI API, compact disclosure, no assumed city",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const route=readFileSync(new URL("../public/directions.js",import.meta.url),"utf8");
  const native=readFileSync(new URL("../public/native-map.js",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
  assert.match(app,/if\(isPoiMapQuery\(query\)\)/);
  assert.match(app,/getJSON\("\/api\/poi\?"\+parameters\.toString\(\),signal\)/);
  assert.match(app,/mapSearchAnchor=\{latitude:place\.latitude,longitude:place\.longitude\}/);
  assert.match(app,/getMapAnchor:\(\)=>mapSearchAnchor/g);
  assert.match(app,/showPoiSearchStatus\(data\)/);
  assert.match(app,/map\.fitPlaces\(places\)/);
  assert.match(route,/isPoiMapQuery\(query\)/);
  assert.match(route,/getMapAnchor\(\)/);
  assert.match(route,/addressReady\?"\/api\/places/);
  assert.match(native,/fitPlaces\(items\)/);
  assert.match(css,/\.map-category-chips/);
  assert.match(css,/\.map-poi-results/);
});
