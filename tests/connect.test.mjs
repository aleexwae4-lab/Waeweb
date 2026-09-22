import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { handler } from "../server/index.mjs";
import { connectConfig, authorizeConnect, connectRequest, handleConnect, safeResults, CONNECT_VERSION } from "../server/connect.mjs";
import { connectAdmissionReady, connectAdmissionConfig } from "../server/connect-postgres.mjs";

const clients={
  inteligenciauniversal:"alpha-test-"+ "a".repeat(40),
  "universal-core-vt3h":"beta-test-"+ "b".repeat(40),
  waeosgreen:"gamma-test-"+ "c".repeat(40)
};
const auth=(id="waeosgreen",token=clients[id])=>({
  "x-waeweb-client":id,authorization:"Bearer "+token
});
const fakeSearch=async (query,type)=>({
  query,type,results:[{title:"Resultado",url:"https://example.org",snippet:"Fuente comprobable",source:"Test",date:null}],
  sources:["Test"],failedSources:[],fetchedAt:"2026-09-22T00:00:00.000Z",
  brief:null
});
async function serverFor(service=handleConnect) {
  const server=http.createServer((req,res)=>{
    Promise.resolve(service(req,res,{searchProvider:fakeSearch,reader:async url=>({
      url,title:"Public page",text:"Test article",fetchedAt:"2026-09-22T00:00:00Z",fingerprint:"a".repeat(64)
    })})).catch(()=>{if(!res.headersSent)res.writeHead(500);res.end();});
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  return {server,url:"http://127.0.0.1:"+server.address().port};
}
const post=(url,path,data,headers={})=>fetch(url+path,{
  method:"POST",headers:{"content-type":"application/json",...headers},body:JSON.stringify(data)
});
test("Connect is off by default, distinct credentials for three named systems",()=>{
  assert.equal(connectConfig({}),null);
  assert.equal(connectConfig({WAE_CONNECT_ENABLED:"true",WAE_CONNECT_CLIENTS_JSON:'{"unknown":"'+ "x".repeat(40)+'"}'}),null);
  const cfg=connectConfig({NODE_ENV:"test",WAE_CONNECT_ENABLED:"true",WAE_CONNECT_CLIENTS_JSON:JSON.stringify(clients)});
  assert.equal(cfg.size,3);
  assert.equal(authorizeConnect(auth(),cfg),"waeosgreen");
  assert.equal(authorizeConnect(auth("inteligenciauniversal"),cfg),"inteligenciauniversal");
  assert.equal(authorizeConnect(auth("universal-core-vt3h"),cfg),"universal-core-vt3h");
  assert.equal(authorizeConnect(auth("waeosgreen","x".repeat(40)),cfg),null);
  assert.equal(authorizeConnect(auth("bad"),cfg),null);
  assert.equal(connectConfig({WAE_CONNECT_ENABLED:"true",WAE_CONNECT_CLIENTS_JSON:JSON.stringify({
    inteligenciauniversal:"same-key-"+ "a".repeat(40),waeosgreen:"same-key-"+ "a".repeat(40)
  })}),null);
});
test("Connect inputs reject unbounded or malformed fields",()=>{
  assert.throws(()=>connectRequest({query:"x"}),/invalid_query/);
  assert.throws(()=>connectRequest({query:"a".repeat(181)}),/invalid_query/);
  assert.throws(()=>connectRequest({query:"two",type:"sql"}),/invalid_type/);
  assert.throws(()=>connectRequest({query:"two",fresh:"true"}),/invalid_fresh/);
  assert.throws(()=>connectRequest({url:"file:///etc/passwd"},"retrieve"),/invalid_url/);
  assert.deepEqual(connectRequest({query:"investigación",fresh:true}),{
    query:"investigación",type:"all",fresh:true
  });
});
test("HTTP Connect JSON, SSE, reader and credential denial",async()=>{
  const old={WAE_CONNECT_ENABLED:process.env.WAE_CONNECT_ENABLED,
    WAE_CONNECT_CLIENTS_JSON:process.env.WAE_CONNECT_CLIENTS_JSON,
    WAE_CONNECT_READER_ENABLED:process.env.WAE_CONNECT_READER_ENABLED,
    NODE_ENV:process.env.NODE_ENV};
  process.env.NODE_ENV="test";
  process.env.WAE_CONNECT_ENABLED="true";
  process.env.WAE_CONNECT_CLIENTS_JSON=JSON.stringify(clients);
  const {server,url}=await serverFor();
  try{
    let r=await fetch(url+"/api/connect/v1/status",{headers:auth()});
    assert.equal(r.status,200);
    const status=await r.json();
    assert.equal(status.contract,CONNECT_VERSION);
    assert.equal(status.browserEngine,"not_remote_chromium");
    assert.equal(status.capabilities.retrieve,false);
    r=await post(url,"/api/connect/v1/search",{query:"clima",fresh:true},auth());
    assert.equal(r.status,200);
    assert.equal(r.headers.get("cache-control"),"no-store");
    const result=await r.json();
    assert.equal(result.results[0].source,"Test");
    assert.equal(result.freshness,"bypass_waeweb_cache");
    r=await post(url,"/api/connect/v1/stream",{query:"ejemplo"},auth("inteligenciauniversal"));
    assert.equal(r.status,200);
    assert.match(r.headers.get("content-type"),/text\/event-stream/);
    const stream=await r.text();
    assert.match(stream,/event: ready/);
    assert.match(stream,/event: results/);
    assert.match(stream,/event: done/);
    r=await post(url,"/api/connect/v1/retrieve",{url:"https://example.org"},auth());
    assert.equal(r.status,503);
    process.env.WAE_CONNECT_READER_ENABLED="true";
    r=await post(url,"/api/connect/v1/retrieve",{url:"https://example.org"},auth());
    assert.equal(r.status,200);
    assert.equal((await r.json()).page.title,"Public page");
    r=await post(url,"/api/connect/v1/search",{query:"hello"},auth("waeosgreen","n".repeat(45)));
    assert.equal(r.status,401);
    r=await post(url,"/api/connect/v1/search",{query:"hello"}, {...auth(),origin:"https://evil.test"});
    assert.equal(r.status,403);
    r=await post(url,"/api/connect/v1/search",{query:"x"},auth());
    assert.equal(r.status,400);
    r=await post(url,"/api/connect/v1/search",{query:"x".repeat(3000)},auth());
    assert.equal(r.status,413);
    r=await fetch(url+"/api/connect/v1/search",{headers:auth()});
    assert.equal(r.status,405);
  }finally{
    await new Promise(resolve=>server.close(resolve));
    for(const [key,val] of Object.entries(old)) {
      if(val===undefined)delete process.env[key];else process.env[key]=val;
    }
  }
});
test("Connect is correctly mounted in WAEWEB Node routing, not a public search route",async()=>{
  const {server,url}=await serverFor((req,res)=>handler(req,res));
  try {
    const r=await fetch(url+"/api/connect/v1/status");
    assert.equal(r.status,503);
    const h=await fetch(url+"/api/health");
    assert.equal(h.status,200);
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test("production, Render and Vercel Connect require verified shared admission rather than per-process rate counters",()=>{
  const base={
    WAE_CONNECT_ENABLED:"true",
    WAE_CONNECT_CLIENTS_JSON:JSON.stringify(clients)
  };
  for(const prod of [{NODE_ENV:"production"},{VERCEL:"1"},{RENDER:"true"},{RENDER_SERVICE_ID:"srv-test"}]){
    assert.equal(connectAdmissionReady({...base,...prod}),false);
    assert.equal(connectConfig({...base,...prod}),null);
  }
  assert.equal(connectAdmissionReady(base),false);
  assert.equal(connectAdmissionReady({...base,NODE_ENV:"test"}),true);
  assert.equal(connectAdmissionReady({...base,NODE_ENV:"development"}),true);
  assert.equal(connectAdmissionReady({...base,WAE_CONNECT_ADMISSION_MODE:"unknown"}),false);
  assert.equal(connectAdmissionReady({...base,WAE_CONNECT_ADMISSION_MODE:"postgres"}),false);
  assert.equal(connectAdmissionConfig({...base,WAE_CONNECT_ADMISSION_MODE:"postgres"}),null);
});

test("Connect distinguishes verified zero hits, partial outages and no available providers",()=>{
  const params={type:"all",fresh:true};
  const empty=safeResults({query:"evidencia",results:[],sources:["Wikipedia"],
    failedSources:[],fetchedAt:"2026-09-22T09:00:00.000Z"},params);
  assert.equal(empty.ok,true);
  assert.equal(empty.status,"complete");
  assert.equal(empty.results.length,0);
  const partial=safeResults({query:"evidencia",results:[{
    title:"Registro",url:"https://example.org/registro",source:"Wikipedia",snippet:"Referencia"
  }],sources:["Wikipedia","Google no configurado"],failedSources:["Crossref"],
    fetchedAt:"2026-09-22T09:00:00.000Z"},params);
  assert.equal(partial.ok,true);
  assert.equal(partial.status,"partial");
  assert.deepEqual(partial.failedSources,["Crossref"]);
  assert.equal(partial.results.length,1);
  const unavailable=safeResults({query:"evidencia",results:[],
    sources:["Google no configurado"],failedSources:["Wikipedia"]},params);
  assert.equal(unavailable.ok,false);
  assert.equal(unavailable.error,"no_sources_available");
  assert.equal(unavailable.status,"unavailable");
  assert.equal(safeResults(null,params).error,"invalid_search_response");
  assert.equal(safeResults({error:"consulta no válida"},params).error,"search_rejected");
});

test("Connect bounds hostile source metadata and refuses bad URLs",()=>{
  const result=safeResults({query:"prueba",sources:["Fuente"],failedSources:[],
    results:[{title:"Válido",url:"https://example.org/fuente",
      snippet:"z".repeat(10000),source:"S".repeat(1000),
      image:"javascript:alert(1)"},
      {title:"Inseguro",url:"javascript:alert(1)",source:"Fuente"}]
  },{type:"all",fresh:false});
  assert.equal(result.ok,true);
  assert.equal(result.results.length,1);
  assert.ok(result.results[0].snippet.length<=1100);
  assert.ok(result.results[0].source.length<=120);
  assert.equal(result.results[0].image,null);
});
