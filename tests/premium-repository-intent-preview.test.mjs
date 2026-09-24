import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {repositoryIntentTerms} from "../server/web-providers.mjs";
import {quickOpenWeb,search} from "../server/search.mjs";
import {handler} from "../server/index.mjs";

const json=data=>new Response(JSON.stringify(data),{status:200,
  headers:{"content-type":"application/json"}});
const github=json({items:[
  {id:42,full_name:"example/react-components",
    html_url:"https://github.com/example/react-components",
    description:"React components",language:"TypeScript",private:false,stargazers_count:40},
  {id:43,full_name:"example/fake",
    html_url:"https://github.com.attacker.example/example/fake",
    description:"Impostor",private:false,stargazers_count:900},
  {id:44,full_name:"example/private",
    html_url:"https://github.com/example/private",private:true}
]});
const hn=json({hits:[{objectID:"12345678",title:"React source on the web",
  url:"https://docs.example.org/react-components",created_at:"2026-09-24T00:00:00Z"}]});
const stack=json({items:[{title:"React example",
  link:"https://stackoverflow.com/questions/123/react",
  score:2,answer_count:1,creation_date:1750000000}]});
const mdn=json({documents:[{title:"React JavaScript tutorial",
  mdn_url:"/en-US/docs/Web/JavaScript/Guide",
  summary:"JavaScript documentation"}]});
async function fixture(fn){
  const original=globalThis.fetch,keys=["BRAVE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_API_KEY","GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const saved=keys.map(k=>process.env[k]),called=[];
  keys.forEach(k=>delete process.env[k]);
  globalThis.fetch=async(input,...options)=>{
    const u=new URL(input);
    if(u.hostname==="127.0.0.1")return original(input,...options);
    called.push(u);
    if(u.hostname==="api.github.com")return github.clone();
    if(u.hostname==="hn.algolia.com")return hn.clone();
    if(u.hostname==="api.stackexchange.com")return stack.clone();
    if(u.hostname==="developer.mozilla.org")return mdn.clone();
    if(u.hostname==="es.wikipedia.org")return json({query:{search:[]}});
    if(u.hostname==="www.wikidata.org")return json({search:[]});
    return new Response("temporarily unavailable",{status:503});
  };
  try{await fn(called);}
  finally{
    globalThis.fetch=original;
    keys.forEach((k,i)=>saved[i]===undefined
      ?delete process.env[k]:process.env[k]=saved[i]);
  }
}
async function serve(fn){
  const server=http.createServer(handler);
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    await fn("http://127.0.0.1:"+server.address().port);
  }finally{if(server.listening)await new Promise(resolve=>server.close(resolve));}
}

test("repository intent recognizes specific programming topics without capturing ordinary navigation",()=>{
  for(const [query,terms]of [
    ["repositorios React","React"],
    ["repositorios de Python SQLite","Python SQLite"],
    ["GitHub repos React","React"],
    ["React repositories","React"],
    ["source code for Docker","Docker"]
  ])assert.equal(repositoryIntentTerms(query),terms,query);
  for(const query of ["GitHub","repositorios","GitHub repositorios",
    "React tutorial","Mercado Libre México","JavaScript noticias",
    "GitHub Python release notes"])
    assert.equal(repositoryIntentTerms(query),null,query);
});

test("preview returns real public GitHub repos with provenance and no impostor URL",async()=>fixture(async called=>{
  await serve(async base=>{
    const response=await fetch(base+"/api/search?quick=1&q="+
      encodeURIComponent("repositorios React"));
    const result=await response.json();
    assert.equal(response.status,200);
    assert.equal(response.headers.get("x-waeweb-api"),"1");
    assert.equal(result.kind,"specialist_web_preview");
    assert.equal(result.scope,"public_code_and_story_links");
    assert.deepEqual(result.generalIndexes,[]);
    assert.equal(result.completeSearch,false);
    const repos=result.results.filter(row=>
      row.source==="GitHub · repositorios públicos");
    assert.equal(repos.length,1);
    assert.equal(repos[0].url,"https://github.com/example/react-components");
    assert.equal(repos[0].indexedScope,"repository_metadata_only");
    assert.ok(result.results.every(row=>row.url.startsWith("https://")));
    assert.equal(JSON.stringify(result.results).includes("attacker.example"),false);
  });
  const calls=called.filter(u=>u.hostname==="api.github.com");
  assert.equal(calls.length,1);
  assert.equal(calls[0].searchParams.get("q"),"React");
}));

test("fast and full SERP share one same GitHub repository request",async()=>fixture(async called=>{
  const [early,full]=await Promise.all([
    quickOpenWeb("repositorios React"),
    search("repositorios React","all",{fresh:true})
  ]);
  const repo=early.results.find(x=>x.source==="GitHub · repositorios públicos");
  assert.ok(repo);
  assert.ok(full.results.some(x=>x.url===repo.url));
  assert.equal(called.filter(u=>u.hostname==="api.github.com").length,1);
  assert.ok(early.retrievedSources.includes("GitHub · repositorios públicos"));
  assert.equal(full.searchCoverage.generalIndexes.length,0);
  assert.equal(full.searchCoverage.entireWebIndexed,false);
}));

test("GitHub navigator or advanced filters never cause preliminary repo leakage",async()=>fixture(async called=>{
  const nav=await quickOpenWeb("GitHub");
  assert.equal(nav.scope,"verified_local_web_links_only");
  assert.ok(nav.results.every(r=>r.source!=="GitHub · repositorios públicos"));
  const before=called.filter(u=>u.hostname==="api.github.com").length;
  for(const q of ["repositorios React site:example.org",
    "repositorios React source:github",'"repositorios React"',
    "repositorios React -example","repositorios React after:2026"]){
    const preview=await quickOpenWeb(q);
    assert.equal(preview.sourceStatus,"not_applicable",q);
    assert.deepEqual(preview.results,[],q);
  }
  assert.equal(called.filter(u=>u.hostname==="api.github.com").length,before);
}));

test("front end accepts verified public repository URLs without increasing fake web coverage",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/public_code_and_story_links/);
  assert.match(app,/GitHub · repositorios públicos/);
  assert.match(app,/preview\.results\.slice\(0,8\)/);
  assert.match(app,/fullSearchFinished\|\|signal\.aborted\|\|sequence!==state\.sequence/);
});
