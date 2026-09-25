import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {diagnoseWebIndexes} from "../server/web-index-diagnostics.mjs";
import {search} from "../server/search.mjs";

const sourceNames=["Brave","Google","SearXNG"];
const sources=sourceNames.map(name=>[name,()=>{}]);
const good=items=>({status:"fulfilled",value:{items}});
const noConfig=()=>good(null);
const down=()=>({status:"rejected",reason:Error("sensitive provider details must not escape")});
test("distinguishes returned pages from successful empty results",()=>{
  const hits=diagnoseWebIndexes(sources,[good([{url:"https://example.org/"}]),good([]),noConfig()]);
  assert.equal(hits.state,"results");
  assert.equal(hits.totalHits,1);
  assert.deepEqual(hits.providers.map(x=>x.state),["results","empty","unconfigured"]);
  const empty=diagnoseWebIndexes(sources,[good([]),noConfig(),noConfig()]);
  assert.equal(empty.state,"empty");
  assert.equal(empty.totalHits,0);
});
test("distinguishes outage, missing configuration and intentionally unqueried providers",()=>{
  const unavailable=diagnoseWebIndexes(sources,[down(),noConfig(),down()]);
  assert.equal(unavailable.state,"unavailable");
  assert.equal(unavailable.totalHits,0);
  assert.doesNotMatch(JSON.stringify(unavailable),/sensitive provider details/);
  assert.equal(diagnoseWebIndexes(sources,[noConfig(),noConfig(),noConfig()]).state,
    "unconfigured");
  assert.equal(diagnoseWebIndexes([],[]).state,"not_queried");
  assert.deepEqual(diagnoseWebIndexes([],[]).providers.map(x=>x.state),
    ["not_queried","not_queried","not_queried"]);
});
test("search API does not mistake a curated website for web-index availability",async()=>{
  const prior=globalThis.fetch;
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const saved=keys.map(key=>process.env[key]);
  for(const key of keys)delete process.env[key];
  globalThis.fetch=async()=>new Response("unavailable",{status:503});
  try{
    const page=await search("GitHub","all",{fresh:true});
    assert.equal(page.results[0].url,"https://github.com/");
    assert.equal(page.searchCoverage.generalIndexDiagnosis.state,"unconfigured");
    assert.equal(page.searchCoverage.generalIndexDiagnosis.totalHits,0);
    assert.ok(page.searchCoverage.navigationalSites>=1);
    assert.deepEqual(page.searchCoverage.generalIndexes,[]);
  }finally{
    globalThis.fetch=prior;
    keys.forEach((key,index)=>saved[index]===undefined
      ?delete process.env[key]:process.env[key]=saved[index]);
  }
});
test("configured Brave returns either zero-hit or outage, never an invented index result",async()=>{
  const prior=globalThis.fetch;
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const saved=keys.map(key=>process.env[key]);
  for(const key of keys)delete process.env[key];
  process.env.BRAVE_SEARCH_API_KEY="testing-only";
  try{
    globalThis.fetch=async input=>String(input).includes("api.search.brave.com")
      ?new Response(JSON.stringify({web:{results:[]}}),{status:200})
      :new Response("unavailable",{status:503});
    const zero=await search("GitHub","all",{fresh:true});
    assert.equal(zero.searchCoverage.generalIndexDiagnosis.state,"empty");
    assert.equal(zero.searchCoverage.generalIndexDiagnosis.providers[0].state,"empty");
    assert.equal(zero.searchCoverage.generalIndexDiagnosis.totalHits,0);
    globalThis.fetch=async()=>new Response("unavailable",{status:503});
    const failed=await search("GitHub","all",{fresh:true});
    assert.equal(failed.searchCoverage.generalIndexDiagnosis.state,"unavailable");
    assert.equal(failed.searchCoverage.generalIndexDiagnosis.providers[0].state,"unavailable");
  }finally{
    globalThis.fetch=prior;
    keys.forEach((key,index)=>saved[index]===undefined
      ?delete process.env[key]:process.env[key]=saved[index]);
  }
});
test("UI diagnosis stays inside existing collapsed coverage details",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/const details=element\("details","web-search-sources"\)/);
  assert.match(app,/const diagnosis=coverage\?\.generalIndexDiagnosis/);
  assert.match(app,/const publicProviders=\(diagnosis\?\.providers\|\|\[\]\)\.filter/);
  assert.match(app,/publicProviders\.map\(provider=>provider\.name/);
  assert.doesNotMatch(app,/unconfigured:"no configurado"/);
  assert.match(app,/empty:"respondió sin coincidencias"/);
  assert.match(app,/Los errores técnicos se conservan en la telemetría del servidor/);
});
