import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseQuery} from "../server/intelligence.mjs";
import {generalWebIndexAllowed} from "../server/web-source-planner.mjs";
import {search} from "../server/search.mjs";

const json=data=>new Response(JSON.stringify(data),{
  status:200,headers:{"content-type":"application/json"}});
const fixtures={
  "api.search.brave.com":{web:{results:[{
    title:"React web guide · Brave",
    url:"https://brave.example.org/react-guide",description:"Authentic page"}]}},
  "www.googleapis.com":{items:[{
    title:"React web guide · Google",
    link:"https://google.example.org/react-guide",snippet:"Public page"}]},
  "search.example.org":{results:[{
    title:"React web guide · SearXNG",
    url:"https://searx.example.org/react-guide",
    content:"Independent organic link",engine:"test-index"}]},
  "api.github.com":{items:[{
    id:63,full_name:"example/react-guide",private:false,
    html_url:"https://github.com/example/react-guide",
    language:"JavaScript",stargazers_count:5,description:"Web guide"}]}
};
async function fixture(run){
  const previous=globalThis.fetch;
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const before=keys.map(key=>process.env[key]),calls=[];
  process.env.BRAVE_SEARCH_API_KEY="mock-brave-key";
  process.env.GOOGLE_SEARCH_API_KEY="mock-google-key";
  process.env.GOOGLE_SEARCH_ENGINE_ID="mock-search-id";
  process.env.WAE_SEARXNG_URL="https://search.example.org";
  globalThis.fetch=async(input)=>{
    const u=new URL(input);
    calls.push(u);
    return fixtures[u.hostname]?json(fixtures[u.hostname]):
      new Response("not needed",{status:503});
  };
  try{await run(calls);}
  finally{
    globalThis.fetch=previous;
    keys.forEach((k,i)=>before[i]===undefined
      ?delete process.env[k]:process.env[k]=before[i]);
  }
}
test("general-index planner respects requested source, never aliases specialists",()=>{
  for(const engine of ["Brave","Google","SearXNG"]){
    assert.equal(generalWebIndexAllowed(null,engine),true);
    for(const source of ["brave","google","searxng"])
      assert.equal(generalWebIndexAllowed(source,engine),
        source===engine.toLowerCase(),source+":"+engine);
    for(const source of ["github","gitlab","crates","wikipedia","mdn"])
      assert.equal(generalWebIndexAllowed(source,engine),false);
  }
  assert.equal(generalWebIndexAllowed(null,"untrusted engine"),false);
});
test("source:brave is parsed and isolated to the actual Brave results",async()=>fixture(
  async calls=>{
    assert.equal(parseQuery("React source:brave").source,"brave");
    assert.equal(parseQuery("React source:brave").query,"React");
    const page=await search("React source:brave","all",{fresh:true});
    assert.deepEqual(page.results.map(row=>row.url),
      ["https://brave.example.org/react-guide"]);
    assert.deepEqual(page.searchCoverage.generalIndexes,["Brave"]);
    assert.deepEqual(page.searchCoverage.respondingGeneralIndexes,["Brave"]);
    assert.deepEqual(page.searchCoverage.generalIndexDiagnosis.providers.map(p=>p.state),
      ["results","not_queried","not_queried"]);
    assert.deepEqual(calls.map(u=>u.hostname),["api.search.brave.com"]);
    assert.doesNotMatch(JSON.stringify(page),/mock-brave-key/);
  }));
test("source:google uses Google alone and does not touch Brave",async()=>fixture(
  async calls=>{
    const page=await search("React source:google","all",{fresh:true});
    assert.deepEqual(page.results.map(row=>row.url),
      ["https://google.example.org/react-guide"]);
    assert.deepEqual(page.searchCoverage.generalIndexes,["Google"]);
    assert.deepEqual(page.searchCoverage.generalIndexDiagnosis.providers.map(p=>p.state),
      ["not_queried","results","not_queried"]);
    assert.deepEqual(calls.map(u=>u.hostname),["www.googleapis.com"]);
  }));
test("source:searxng queries only operator-configured SearXNG",async()=>fixture(
  async calls=>{
    const page=await search("React source:searxng","all",{fresh:true});
    assert.deepEqual(page.results.map(row=>row.url),
      ["https://searx.example.org/react-guide"]);
    assert.deepEqual(page.searchCoverage.generalIndexes,["SearXNG"]);
    assert.deepEqual(page.searchCoverage.generalIndexDiagnosis.providers.map(p=>p.state),
      ["not_queried","not_queried","results"]);
    assert.deepEqual(calls.map(u=>u.hostname),["search.example.org"]);
  }));
test("specialist source:github never contacts unrelated general indexes",async()=>fixture(
  async calls=>{
    const page=await search("React source:github","all",{fresh:true});
    assert.ok(page.results.some(row=>row.url==="https://github.com/example/react-guide"));
    assert.deepEqual(page.searchCoverage.generalIndexes,[]);
    assert.equal(page.searchCoverage.generalIndexDiagnosis.state,"not_queried");
    assert.deepEqual(calls.map(u=>u.hostname),["api.github.com"]);
  }));
test("default query preserves all general-index providers, with real provenance",async()=>fixture(
  async calls=>{
    const page=await search("React","all",{fresh:true});
    const indexes=page.searchCoverage.generalIndexes;
    assert.deepEqual(indexes,["Brave","Google","SearXNG"]);
    for(const host of ["api.search.brave.com","www.googleapis.com",
      "search.example.org"])assert.ok(calls.some(u=>u.hostname===host),host);
    assert.ok(page.results.some(x=>x.url==="https://brave.example.org/react-guide"));
    assert.ok(page.results.some(x=>x.url==="https://google.example.org/react-guide"));
    assert.ok(page.results.some(x=>x.url==="https://searx.example.org/react-guide"));
  }));
test("compact web header keeps detailed source diagnostics in collapsed disclosure",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const start=app.indexOf('const metrics=element("p","web-search-metrics"');
  const end=app.indexOf("const commands=",start);
  assert.ok(start>0&&end>start);
  const metrics=app.slice(start,end);
  assert.doesNotMatch(metrics,/índices generales con resultados/);
  assert.match(metrics,/fichas de conocimiento/);
  assert.match(app,/const details=element\("details","web-search-sources"\)/);
  assert.match(app,/generalIndexDiagnosis/);
});
