// Real-code contract test for two independent GitHub repositories.
// Runs only in the dedicated CI workflow, with the PUBLIC Universal Core
// feature branch checked out at __universal_contract. Never contacts Render,
// Vercel, private repos, or any real search provider.
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {handleConnect} from "../server/connect.mjs";

const enabled=process.env.WAE_CROSS_REPO_INTEGRATION==="true";
const clients={
  inteligenciauniversal:"ci-universal-"+"A".repeat(40),
  "universal-core-vt3h":"ci-vt3h-"+"B".repeat(40),
  waeosgreen:"ci-green-"+"C".repeat(40)
};
const testPayload=async(query,type)=>{
  if(query==="proveedor apagado")return {
    query,type,results:[],sources:["Google no configurado"],
    failedSources:["Wikipedia"]
  };
  if(query==="resultado parcial")return {
    query,type,
    results:[{title:"Fuente existente",url:"https://example.org/partial",
      snippet:"Evidencia conservada",source:"Wikipedia"}],
    sources:["Wikipedia","Google no configurado"],failedSources:["Crossref"],
    fetchedAt:"2026-09-22T00:00:00.000Z"
  };
  if(query==="sin coincidencias")return {query,type,
    results:[],sources:["Wikipedia"],failedSources:[],
    fetchedAt:"2026-09-22T00:00:00.000Z"};
  return {
    query,type,
    results:[{title:"Evidence in source",url:"https://example.org/statement",
      snippet:"Cited public source",source:"Cross-repo fixture",date:null}],
    sources:["Cross-repo fixture"],failedSources:[],
    fetchedAt:"2026-09-22T00:00:00.000Z"
  };
};
test("Universal Core client interoperates with ACTUAL WAEWEB Connect handler (no deployments)",{
  skip:!enabled
},async()=>{
  const original={};
  for(const name of ["NODE_ENV","WAE_CONNECT_ENABLED","WAE_CONNECT_CLIENTS_JSON",
    "WAE_CONNECT_ADMISSION_MODE"]){
    original[name]=process.env[name];
  }
  Object.assign(process.env,{
    NODE_ENV:"test",WAE_CONNECT_ENABLED:"true",
    WAE_CONNECT_ADMISSION_MODE:"local",
    WAE_CONNECT_CLIENTS_JSON:JSON.stringify(clients)
  });
  const {requestWaeweb}=await import("../__universal_contract/lib/waeweb-connect.js");
  const server=http.createServer((req,res)=>{
    handleConnect(req,res,{searchProvider:testPayload}).catch(()=>{
      if(!res.headersSent)res.writeHead(500);
      res.end();
    });
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base="http://127.0.0.1:"+server.address().port;
  // Replace ONLY the network transport. URL validation, machine credentials,
  // real HTTP framing, WAEWEB auth, parsing and SSE remain production code.
  const transport=(url,options)=>fetch(base+new URL(url).pathname,options);
  try {
    for(const [id,token] of Object.entries(clients)){
      const cfg={WAEWEB_CONNECT_ENABLED:"true",
        WAEWEB_CONNECT_CLIENT_ID:id,
        WAEWEB_CONNECT_BASE_URL:"https://waeweb.example.org/",
        WAEWEB_CONNECT_TOKEN:token};
      const direct=await fetch(base+"/api/connect/v1/status",{
        headers:{"x-waeweb-client":id,authorization:"Bearer "+token}
      });
      assert.equal(direct.status,200);
      assert.equal((await direct.json()).client,id);
      if(id==="waeosgreen")continue; // Green's private code tested separately.
      const status=await requestWaeweb("status",null,{env:cfg,transport});
      assert.equal(status.client,id);
      const search=await requestWaeweb("search",{
        query:"evidencia verificable",fresh:true
      },{env:cfg,transport});
      assert.equal(search.contract,"waeweb-connect/v1");
      assert.equal(search.results[0].url,"https://example.org/statement");
      assert.deepEqual(search.sources,["Cross-repo fixture"]);
      const sse=await requestWaeweb("stream",{
        query:"evidencia verificable"
      },{env:cfg,transport});
      const frames=await sse.text();
      assert.match(frames,/event: ready/);
      assert.match(frames,/event: results/);
      assert.match(frames,/event: done/);
      assert.match(frames,/Cross-repo fixture/);
      assert.doesNotMatch(frames,new RegExp(token));
      const partial=await requestWaeweb("search",{query:"resultado parcial"},
        {env:cfg,transport});
      assert.equal(partial.status,"partial");
      assert.deepEqual(partial.failedSources,["Crossref"]);
      assert.equal(partial.results[0].url,"https://example.org/partial");
      const noHits=await requestWaeweb("search",{query:"sin coincidencias"},
        {env:cfg,transport});
      assert.equal(noHits.ok,true);
      assert.equal(noHits.status,"complete");
      assert.deepEqual(noHits.results,[]);
      await assert.rejects(()=>requestWaeweb("search",{query:"proveedor apagado"},
        {env:cfg,transport}),{code:"waeweb_upstream_503"});
      const interrupted=await requestWaeweb("stream",{query:"proveedor apagado"},
        {env:cfg,transport});
      const failedFrames=await interrupted.text();
      assert.match(failedFrames,/event: error/);
      assert.match(failedFrames,/"error":"no_sources_available"/);
      assert.match(failedFrames,/"ok":false/);
      const swapped=await fetch(base+"/api/connect/v1/status",{
        headers:{"x-waeweb-client":id,
          authorization:"Bearer "+clients.waeosgreen}
      });
      assert.equal(swapped.status,401,"cross-system token confusion rejected");
    }
  }finally{
    await new Promise(resolve=>server.close(resolve));
    for(const [name,value] of Object.entries(original)){
      if(value===undefined)delete process.env[name];
      else process.env[name]=value;
    }
  }
});
