import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mapCoordinates, findPlaces, MapsError } from "../server/maps.mjs";
import { osmEmbedUrl, osmPlaceUrl, validMapPlace } from "../public/maps-core.js";
import maps from "../api/maps.js";
import {handler} from "../server/index.mjs";

test("coordinates are truthful and bounded",async()=>{
  assert.deepEqual(mapCoordinates("20.67, -103.35"), {latitude:20.67,longitude:-103.35});
  assert.deepEqual(mapCoordinates("0;0"), {latitude:0,longitude:0});
  assert.throws(()=>mapCoordinates("91,-103"), MapsError);
  assert.throws(()=>mapCoordinates("20,-181"), MapsError);
  const direct=await findPlaces("20.67, -103.35");
  assert.equal(direct.results[0].precision,"coordinate");
  assert.equal(direct.results[0].name,"Ubicación por coordenadas");
  assert.equal(direct.results[0].latitude,20.67);
});
test("city geocoder attributes real coordinates and excludes malformed records",async()=>{
  const original=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async url=>{
    calls++;
    assert.match(String(url),/geocoding-api.open-meteo.com/);
    return new Response(JSON.stringify({results:[
      {id:123,name:"Guadalajara",admin1:"Jalisco",country:"México",latitude:20.6767,longitude:-103.3475},
      {name:"Falso",latitude:140,longitude:0},
      {id:123,name:"Guadalajara",admin1:"Jalisco",country:"México",latitude:20.6767,longitude:-103.3475}
    ]}),{status:200});
  };
  try{
    const data=await findPlaces("Guadalajara prueba geográfica");
    assert.equal(data.results.length,1);
    assert.match(data.results[0].detail,/Jalisco/);
    assert.equal(data.results[0].precision,"locality_centroid");
    assert.equal((await findPlaces("Guadalajara prueba geográfica")).results.length,1);
    assert.equal(calls,1,"cached repeat must not issue another public request");
  }finally{globalThis.fetch=original;}
});
test("provider failures and zero matches are never fabricated",async()=>{
  const prev=globalThis.fetch;
  globalThis.fetch=async()=>new Response("unavailable",{status:503});
  try {await assert.rejects(findPlaces("location source unavailable test"),e=>
    e.code==="map_source_unavailable"&&e.status===502);}
  finally{globalThis.fetch=prev;}
  globalThis.fetch=async()=>new Response(JSON.stringify({results:[]}),{status:200});
  try {
    const empty=await findPlaces("no match geographic test");
    assert.deepEqual(empty.results,[]);
    assert.match(empty.message,/No se encontraron/);
  }finally{globalThis.fetch=prev;}
});
test("map URLs are fixed to OpenStreetMap and numeric bbox/marker only",()=>{
  const place={latitude:20.6767,longitude:-103.3475};
  assert.equal(validMapPlace(place),true);
  const embed=new URL(osmEmbedUrl(place));
  assert.equal(embed.hostname,"www.openstreetmap.org");
  assert.equal(embed.pathname,"/export/embed.html");
  assert.equal(embed.searchParams.get("marker"),"20.6767,-103.3475");
  assert.equal(embed.searchParams.get("bbox").split(",").length,4);
  assert.match(osmPlaceUrl(place),/mlat=20.676700/);
  assert.throws(()=>osmEmbedUrl({latitude:NaN,longitude:0}),TypeError);
});
test("public named /api/maps route works without a vault in preview; writes blocked",async()=>{
  const prior=process.env.WAE_PREVIEW_MODE;
  process.env.WAE_PREVIEW_MODE="true";
  const server=http.createServer(maps);
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+server.address().port;
    const lookup=await fetch(base+"/api/maps?q=20.67%2C-103.35");
    assert.equal(lookup.status,200);
    assert.equal(lookup.headers.get("x-waeweb-api"),"1");
    const data=await lookup.json();
    assert.equal(data.results[0].precision,"coordinate");
    assert.equal((await fetch(base+"/api/maps?q=91%2C0")).status,400);
    assert.equal((await fetch(base+"/api/maps?q=x")).status,400);
    assert.equal((await fetch(base+"/api/maps",{method:"POST"})).status,503);
    assert.equal((await fetch(base+"/api/read",{method:"POST"})).status,503);
  }finally{
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    if(prior===undefined)delete process.env.WAE_PREVIEW_MODE;else process.env.WAE_PREVIEW_MODE=prior;
  }
});
test("WAEWEB map frontend remains integrated, attributable and isolated",async()=>{
  const {readFile}=await import("node:fs/promises");
  const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  const html=await readFile(new URL("../public/index.html",import.meta.url),"utf8");
  assert.match(app,/\/api\/maps\?q=/);
  assert.match(app,/createNativeMap/);
  assert.doesNotMatch(app,/<iframe|document\.createElement\("iframe"\)|element\("iframe"/);
  assert.match(app,/WAEWEB · MAPAS/);
  assert.match(app,/https:\/\/www\.openstreetmap\.org/);
  assert.doesNotMatch(app,/Mapa interactivo de OpenStreetMap/);
  assert.doesNotMatch(app,/↗ Mapa original/);
  assert.doesNotMatch(app,/© colaboradores de OpenStreetMap/);
  assert.match(html,/data-type="maps"/);
});
