import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {rustPackageIntentTerms,normalizeRustCrate,rustPublicCrates,CRATES_SOURCE}
  from "../server/rust-package-discovery.mjs";
import {parseQuery} from "../server/intelligence.mjs";
import {search,quickOpenWeb} from "../server/search.mjs";
import {handler} from "../server/index.mjs";

const json=data=>new Response(JSON.stringify(data),{status:200,
  headers:{"content-type":"application/json"}});
const crates=json({crates:[
  {name:"serde",id:"serde",max_version:"1.0.0",
    description:"Serialization / deserialization",downloads:300},
  {name:"serde_json",id:"serde_json",max_version:"1.0.1",
    description:"JSON support for Serde",downloads:100},
  {name:"bad",id:"other",description:"Wrong identity"},
  {name:"../impostor",id:"../impostor",description:"Traversal"},
  {name:"fake.io/secret",description:"Untrusted URL"},
  {name:"",description:"Missing package name"}],
  meta:{total:3}});
const empty=json({hits:[],items:[],documents:[],
  query:{search:[]},search:[]});
async function fixture(run){
  const original=globalThis.fetch,seen=[];
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const old=keys.map(k=>process.env[k]);
  keys.forEach(k=>delete process.env[k]);
  globalThis.fetch=async(input,...options)=>{
    const u=new URL(input);
    if(u.hostname==="127.0.0.1")return original(input,...options);
    seen.push(u);
    if(u.hostname==="crates.io")return crates.clone();
    if(["api.github.com","hn.algolia.com","api.stackexchange.com",
      "developer.mozilla.org","es.wikipedia.org","www.wikidata.org"]
      .includes(u.hostname))return empty.clone();
    return new Response("unavailable",{status:503});
  };
  try{await run(seen);}
  finally{
    globalThis.fetch=original;
    keys.forEach((k,i)=>old[i]===undefined
      ?delete process.env[k]:process.env[k]=old[i]);
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
test("Rust registry search is explicit and term-bearing, not generic navigation",()=>{
  for(const [q,terms]of [
    ["paquetes Rust serde","serde"],
    ["crates serde","serde"],
    ["crates.io serde","serde"],
    ["bibliotecas de Rust para JSON","JSON"],
    ["Rust packages webassembly","webassembly"]])
    assert.equal(rustPackageIntentTerms(q),terms,q);
  for(const q of ["Rust","cargo","Rust tutorial","paquetes Rust",
    "crates","GitHub","paquetes npm React","paquetes Python serde",
    "paquetes Rust en GitHub"])
    assert.equal(rustPackageIntentTerms(q),null,q);
});
test("package links are canonical crates.io pages derived from strict names",()=>{
  const result=normalizeRustCrate({id:"serde_json",name:"serde_json",
    description:"<script>ignored</script> Fast JSON",
    max_version:"1.0.0",downloads:23});
  assert.equal(result.url,"https://crates.io/crates/serde_json");
  assert.equal(result.source,CRATES_SOURCE);
  assert.equal(result.indexedScope,"package_registry_metadata_only");
  assert.match(result.snippet,/Versión publicada: 1.0.0/);
  assert.match(result.snippet,/Descargas registradas: 23/);
  assert.doesNotMatch(result.snippet,/<script>/);
  for(const name of ["../foo","foo/bar","foo?x=1","foo#fragment",
    "","foo space","https://impostor.test","foo.bar"])
    assert.equal(normalizeRustCrate({name}),null,name);
  assert.equal(normalizeRustCrate({id:"other",name:"serde"}),null);
});
test("quick search returns real crate links and bounded provenance",async()=>fixture(
  async calls=>serve(async base=>{
    const res=await fetch(base+"/api/search?quick=1&type=all&q="+
      encodeURIComponent("paquetes Rust serde"));
    const data=await res.json();
    assert.equal(res.status,200);
    assert.equal(res.headers.get("x-waeweb-api"),"1");
    assert.equal(data.scope,"public_rust_package_links");
    assert.equal(data.completeSearch,false);
    assert.deepEqual(data.generalIndexes,[]);
    assert.ok(data.retrievedSources.includes(CRATES_SOURCE));
    assert.equal(data.results.length,2);
    assert.ok(data.results.every(row=>row.source===CRATES_SOURCE));
    assert.ok(data.results.every(row=>row.url.startsWith(
      "https://crates.io/crates/")));
    assert.ok(!JSON.stringify(data.results).includes("impostor"));
    const api=calls.filter(u=>u.hostname==="crates.io");
    assert.equal(api.length,1);
    assert.equal(api[0].pathname,"/api/v1/crates");
    assert.equal(api[0].searchParams.get("q"),"serde");
    assert.equal(api[0].searchParams.get("per_page"),"10");
  })
));
test("quick and full search share in-flight crate request without a general-index claim",
  async()=>fixture(async calls=>{
    const [preview,full]=await Promise.all([
      quickOpenWeb("paquetes Rust serde"),
      search("paquetes Rust serde","all",{fresh:true})
    ]);
    const url="https://crates.io/crates/serde";
    assert.ok(preview.results.some(x=>x.url===url));
    assert.ok(full.results.some(x=>x.url===url));
    assert.equal(calls.filter(u=>u.hostname==="crates.io").length,1);
    assert.ok(full.searchCoverage.specialistSources.includes(CRATES_SOURCE));
    assert.equal(full.searchCoverage.entireWebIndexed,false);
    assert.deepEqual(full.searchCoverage.generalIndexes,[]);
  }));
test("source:crates selects only registry records for general package terms",
  async()=>fixture(async calls=>{
    assert.equal(parseQuery("serde source:crates").source,"crates");
    const full=await search("serde source:crates","all",{fresh:true});
    assert.equal(full.results.length,2);
    assert.ok(full.results.every(x=>x.source===CRATES_SOURCE));
    assert.equal(calls.filter(u=>u.hostname==="crates.io").length,1);
  }));
test("site:crate registry and pagination cannot silently expand source scope",
  async()=>fixture(async calls=>{
    const hit=await search("paquetes Rust serde site:crates.io","all",{fresh:true});
    assert.ok(hit.results.some(x=>x.url==="https://crates.io/crates/serde"));
    const count=calls.filter(u=>u.hostname==="crates.io").length;
    const off=await search("paquetes Rust serde","all",{page:2,fresh:true});
    assert.ok(off.results.every(x=>x.source!==CRATES_SOURCE));
    assert.equal(calls.filter(u=>u.hostname==="crates.io").length,count);
  }));
test("advanced filters, ordinary Rust questions, and bare brand skip quick API",
  async()=>fixture(async calls=>{
    for(const q of ["paquetes Rust serde site:crates.io",
      "paquetes Rust serde source:crates",'"paquetes Rust serde"',
      "paquetes Rust serde -secret",
      "paquetes Rust serde after:2026"]){
      const fast=await quickOpenWeb(q);
      assert.equal(fast.sourceStatus,"not_applicable",q);
      assert.deepEqual(fast.results,[],q);
    }
    await quickOpenWeb("Rust tutorial");
    await quickOpenWeb("crates.io");
    assert.equal(calls.filter(u=>u.hostname==="crates.io").length,0);
  }));
test("UI retains integrated cards and concurrency guards for crates.io",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/public_rust_package_links/);
  assert.match(app,/"crates.io · paquetes Rust"/);
  assert.match(app,/\].includes\(item.source\)/);
  assert.match(app,/fullSearchFinished\|\|signal\.aborted\|\|sequence!==state\.sequence/);
});
