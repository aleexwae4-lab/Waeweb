import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {rankResults,parseQuery,diversifyWebResults} from "../server/intelligence.mjs";
import {search} from "../server/search.mjs";

const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");

test("organic results open real origin and retain optional in-app browser",()=>{
  assert.match(app,/state\.type === "all"\s*\? external\(url,item\.title,"result-title web-result-title"\)/);
  assert.match(app,/◎ Explorar dentro/);
  assert.match(app,/state\.type === "research" \|\| state\.type === "index"/);
  assert.match(css,/\.result-card\.web-result/);
});
test("initial SERP shows ten actual results, then explicitly more recovered ones",()=>{
  assert.match(app,/visibleCount: 10/);
  assert.match(app,/state\.results\.slice\(0,state\.visibleCount\)/);
  assert.match(app,/state\.visibleCount\+=10/);
  assert.match(app,/resultados web adicionales ya recuperados/);
});
test("source ranking keeps genuine pages and diversifies repeated hosts",()=>{
  const items=[
    ...Array.from({length:4},(_,i)=>({title:"Motos",snippet:"Zapopan",url:"https://same.example.org/"+i,source:"Brave Search"})),
    {title:"Motos",snippet:"Zapopan",url:"https://other.example.org/info",source:"Brave Search"}
  ];
  const ranked=rankResults(items,parseQuery("Motos Zapopan"),"all");
  assert.equal(ranked.length,5);
  assert.equal(ranked[2].url,"https://other.example.org/info");
  const constrained=rankResults(items,parseQuery("motos site:same.example.org"),"all");
  assert.equal(constrained.length,4);
  assert.equal(constrained[2].url,"https://same.example.org/2");
  assert.equal(diversifyWebResults(items).length,5);
});
test("default general search does not query paper or book providers without user selecting categories",async()=>{
  const oldFetch=globalThis.fetch;
  const savedBrave=process.env.BRAVE_SEARCH_API_KEY;
  const savedGoogle=process.env.GOOGLE_SEARCH_API_KEY;
  const savedEngine=process.env.GOOGLE_SEARCH_ENGINE_ID;
  delete process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.GOOGLE_SEARCH_API_KEY;
  delete process.env.GOOGLE_SEARCH_ENGINE_ID;
  const seen=[];
  globalThis.fetch=async url=>{
    const u=new URL(url);
    seen.push(u.hostname);
    if(u.hostname==="es.wikipedia.org")
      return new Response(JSON.stringify({query:{search:[
        {title:"Taller motos Zapopan",pageid:123,snippet:"Ficha informativa de ejemplo"}
      ]}}),{status:200});
    if(u.hostname==="www.wikidata.org")
      return new Response(JSON.stringify({search:[]}),{status:200});
    throw new Error("Unexpected academic or book provider "+u.hostname);
  };
  try{
    const found=await search("waeweb-motos-prueba-web-first","all",{fresh:true});
    assert.equal(found.results.length,0);
    assert.equal(found.webCoverage,"limited");
    assert.match(found.message,/No hay un índice web general conectado/);
    assert.ok(!seen.includes("es.wikipedia.org"));
    assert.ok(seen.every(host=>!/(wikipedia|wikidata|crossref|openalex|europepmc|openlibrary)/i.test(host)));
    assert.equal(found.brief.kind,"extractive");
  }finally{
    globalThis.fetch=oldFetch;
    if(savedBrave===undefined)delete process.env.BRAVE_SEARCH_API_KEY;else process.env.BRAVE_SEARCH_API_KEY=savedBrave;
    if(savedGoogle===undefined)delete process.env.GOOGLE_SEARCH_API_KEY;else process.env.GOOGLE_SEARCH_API_KEY=savedGoogle;
    if(savedEngine===undefined)delete process.env.GOOGLE_SEARCH_ENGINE_ID;else process.env.GOOGLE_SEARCH_ENGINE_ID=savedEngine;
  }
});
