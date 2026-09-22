import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {handler} from "../server/index.mjs";

test("explicit preview serves search/navigation and refuses ALL private or write API routes",async()=>{
  const names=["WAE_PREVIEW_MODE","VERCEL_ENV","WAE_ACCOUNTS_ENABLED"];
  const original=Object.fromEntries(names.map(name=>[name,process.env[name]]));
  const server=http.createServer(handler);
  try{
    process.env.WAE_PREVIEW_MODE="true";
    process.env.WAE_ACCOUNTS_ENABLED="true";
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+server.address().port;
    const get=async path=>fetch(base+path,{redirect:"manual"});
    const health=await (await get("/api/health")).json();
    assert.equal(health.previewMode,true);
    const capabilities=await (await get("/api/capabilities")).json();
    for(const flag of ["accountsEnabled","promotionsEnabled",
      "publicBusinessProfiles","marketplaceEnabled","marketplaceObjectMedia",
      "readerEnabled","connectApi"])assert.equal(capabilities[flag],false,flag);
    assert.equal(capabilities.indexPersistence,"disabled");
    assert.equal(capabilities.businessRegistration,"disabled");
    assert.equal(capabilities.previewMode,true);
    const homepage=await get("/");
    assert.equal(homepage.status,200);
    assert.doesNotMatch(await homepage.text(),/id="preview-banner"/);
    const browse=await get("/api/marketplace");
    assert.equal(browse.status,200);
    assert.deepEqual((await browse.json()).items,[]);
    assert.equal((await get("/api/account/me")).status,503);
    assert.equal((await get("/api/businesses/public")).status,503);
    assert.equal((await get("/api/connect/status")).status,503);
    assert.equal((await get("/api/index/search?q=local")).status,503);
    assert.equal((await get("/api/promotions/plan")).status,503);
    const blocked=await fetch(base+"/api/account/register",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({email:"not-created@example.test"})});
    assert.equal(blocked.status,503);
    assert.equal((await blocked.json()).previewMode,true);
    assert.equal((await fetch(base+"/api/read",{method:"POST"})).status,503);
    assert.equal((await fetch(base+"/api/promotions/webhook",{method:"POST"})).status,503);
    assert.equal((await fetch(base+"/api/marketplace",{method:"POST"})).status,503);
    const long="x".repeat(181);
    assert.equal((await get("/api/search?q="+long)).status,400,
      "public search remains reachable without external network call");
    assert.equal((await get("/api/weather?place="+long)).status,400);
    assert.equal((await get("/api/maps?q="+long)).status,400);
    assert.equal((await (await get("/api/maps?q=20.67%2C-103.35")).json()).results[0].precision,"coordinate");
  }finally{
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    for(const [name,value] of Object.entries(original))
      if(value===undefined)delete process.env[name];else process.env[name]=value;
  }
});
test("Vercel native preview environment enables guard without extra secrets",async()=>{
  const prior=process.env.VERCEL_ENV,explicit=process.env.WAE_PREVIEW_MODE;
  const server=http.createServer(handler);
  try{
    delete process.env.WAE_PREVIEW_MODE;
    process.env.VERCEL_ENV="preview";
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const url="http://127.0.0.1:"+server.address().port;
    assert.equal((await (await fetch(url+"/api/health")).json()).previewMode,true);
    assert.equal((await fetch(url+"/api/account/login",{method:"POST"})).status,503);
  }finally{
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    if(prior===undefined)delete process.env.VERCEL_ENV;else process.env.VERCEL_ENV=prior;
    if(explicit===undefined)delete process.env.WAE_PREVIEW_MODE;
    else process.env.WAE_PREVIEW_MODE=explicit;
  }
});
