import test from "node:test";
import assert from "node:assert/strict";
import {technicalWebQuery} from "../server/web-providers.mjs";
import {search} from "../server/search.mjs";

const json=value=>new Response(JSON.stringify(value),{status:200,
  headers:{"content-type":"application/json"}});
const github=json({items:[
  {id:10,full_name:"example/artisan-tools",private:false,
    html_url:"https://github.com/example/artisan-tools",
    description:"Public artisan tools",stargazers_count:12},
  {id:11,full_name:"example/private-artisan",private:true,
    html_url:"https://github.com/example/private-artisan"},
  {id:12,full_name:"example/impostor",private:false,
    html_url:"https://github.com.evil.example/example/impostor"}
]});
const gitlab=json([
  {id:22,path_with_namespace:"example/artisan-tools",
    web_url:"https://gitlab.com/example/artisan-tools",
    description:"Public artisan tools",visibility:"public",archived:false},
  {id:23,path_with_namespace:"example/private-artisan",
    web_url:"https://gitlab.com/example/private-artisan",visibility:"private"},
  {id:24,path_with_namespace:"example/impostor",
    web_url:"https://gitlab.com.evil.example/example/impostor",visibility:"public"}
]);
async function fixture(run){
  const original=globalThis.fetch,seen=[];
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const old=keys.map(key=>process.env[key]);
  keys.forEach(key=>delete process.env[key]);
  globalThis.fetch=async input=>{
    const u=new URL(input);
    seen.push(u);
    if(u.hostname==="api.github.com")return github.clone();
    if(u.hostname==="gitlab.com")return gitlab.clone();
    if(u.hostname==="www.wikidata.org")return json({search:[],entities:{}});
    if(u.hostname==="es.wikipedia.org")return json({query:{search:[]}});
    return new Response("unavailable",{status:503});
  };
  try{await run(seen);}
  finally{
    globalThis.fetch=original;
    keys.forEach((k,i)=>old[i]===undefined
      ?delete process.env[k]:process.env[k]=old[i]);
  }
}
const sourceHosts=seen=>seen.filter(u=>["api.github.com","gitlab.com"]
  .includes(u.hostname));
test("explicit GitHub site and source route ordinary nontechnical topics",()=>{
  assert.equal(technicalWebQuery("artisan"),false);
  assert.equal(technicalWebQuery("artisan",null,"github"),true);
  assert.equal(technicalWebQuery("artisan","github.com"),true);
  assert.equal(technicalWebQuery("artisan","www.github.com"),true);
});
test("source:github returns only actual public repo pages without an index",()=>fixture(
  async seen=>{
    const page=await search("artisan source:github","all",{fresh:true});
    assert.deepEqual(page.results.map(x=>x.url),
      ["https://github.com/example/artisan-tools"]);
    assert.equal(page.results[0].indexedScope,"repository_metadata_only");
    assert.equal(page.results[0].source,"GitHub · repositorios públicos");
    assert.equal(page.searchCoverage.generalIndexDiagnosis.state,"not_queried");
    assert.deepEqual(sourceHosts(seen).map(u=>u.hostname),["api.github.com"]);
    assert.equal(sourceHosts(seen)[0].searchParams.get("q"),"artisan");
  }));
test("site:github.com retrieves bounded repository pages for ordinary topics",()=>fixture(
  async seen=>{
    const page=await search("artisan site:github.com","all",{fresh:true});
    assert.deepEqual(page.results.map(x=>x.url),
      ["https://github.com/example/artisan-tools"]);
    assert.ok(page.results.every(x=>x.url.startsWith("https://github.com/")));
    assert.equal(page.searchCoverage.entireWebIndexed,false);
    assert.deepEqual(page.searchCoverage.generalIndexes,[]);
    assert.deepEqual(sourceHosts(seen).map(u=>u.hostname),["api.github.com"]);
  }));
test("site:gitlab.com retrieves bounded public project pages for ordinary topics",()=>fixture(
  async seen=>{
    const page=await search("artisan site:gitlab.com","all",{fresh:true});
    assert.deepEqual(page.results.map(x=>x.url),
      ["https://gitlab.com/example/artisan-tools"]);
    assert.equal(page.results[0].source,"GitLab · repositorios públicos");
    assert.equal(page.results[0].indexedScope,"repository_metadata_only");
    assert.equal(page.searchCoverage.entireWebIndexed,false);
    assert.deepEqual(page.searchCoverage.generalIndexes,[]);
    assert.deepEqual(sourceHosts(seen).map(u=>u.hostname),["gitlab.com"]);
    const api=sourceHosts(seen)[0];
    assert.equal(api.pathname,"/api/v4/projects");
    assert.equal(api.searchParams.get("search"),"artisan");
    assert.equal(api.searchParams.get("visibility"),"public");
  }));
test("unrelated site and ordinary topics never contact repository APIs",()=>fixture(
  async seen=>{
    await search("artisan site:example.org","all",{fresh:true});
    await search("artisan","all",{fresh:true});
    assert.deepEqual(sourceHosts(seen),[]);
  }));
test("site:github.com does not inherit GitLab records; site:gitlab.com does not inherit GitHub",()=>fixture(
  async seen=>{
    const [a,b]=await Promise.all([
      search("artisan site:github.com","all",{fresh:true}),
      search("artisan site:gitlab.com","all",{fresh:true})
    ]);
    assert.ok(a.results.every(x=>new URL(x.url).hostname==="github.com"));
    assert.ok(b.results.every(x=>new URL(x.url).hostname==="gitlab.com"));
    assert.deepEqual(new Set(sourceHosts(seen).map(u=>u.hostname)),
      new Set(["api.github.com","gitlab.com"]));
  }));
