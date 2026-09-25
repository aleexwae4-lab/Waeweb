import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFile} from "node:fs/promises";
import {handler} from "../server/index.mjs";
import health from "../api/health.js";
import caps from "../api/capabilities.js";
import maps from "../api/maps.js";

const keys=["VERCEL_ENV","VERCEL","WAE_PREVIEW_MODE","WAE_PUBLIC_FULL_RELEASE","WAE_ACCOUNTS_ENABLED","WAE_READER_ENABLED","VERCEL_GIT_COMMIT_SHA","RENDER","RENDER_SERVICE_ID","RENDER_GIT_COMMIT"];
const saved=()=>Object.fromEntries(keys.map(k=>[k,process.env[k]]));
function restore(before){for(const [k,v]of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
async function serverFor(fn){const server=http.createServer((req,res)=>Promise.resolve(fn(req,res)).catch(e=>{res.writeHead(500);res.end(e.message);}));await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));return {server,base:"http://127.0.0.1:"+server.address().port};}
async function close(server){if(server.listening)await new Promise(resolve=>server.close(resolve));}

test("Vercel production is isolated by default, even if account / reader env vars are set",async()=>{
  const old=saved();process.env.VERCEL_ENV="production";process.env.VERCEL="1";
  process.env.WAE_ACCOUNTS_ENABLED="true";process.env.WAE_READER_ENABLED="true";
  process.env.VERCEL_GIT_COMMIT_SHA="0123456789abcdef";
  delete process.env.WAE_PUBLIC_FULL_RELEASE;delete process.env.WAE_PREVIEW_MODE;
  const {server,base}=await serverFor(handler);
  try{
    const health=await fetch(base+"/api/health");
    assert.equal(health.status,200);
    assert.equal(health.headers.get("x-waeweb-api"),"1");
    assert.deepEqual(await health.json(),{status:"ok",product:"WAE WEB",
      version:"1.0.0-rc.55",previewMode:false,publicMode:"isolated",releaseGate:"HOLD",revision:"0123456789ab"});
    const c=await(await fetch(base+"/api/capabilities")).json();
    assert.equal(c.previewMode,false);
    assert.equal(c.isolatedMode,true);
    assert.equal(c.releaseGate,"HOLD");
    assert.equal(c.readerEnabled,false);
    assert.equal(c.accountsEnabled,false);
    assert.equal(c.promotionsEnabled,false);
    assert.equal(c.connectApi,false);
    const coords=await fetch(base+"/api/maps?q=20.6767%2C-103.3475");
    assert.equal(coords.status,200);
    assert.equal(coords.headers.get("x-waeweb-api"),"1");
    assert.equal((await coords.json()).results[0].precision,"coordinate");
    for(const [route,method] of [["/api/account/register","POST"],["/api/read","POST"],["/api/index/search?q=x","GET"],["/api/connect/health","GET"],["/api/promotions/plan","GET"]]){
      const response=await fetch(base+route,{method});
      assert.equal(response.status,503,method+" "+route);
    }
  }finally{await close(server);restore(old);}
});
test("even a production GO environment flag cannot bypass the independent HOLD manifest",async()=>{
  const old=saved();process.env.VERCEL_ENV="production";
  delete process.env.WAE_PREVIEW_MODE;process.env.WAE_PUBLIC_FULL_RELEASE="GO";
  const {server,base}=await serverFor(handler);
  try{
    const health=await(await fetch(base+"/api/health")).json();
    assert.equal(health.previewMode,false);
    assert.equal(health.publicMode,"isolated");
    assert.equal(health.releaseGate,"HOLD");
  }finally{await close(server);restore(old);}
});
test("Render production is never mislabeled preview while private APIs remain isolated on HOLD",async()=>{
  const old=saved();
  process.env.RENDER="true";process.env.RENDER_SERVICE_ID="srv-test";
  process.env.RENDER_GIT_COMMIT="abcdef0123456789";process.env.WAE_PREVIEW_MODE="true";
  process.env.WAE_ACCOUNTS_ENABLED="true";delete process.env.VERCEL_ENV;
  const {server,base}=await serverFor(handler);
  try{
    const health=await(await fetch(base+"/api/health")).json();
    assert.equal(health.previewMode,false);
    assert.equal(health.publicMode,"isolated");
    assert.equal(health.releaseGate,"HOLD");
    assert.equal(health.revision,"abcdef012345");
    const capabilities=await(await fetch(base+"/api/capabilities")).json();
    assert.equal(capabilities.previewMode,false);
    assert.equal(capabilities.isolatedMode,true);
    assert.equal(capabilities.deploymentConnected,true);
    assert.equal(capabilities.accountsEnabled,false);
    assert.equal((await fetch(base+"/api/account/register",{method:"POST"})).status,503);
  }finally{await close(server);restore(old);}
});

test("release HOLD protects hosted deployments without turning local test servers into preview",async()=>{
  const old=saved();
  for(const key of ["VERCEL_ENV","VERCEL","WAE_PREVIEW_MODE","RENDER","RENDER_SERVICE_ID","RENDER_GIT_COMMIT"])delete process.env[key];
  const {server,base}=await serverFor(handler);
  try{
    const health=await(await fetch(base+"/api/health")).json();
    assert.equal(health.previewMode,false);
    assert.equal(health.publicMode,"full");
    assert.equal(health.releaseGate,"HOLD");
    assert.equal((await fetch(base+"/api/does-not-exist")).status,404);
  }finally{await close(server);restore(old);}
});

test("Vercel named API functions, assets and outputs are shipped in one repo",async()=>{
  const vercel=JSON.parse(await readFile(new URL("../vercel.json",import.meta.url),"utf8"));
  assert.equal(vercel.outputDirectory,"public");
  for(const file of ["../public/index.html","../public/app.js","../public/browser.js","../public/native-map.js","../public/translator.js","../api/health.js","../api/capabilities.js","../api/maps.js","../api/search.js","../api/translate.js","../api/translate/capabilities.js"]){
    assert.ok((await readFile(new URL(file,import.meta.url),"utf8")).length>30,file);
  }
  for(const [name,fn]of [["health",health],["capabilities",caps],["maps",maps]]){
    const {server,base}=await serverFor(fn);
    try{
      const suffix=name==="maps"?"?q=20.6767%2C-103.3475":"";
      const result=await fetch(base+"/api/"+name+suffix);
      assert.equal(result.status,200,name);
      assert.equal(result.headers.get("x-waeweb-api"),"1",name);
    }finally{await close(server);}
  }
});
