import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {rankResults,parseQuery,webResultKind} from "../server/intelligence.mjs";
import {search} from "../server/search.mjs";

test("real navigable pages precede exact-title encyclopedias in Web, without deleting either",()=>{
  const rows=[
    {title:"Solar energy",url:"https://en.wikipedia.org/wiki/Solar_energy",
      snippet:"Solar energy",source:"Wikipedia"},
    {title:"Solar energy",url:"https://www.wikidata.org/wiki/Q42",
      snippet:"Entity",source:"Wikidata"},
    {title:"Solar energy practical guide",url:"https://energy.example.org/guide",
      snippet:"Source-backed guide",source:"Brave Search"},
    {title:"Solar energy examples",url:"https://community.example.org/examples",
      snippet:"Public linked page",source:"Hacker News · web abierta"},
    {title:"Solar energy",url:"https://energy.example.org/",
      snippet:"Known website",source:"Wikidata · sitio web declarado",
      siteLink:true,linkBasis:"wikidata_P856"}
  ];
  const ranked=rankResults(rows,parseQuery("solar energy"),"all");
  assert.deepEqual(ranked.map(webResultKind),[
    "named_site","web_page","web_page","encyclopedia","encyclopedia"
  ]);
  assert.equal(ranked.length,rows.length);
  assert.equal(ranked[0].url,"https://energy.example.org/");
  assert.equal(ranked.at(-1).source,"Wikidata");
});

test("domain diversity does not lift wiki entries over deferred organic pages",()=>{
  const rows=[
    ...Array.from({length:4},(_,i)=>({
      title:"Solar power",url:"https://energy.example.org/page-"+i,
      snippet:"Solar power",source:"Brave Search"
    })),
    {title:"Solar power",url:"https://es.wikipedia.org/wiki/Energia_solar",
      snippet:"Solar power",source:"Wikipedia"}
  ];
  const ranked=rankResults(rows,parseQuery("solar power"),"all");
  assert.deepEqual(ranked.slice(0,4).map(webResultKind),
    ["web_page","web_page","web_page","web_page"]);
  assert.equal(webResultKind(ranked[4]),"encyclopedia");
});

test("site and source operators retain their explicit search behavior",()=>{
  const items=[
    {title:"Documentación",url:"https://docs.example.org/guide",source:"Brave Search",snippet:"Topic"},
    {title:"Documentación",url:"https://es.wikipedia.org/wiki/Topic",source:"Wikipedia",snippet:"Topic"}
  ];
  assert.equal(rankResults(items,parseQuery("topic site:es.wikipedia.org"),"all").length,1);
  assert.equal(rankResults(items,parseQuery("topic source:wikipedia"),"all")[0].source,"Wikipedia");
  assert.equal(rankResults(items,parseQuery("topic"),"knowledge").length,2);
  assert.equal(webResultKind({siteLink:true,source:"Wikidata · sitio web declarado",
    url:"https://example.org/"}),"named_site");
});

test("a live-shaped Brave response wins over a more exact wiki title in the web API",async()=>{
  const previous=globalThis.fetch;
  const names=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const saved=names.map(name=>process.env[name]);
  for(const name of names)delete process.env[name];
  process.env.BRAVE_SEARCH_API_KEY="fixture-only";
  globalThis.fetch=async input=>{
    const url=new URL(input);
    if(url.hostname==="api.search.brave.com")
      return new Response(JSON.stringify({web:{results:[{
        title:"Solar power installation guide",
        url:"https://guide.example.org/solar",description:"Real source-backed guide"
      }]}}),{status:200});
    if(url.hostname==="es.wikipedia.org")
      return new Response(JSON.stringify({query:{search:[{
        title:"Solar power",pageid:900,snippet:"Exact encyclopedic title"
      }]}}),{status:200});
    if(url.hostname==="www.wikidata.org")
      return new Response(JSON.stringify({search:[]}),{status:200});
    return new Response("unavailable",{status:503});
  };
  try{
    const page=await search("solar power","all",{fresh:true});
    assert.equal(page.results[0].url,"https://guide.example.org/solar");
    assert.ok(page.results.some(item=>item.source==="Wikipedia"));
    assert.equal(page.searchCoverage.webPages,1);
    assert.equal(page.searchCoverage.encyclopediaPages,1);
    assert.equal(page.searchCoverage.navigationalSites,0);
    assert.equal(page.searchCoverage.generalIndexDiagnosis.state,"results");
    assert.equal(page.webCoverage,"general-index");
  }finally{
    globalThis.fetch=previous;
    names.forEach((name,index)=>saved[index]===undefined
      ?delete process.env[name]:process.env[name]=saved[index]);
  }
});

test("compact web SERP reports navigable links separately from encyclopedia entries",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/coverage\?\.webPages\|\|0/);
  assert.match(app,/páginas web · /);
  assert.match(app,/coverage\?\.encyclopediaPages\|\|0/);
  assert.match(app,/fichas de conocimiento · /);
  assert.match(app,/coverage\?\.navigationalSites\|\|0/);
});
