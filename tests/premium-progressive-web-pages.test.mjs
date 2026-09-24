import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {handler} from "../server/index.mjs";
import {search,quickOpenWeb} from "../server/search.mjs";

const fixture=(id="987654")=>new Response(JSON.stringify({hits:[{
  objectID:id,title:"Progressive web guide — actual source",
  url:"https://www.example.org/progressive/guide",
  story_text:"A real link published by a community; source text not independently verified.",
  created_at:"2026-09-24T00:00:00Z"
}]}),{status:200,headers:{"content-type":"application/json"}});
const withFetcher=async fn=>{
  const prior=globalThis.fetch;
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const saved=keys.map(key=>process.env[key]);
  for(const key of keys)delete process.env[key];
  try{await fn(prior);}
  finally{
    globalThis.fetch=prior;
    keys.forEach((key,i)=>saved[i]===undefined
      ?delete process.env[key]:process.env[key]=saved[i]);
  }
};
async function serve(fn){
  const server=http.createServer(handler);
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    await fn("http://127.0.0.1:"+server.address().port);
  }finally{if(server.listening)await new Promise(resolve=>server.close(resolve));}
}
test("quick endpoint yields source-attributed actual page links, not Wikipedia or a general index",async()=>withFetcher(async native=>{
  let calls=0;
  globalThis.fetch=async(url,...args)=>{
    if(String(url).startsWith("http://127.0.0.1:"))return native(url,...args);
    assert.equal(new URL(url).hostname,"hn.algolia.com");
    calls++;
    return fixture();
  };
  await serve(async base=>{
    const response=await fetch(base+"/api/search?quick=1&type=all&q="+
      encodeURIComponent("progressive web guide"));
    assert.equal(response.status,200);
    assert.equal(response.headers.get("x-waeweb-api"),"1");
    const data=await response.json();
    assert.equal(data.kind,"specialist_web_preview");
    assert.equal(data.scope,"hacker_news_story_links");
    assert.equal(data.completeSearch,false);
    assert.deepEqual(data.generalIndexes,[]);
    assert.equal(data.sourceStatus,"no_match");
    assert.equal(data.results.length,0);
    assert.ok(!("entireWebIndexed" in data));
  });
  assert.equal(calls,1);
}));

test("federation and early pages coalesce one HN request per concurrent query",async()=>withFetcher(async()=>{
  let calls=0;
  globalThis.fetch=async url=>{
    const u=new URL(url);
    if(u.hostname==="hn.algolia.com"){
      calls++;
      await new Promise(resolve=>setImmediate(resolve));
      return fixture("987655");
    }
    if(u.hostname==="es.wikipedia.org")
      return new Response(JSON.stringify({query:{search:[]}}),{status:200});
    if(u.hostname==="www.wikidata.org")
      return new Response(JSON.stringify({search:[]}),{status:200});
    return new Response("temporarily unavailable",{status:503});
  };
  const q="progressive-coalesced-browser-story";
  const [early,all]=await Promise.all([
    quickOpenWeb(q),search(q,"all",{fresh:true})
  ]);
  assert.equal(calls,1);
  assert.equal(early.results.length,0);
  assert.ok(!all.results.some(item=>item.source==="Hacker News · web abierta"));
  assert.equal(early.completeSearch,false);
  assert.equal(all.type,"all");
}));

test("operator-constrained and category-constrained previews cannot leak an unconstrained link",async()=>withFetcher(async native=>{
  let calls=0;
  globalThis.fetch=async(url,...args)=>{
    if(String(url).startsWith("http://127.0.0.1:"))return native(url,...args);
    calls++;
    return fixture();
  };
  await serve(async base=>{
    for(const q of ["progressive site:github.com","progressive source:wikipedia",
      'progressive "exact phrase"',"progressive -marketing",
      "progressive after:2025","a"]){
      const res=await fetch(base+"/api/search?quick=1&q="+encodeURIComponent(q));
      assert.equal(res.status,200,q);
      const body=await res.json();
      assert.equal(body.sourceStatus,"not_applicable",q);
      assert.deepEqual(body.results,[],q);
    }
    for(const suffix of ["quick=2&q=progressive",
      "quick=1&type=news&q=progressive",
      "quick=1&nav=1&q=progressive",
      "quick=1&page=2&q=progressive"]){
      const res=await fetch(base+"/api/search?"+suffix);
      assert.equal(res.status,400,suffix);
    }
    assert.equal((await fetch(base+"/api/search?quick=1&q="+
      "a".repeat(181))).status,400);
  });
  assert.equal(calls,0);
}));

test("early source outage never invents a page and leaves complete search independent",async()=>withFetcher(async()=>{
  globalThis.fetch=async()=>new Response("upstream error",{status:503});
  const data=await quickOpenWeb("progressive-outage-unknown-9025");
  assert.equal(data.kind,"specialist_web_preview");
  assert.equal(data.completeSearch,false);
  assert.deepEqual(data.results,[]);
  assert.equal(data.sourceStatus,"unavailable");
}));

test("progressive UI protects search races and keeps actual source links on later failure",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/getJSON\("\/api\/search\?q="\+encodeURIComponent\(q\)\+"&type=all&quick=1",signal\)/);
  assert.match(app,/fullSearchFinished\|\|signal\.aborted\|\|sequence!==state\.sequence/);
  assert.match(app,/public_technical_and_story_links/);
  assert.match(app,/Hacker News · web abierta/);
  assert.match(app,/resultsContainer\.replaceChildren\(note,\.\.\.cards\)/);
  assert.match(app,/if\(earlySiteShown\|\|earlyPagesShown\)\{/);
  assert.match(app,/fullSearchFinished=true;\s*renderData\(data\)/);
});
