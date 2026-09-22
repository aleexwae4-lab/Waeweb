import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import health from "../api/health.js";
import capabilities from "../api/capabilities.js";
import search from "../api/search.js";
import weather from "../api/weather.js";

async function checkRoute(api,path,status) {
  const server=http.createServer(api);
  try {
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const response=await fetch("http://127.0.0.1:"+server.address().port+path);
    assert.equal(response.status,status,path);
    assert.equal(response.headers.get("x-waeweb-api"),"1",path);
    assert.ok((response.headers.get("content-type")||"").includes("application/json"));
    return await response.json();
  } finally {if(server.listening)await new Promise(resolve=>server.close(resolve));}
}

test("named public API routes reach shared WAEWEB handler without vault",async()=>{
  assert.equal((await checkRoute(health,"/api/health",200)).product,"WAE WEB");
  assert.ok(Array.isArray((await checkRoute(capabilities,"/api/capabilities",200)).providers));
  assert.equal((await checkRoute(search,"/api/search?q="+ "x".repeat(181),400)).error,"La consulta supera 180 caracteres.");
  assert.equal((await checkRoute(weather,"/api/weather?place="+ "x".repeat(181),400)).error,"La localidad supera 180 caracteres.");
});
