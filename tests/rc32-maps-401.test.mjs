import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFile} from "node:fs/promises";
import {localMapCoordinates,osmEmbedUrl} from "../public/maps-core.js";
import {handler} from "../server/index.mjs";

test("local coordinate map needs no geocoding API and checks range",()=>{
  assert.deepEqual(localMapCoordinates("20.6767,-103.3475"),
    {latitude:20.6767,longitude:-103.3475});
  assert.deepEqual(localMapCoordinates(" 20.6767 ; -103.3475 "),
    {latitude:20.6767,longitude:-103.3475});
  for(const wrong of ["Guadalajara","Calle 10, México","91,-103","20,-181",
    "20.6767,-103.3475,0",null,1,"", "x".repeat(181)]){
    assert.equal(localMapCoordinates(wrong),null,String(wrong));
  }
  assert.match(osmEmbedUrl(localMapCoordinates("20.6767,-103.3475")),
    /^https:\/\/www\.openstreetmap\.org\/export\/embed\.html/);
});

test("maps creates the existing map viewer before any public API for user coordinates",async()=>{
  const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  const start=app.indexOf("async function renderMap(query,signal,sequence)");
  const end=app.indexOf("// The SAME search bars",start);
  const map=app.slice(start,end);
  assert.ok(start>=0&&end>start);
  assert.match(map,/const point=localMapCoordinates\(query\)/);
  assert.ok(map.indexOf("renderMapPlaces({")<map.indexOf("getJSON(\"/api/maps?"),
    "the local-coordinate branch must precede remote request");
  assert.match(map,/precision:"coordinate"/);
  assert.match(map,/\/diagnostico\.html/);
  assert.match(app,/Vista general nativa de coordenadas/);
  assert.match(app,/showDirectionsWithoutLocality/);
  assert.match(app,/createNativeMap/);
  assert.doesNotMatch(map,/tile\.openstreetmap\.org/,"no uncontrolled tile scraping");
});

test("diagnostic page does not request credentials and distinguishes upstream HTTP 401",async()=>{
  const html=await readFile(new URL("../public/diagnostico.html",import.meta.url),"utf8");
  const js=await readFile(new URL("../public/diagnostico.js",import.meta.url),"utf8");
  const main=await readFile(new URL("../public/index.html",import.meta.url),"utf8");
  assert.match(main,/href="\/diagnostico\.html"/);
  assert.match(html,/id="run-diagnostics"/);
  assert.match(html,/id="diag-results"/);
  assert.match(js,/response\.headers\.get\("x-waeweb-api"\)==="1"/);
  assert.match(js,/response\.status===401&&!official/);
  assert.match(js,/response\.status===401/);
  assert.match(js,/credentials:"omit"/);
  assert.match(js,/\/api\/health/);
  assert.match(js,/\/api\/maps\?q=/);
  assert.match(js,/\/api\/directions\/capabilities/);
  assert.doesNotMatch(js,/authorization|localStorage|\/api\/index\/|\/api\/read/);
  assert.doesNotMatch(js,/window\.location\s*=|fetch\(["']https:/);
});

test("Node serves public map and diagnostic assets even in isolated preview",async()=>{
  const prior=process.env.WAE_PREVIEW_MODE;
  process.env.WAE_PREVIEW_MODE="true";
  const server=http.createServer((req,res)=>handler(req,res));
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+server.address().port;
    for(const [path,word]of [
      ["/diagnostico.html","run-diagnostics"],
      ["/diagnostico.js","x-waeweb-api"],
      ["/diagnostico.css","diag-main"],
      ["/maps-core.js","localMapCoordinates"]
    ]){
      const response=await fetch(base+path);
      assert.equal(response.status,200,path);
      assert.match(await response.text(),new RegExp(word));
    }
    const point=await fetch(base+"/api/maps?q=20.6767%2C-103.3475");
    assert.equal(point.status,200);
    assert.equal(point.headers.get("x-waeweb-api"),"1");
    const health=await fetch(base+"/api/health");
    assert.equal(health.status,200);
    assert.match((await health.json()).version,/rc\.35/);
    const blocked=await fetch(base+"/api/account/register",{method:"POST"});
    assert.equal(blocked.status,503,"diagnostics cannot unlock accounts");
  }finally{
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    if(prior===undefined)delete process.env.WAE_PREVIEW_MODE;
    else process.env.WAE_PREVIEW_MODE=prior;
  }
});
