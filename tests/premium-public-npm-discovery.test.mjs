import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {npmPackageIntentTerms,normalizeNpmPackage}
  from "../server/package-discovery.mjs";
import {quickOpenWeb,search} from "../server/search.mjs";
import {handler} from "../server/index.mjs";

const response=data=>new Response(JSON.stringify(data),{status:200,
  headers:{"content-type":"application/json"}});
const npmResponse=response({objects:[
  {package:{name:"react",description:"A JavaScript library",
    version:"19.1.0",links:{npm:"https://www.npmjs.com/package/react"}}},
  {package:{name:"@example/design-kit",description:"UI components",
    version:"1.0.0",links:{npm:"https://www.npmjs.com/package/@example/design-kit"}}},
  {package:{name:"trojan",description:"Fake domain",
    links:{npm:"https://www.npmjs.com.evil.example/package/trojan"}}},
  {package:{name:"other",links:{npm:"https://www.npmjs.com/package/react"}}},
  {package:{name:"private",links:{npm:"http://www.npmjs.com/package/private"}}}
]});
const empty=response({hits:[],query:{search:[]},search:[],items:[],documents:[]});
async function fixture(run){
  const original=globalThis.fetch,seen=[];
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const env=keys.map(key=>process.env[key]);
  keys.forEach(key=>delete process.env[key]);
  globalThis.fetch=async(input,...options)=>{
    const url=new URL(input);
    if(url.hostname==="127.0.0.1")return original(input,...options);
    seen.push(url);
    if(url.hostname==="registry.npmjs.org")return npmResponse.clone();
    if(["hn.algolia.com","api.stackexchange.com","developer.mozilla.org",
      "es.wikipedia.org","www.wikidata.org","api.github.com"].includes(url.hostname))
      return empty.clone();
    return new Response("unavailable",{status:503});
  };
  try{await run(seen);}
  finally{
    globalThis.fetch=original;
    keys.forEach((key,i)=>env[i]===undefined
      ?delete process.env[key]:process.env[key]=env[i]);
  }
}
async function serve(run){
  const server=http.createServer(handler);
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    await run("http://127.0.0.1:"+server.address().port);
  }finally{if(server.listening)
    await new Promise(resolve=>server.close(resolve));}
}
test("npm discovery requires explicit package and npm intent",()=>{
  for(const [q,terms] of [
    ["paquetes npm React","React"],
    ["librerías npm para PDF","PDF"],
    ["npm packages Docker","Docker"],
    ["bibliotecas de npm con TypeScript","TypeScript"]
  ])assert.equal(npmPackageIntentTerms(q),terms,q);
  for(const q of ["npm","GitHub","npm install","React tutorial",
    "paquetes React","npm packages","mercado libre México",
    "noticias npm","paquetes npm site:npmjs.com"])
    if(q.includes("site:"))assert.ok(npmPackageIntentTerms(q));
    else assert.equal(npmPackageIntentTerms(q),null,q);
});
test("registry metadata validates npm host and exact package path",()=>{
  const valid=normalizeNpmPackage({package:{name:"@example/design-kit",
    description:"<em>UI</em> kit",version:"1.0.0",
    links:{npm:"https://www.npmjs.com/package/@example/design-kit"}}});
  assert.equal(valid.url,"https://www.npmjs.com/package/@example/design-kit");
  assert.equal(valid.indexedScope,"package_registry_metadata_only");
  for(const url of ["https://www.npmjs.com.evil.example/package/react",
    "https://www.npmjs.com/package/other","http://www.npmjs.com/package/react",
    "https://www.npmjs.com/package/react?token=secret",
    "https://www.npmjs.com/package/react%2Fmore"])
    assert.equal(normalizeNpmPackage({package:{name:"react",links:{npm:url}}}),null,url);
});
test("quick search publishes real npm package pages, not impostors",async()=>fixture(async seen=>{
  await serve(async base=>{
    const res=await fetch(base+"/api/search?quick=1&type=all&q="+
      encodeURIComponent("paquetes npm React"));
    const data=await res.json();
    assert.equal(res.status,200);
    assert.equal(data.completeSearch,false);
    assert.deepEqual(data.generalIndexes,[]);
    const packages=data.results.filter(x=>x.source==="npm · paquetes publicados");
    assert.equal(packages.length,2);
    assert.equal(packages[0].indexedScope,"package_registry_metadata_only");
    assert.ok(packages.some(p=>p.url==="https://www.npmjs.com/package/react"));
    assert.ok(!JSON.stringify(data.results).includes("evil.example"));
  });
  assert.equal(seen.filter(url=>url.hostname==="registry.npmjs.org").length,1);
}));
test("full and early discovery share one pending npm request",async()=>fixture(async seen=>{
  const [early,full]=await Promise.all([
    quickOpenWeb("paquetes npm React"),
    search("paquetes npm React","all",{fresh:true})
  ]);
  assert.ok(early.results.some(x=>x.url==="https://www.npmjs.com/package/react"));
  assert.ok(full.results.some(x=>x.url==="https://www.npmjs.com/package/react"));
  assert.equal(seen.filter(u=>u.hostname==="registry.npmjs.org").length,1);
  assert.ok(full.searchCoverage.specialistSources.includes("npm · paquetes publicados"));
  assert.equal(full.searchCoverage.entireWebIndexed,false);
}));
test("no npm provisional results for advanced filters or ordinary search",async()=>fixture(async seen=>{
  for(const q of ["paquetes npm React site:example.org",
    "paquetes npm React source:github",'"paquetes npm React"',
    "paquetes npm React -react","paquetes npm React after:2026"]){
    const result=await quickOpenWeb(q);
    assert.equal(result.sourceStatus,"not_applicable",q);
    assert.deepEqual(result.results,[],q);
  }
  await quickOpenWeb("Mercado Libre México");
  assert.equal(seen.filter(u=>u.hostname==="registry.npmjs.org").length,0);
}));
test("UI displays package pages in native preliminary web results",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/"npm · paquetes publicados"\].includes\(item.source\)/);
});
