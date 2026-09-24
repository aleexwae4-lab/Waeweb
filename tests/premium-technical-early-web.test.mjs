import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {quickOpenWeb,search} from "../server/search.mjs";
import {handler} from "../server/index.mjs";

const json=body=>new Response(JSON.stringify(body),{
  status:200,headers:{"content-type":"application/json"}});
const hn=json({hits:[{objectID:"2841357",title:"React hooks original tutorial",
  url:"https://tutorial.example.org/react-hooks",
  story_text:"Public source link about react hooks",
  created_at:"2026-09-20T00:00:00Z"}]});
const stack=json({items:[{title:"React hooks practical question",
  link:"https://stackoverflow.com/questions/1234567/react-hooks",
  score:12,answer_count:2,creation_date:1750000000}]});
const mdn=json({documents:[{title:"React hooks related JavaScript guide",
  mdn_url:"/en-US/docs/Web/JavaScript/Guide",
  summary:"Technical documentation for React hooks and JavaScript"}]});
async function fixture(fn){
  const fetchOld=globalThis.fetch,keys=["BRAVE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_API_KEY","GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const saved=keys.map(k=>process.env[k]);
  for(const k of keys)delete process.env[k];
  const seen=[];
  globalThis.fetch=async(input,...options)=>{
    const url=new URL(input);
    if(url.hostname==="127.0.0.1")return fetchOld(input,...options);
    seen.push(url);
    if(url.hostname==="hn.algolia.com")return hn.clone();
    if(url.hostname==="api.stackexchange.com"){
      if(url.searchParams.get("site")==="stackoverflow")return stack.clone();
      return json({items:[]});
    }
    if(url.hostname==="developer.mozilla.org")return mdn.clone();
    if(url.hostname==="es.wikipedia.org")return json({query:{search:[]}});
    if(url.hostname==="www.wikidata.org")return json({search:[]});
    return new Response("unavailable",{status:503});
  };
  try{await fn(seen);}
  finally{
    globalThis.fetch=fetchOld;
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

test("technical early preview retrieves authentic story, Q&A and MDN URLs",async()=>fixture(async seen=>{
  await serve(async base=>{
    const res=await fetch(base+"/api/search?quick=1&q="+
      encodeURIComponent("react hooks"));
    const body=await res.json();
    assert.equal(res.status,200);
    assert.equal(body.kind,"specialist_web_preview");
    assert.equal(body.scope,"public_technical_and_story_links");
    assert.equal(body.completeSearch,false);
    assert.deepEqual(body.generalIndexes,[]);
    assert.deepEqual(new Set(body.retrievedSources),
      new Set(["Hacker News","Stack Overflow","MDN Web Docs"]));
    assert.deepEqual(new Set(body.results.map(item=>item.source)),
      new Set(["Hacker News · web abierta",
        "Stack Overflow · comunidad","MDN Web Docs · documentación"]));
    assert.ok(body.results.every(item=>item.url.startsWith("https://")));
    assert.equal(body.results.find(item=>item.source.includes("Stack Overflow")).url,
      "https://stackoverflow.com/questions/1234567/react-hooks");
    assert.equal(body.results.find(item=>item.source.includes("MDN")).url,
      "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Guide");
  });
  assert.equal(seen.filter(u=>u.hostname==="hn.algolia.com").length,1);
  assert.equal(seen.filter(u=>u.hostname==="developer.mozilla.org").length,1);
  assert.equal(seen.filter(u=>u.hostname==="api.stackexchange.com").length,1);
}));

test("technical early preview reuses in-flight calls with full federated search",async()=>fixture(async seen=>{
  const [early,full]=await Promise.all([
    quickOpenWeb("react hooks"),search("react hooks","all",{fresh:true})
  ]);
  assert.equal(early.scope,"public_technical_and_story_links");
  assert.equal(early.completeSearch,false);
  assert.ok(early.results.length>=3);
  for(const page of early.results)
    assert.ok(full.results.some(hit=>hit.url===page.url),page.url);
  assert.equal(seen.filter(u=>u.hostname==="hn.algolia.com").length,1);
  assert.equal(seen.filter(u=>u.hostname==="developer.mozilla.org").length,1);
  assert.equal(seen.filter(u=>u.hostname==="api.stackexchange.com"&&
    u.searchParams.get("site")==="stackoverflow").length,1);
}));

test("navigation and unrelated queries never trigger early technical crawling",async()=>fixture(async seen=>{
  const generic=await quickOpenWeb("GitHub");
  assert.equal(generic.scope,"hacker_news_story_links");
  const generic2=await quickOpenWeb("mercado libre mexico");
  assert.equal(generic2.scope,"hacker_news_story_links");
  assert.equal(seen.filter(u=>u.hostname==="api.stackexchange.com"||
    u.hostname==="developer.mozilla.org").length,0);
  assert.ok(generic.results.every(item=>item.source==="Hacker News · web abierta"||
    item.source==="WAE Index local · HN"));
}));

test("advanced filters defer all early sources to complete search",async()=>fixture(async seen=>{
  for(const query of ['react hooks site:github.com',
    'react hooks source:mdn','"react hooks"','react hooks -marketing']){
    const early=await quickOpenWeb(query);
    assert.equal(early.sourceStatus,"not_applicable");
    assert.deepEqual(early.results,[]);
  }
  assert.equal(seen.length,0);
}));

test("frontend accepts only real named specialist sources with bounded result count",()=>{
  const ui=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(ui,/public_technical_and_story_links/);
  assert.match(ui,/Stack Overflow · comunidad/);
  assert.match(ui,/MDN Web Docs · documentación/);
  assert.match(ui,/preview\.results\.slice\(0,6\)/);
  assert.match(ui,/fullSearchFinished\|\|signal\.aborted\|\|sequence!==state\.sequence/);
});
