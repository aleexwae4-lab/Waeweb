import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {braveSearch,googleSearch,search} from "../server/search.mjs";

test("Brave page two uses true zero-based page offset and provider next flag",async()=>{
  const fetchBefore=globalThis.fetch,token=process.env.BRAVE_SEARCH_API_KEY;
  process.env.BRAVE_SEARCH_API_KEY="test-private-token";
  globalThis.fetch=async url=>{
    const u=new URL(url);
    assert.equal(u.hostname,"api.search.brave.com");
    assert.equal(u.searchParams.get("count"),"20");
    assert.equal(u.searchParams.get("offset"),"1");
    return new Response(JSON.stringify({query:{more_results_available:false},
      web:{results:[{title:"Más información",url:"https://example.org/page-2",description:"Página web real"}]}}),{status:200});
  };
  try{
    const items=await braveSearch("wae pagination","web",2);
    assert.equal(items.length,1);
    assert.equal(items[0].url,"https://example.org/page-2");
    assert.equal(items.hasMorePage,false);
  }finally{
    globalThis.fetch=fetchBefore;
    if(token===undefined)delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY=token;
  }
});

test("Google page two uses start 11 and documented nextPage metadata",async()=>{
  const prior=globalThis.fetch,key=process.env.GOOGLE_SEARCH_API_KEY,cx=process.env.GOOGLE_SEARCH_ENGINE_ID;
  process.env.GOOGLE_SEARCH_API_KEY="test-key";
  process.env.GOOGLE_SEARCH_ENGINE_ID="test-cx";
  globalThis.fetch=async url=>{
    const u=new URL(url);
    assert.equal(u.hostname,"www.googleapis.com");
    assert.equal(u.searchParams.get("start"),"11");
    assert.equal(u.searchParams.get("num"),"10");
    return new Response(JSON.stringify({queries:{nextPage:[]},items:[
      {title:"Página dos",link:"https://example.org/google-two",snippet:"Resultado original"}
    ]}),{status:200});
  };
  try{
    const items=await googleSearch("wae pagination","web",2);
    assert.equal(items.length,1);
    assert.equal(items.hasMorePage,false);
  }finally{
    globalThis.fetch=prior;
    if(key===undefined)delete process.env.GOOGLE_SEARCH_API_KEY;else process.env.GOOGLE_SEARCH_API_KEY=key;
    if(cx===undefined)delete process.env.GOOGLE_SEARCH_ENGINE_ID;else process.env.GOOGLE_SEARCH_ENGINE_ID=cx;
  }
});

test("second page queries only web indexes, not first-page encyclopedia",async()=>{
  const old=globalThis.fetch,key=process.env.BRAVE_SEARCH_API_KEY;
  const g=process.env.GOOGLE_SEARCH_API_KEY,cx=process.env.GOOGLE_SEARCH_ENGINE_ID;
  process.env.BRAVE_SEARCH_API_KEY="test-key";
  delete process.env.GOOGLE_SEARCH_API_KEY;
  delete process.env.GOOGLE_SEARCH_ENGINE_ID;
  const visited=[];
  globalThis.fetch=async url=>{
    const u=new URL(url);visited.push(u.hostname);
    assert.equal(u.hostname,"api.search.brave.com");
    assert.equal(u.searchParams.get("offset"),"1");
    return new Response(JSON.stringify({query:{more_results_available:false},
      web:{results:[{title:"WAE result 2",url:"https://example.org/second",description:"Documento real"}]}}),{status:200});
  };
  try{
    const result=await search("wae-real-pages-pagination-2026","all",{page:2,fresh:true});
    assert.equal(result.page,2);
    assert.equal(result.results.length,1);
    assert.equal(result.hasMore,false);
    assert.equal(result.webCoverage,"general-index");
    assert.deepEqual(visited,["api.search.brave.com"]);
    assert.match((await search("wae pages","images",{page:2})).error,/paginación adicional/);
    assert.match((await search("wae pages","all",{page:6})).error,/entre 1 y 5/);
  }finally{
    globalThis.fetch=old;
    if(key===undefined)delete process.env.BRAVE_SEARCH_API_KEY;else process.env.BRAVE_SEARCH_API_KEY=key;
    if(g===undefined)delete process.env.GOOGLE_SEARCH_API_KEY;else process.env.GOOGLE_SEARCH_API_KEY=g;
    if(cx===undefined)delete process.env.GOOGLE_SEARCH_ENGINE_ID;else process.env.GOOGLE_SEARCH_ENGINE_ID=cx;
  }
});

test("next-page UI calls API only by explicit action and supports safe cancellation",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const server=readFileSync(new URL("../server/index.mjs",import.meta.url),"utf8");
  assert.match(app,/Buscar más páginas web/);
  assert.match(app,/async function loadMoreWebResults\(/);
  assert.match(app,/\u0026type=all\u0026page=/);
  assert.match(app,/if\(sequence!==state\.sequence \|\| state\.query!==query/);
  assert.match(app,/↻ Reintentar más páginas/);
  assert.match(server,/const rawPage=u\.searchParams\.get\("page"\)\|\|"1"/);
});
