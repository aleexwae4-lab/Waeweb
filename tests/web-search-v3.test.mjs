import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {searxngConfig,searxngWeb,stackExchangeWeb,mdnWeb,technicalWebQuery} from "../server/web-providers.mjs";
import {registerWebHits,previewWebHit} from "../server/web-preview.mjs";
import {search} from "../server/search.mjs";
import {parseQuery} from "../server/intelligence.mjs";

test("SearXNG remains opt-in and validates the operator-controlled HTTPS endpoint",async()=>{
  const prev=process.env.WAE_SEARXNG_URL,old=globalThis.fetch;
  try{
    delete process.env.WAE_SEARXNG_URL;
    globalThis.fetch=()=>{throw Error("unexpected request");};
    assert.equal(searxngConfig(),null);
    assert.equal(await searxngWeb("prueba"),null);
    for(const unsafe of ["http://127.0.0.1:8000","https://localhost",
      "https://example.org:444","https://username:password@example.org",
      "https://example.org?redirect=https://localhost"])
      {process.env.WAE_SEARXNG_URL=unsafe;assert.equal(searxngConfig(),null,unsafe);}
    process.env.WAE_SEARXNG_URL="https://search.example.org/searx";
    globalThis.fetch=async(input,opts)=>{
      const u=new URL(input);
      assert.equal(u.href.startsWith("https://search.example.org/searx/search?"),true);
      assert.equal(u.searchParams.get("q"),"México site:example.org");
      assert.equal(u.searchParams.get("format"),"json");
      assert.equal(u.searchParams.get("pageno"),"2");
      assert.equal(opts.redirect,"error");
      return new Response(JSON.stringify({results:[
        {title:"Fuente real",url:"https://example.org/article",content:"Documento de fuente",engine:"brave"},
        {title:"Fake",url:"javascript:alert(1)",content:"No incluir"}
      ]}),{status:200});
    };
    const pages=await searxngWeb("México site:example.org",2);
    assert.equal(pages.length,1);
    assert.equal(pages[0].source,"SearXNG · índice web");
    assert.equal(pages[0].provenance,"brave");
    assert.equal(pages.hasMorePage,false);
  }finally{
    globalThis.fetch=old;
    if(prev===undefined)delete process.env.WAE_SEARXNG_URL;
    else process.env.WAE_SEARXNG_URL=prev;
  }
});
test("Stack Exchange API returns real question URLs and MDN returns real docs without inventing pages",async()=>{
  const prior=globalThis.fetch;
  globalThis.fetch=async url=>{
    const u=new URL(url);
    if(u.hostname==="api.stackexchange.com"){
      assert.equal(u.pathname,"/2.3/search/advanced");
      assert.equal(u.searchParams.get("sort"),"relevance");
      return new Response(JSON.stringify({items:[
        {title:"React &amp; TypeScript",link:"https://stackoverflow.com/questions/123",
          score:8,answer_count:3,creation_date:1700000000},
        {title:"Impostor",link:"https://evilstackoverflow.com/questions/7"}
      ]}),{status:200});
    }
    if(u.hostname==="developer.mozilla.org"){
      assert.equal(u.pathname,"/api/v1/search");
      return new Response(JSON.stringify({documents:[
        {title:"JavaScript",mdn_url:"/en-US/docs/Web/JavaScript",summary:"Referencia de JS"},
        {title:"Unsafe",mdn_url:"//evil.example.org"}
      ]}),{status:200});
    }
    throw Error("Unexpected "+u);
  };
  try{
    const stack=await stackExchangeWeb("React");
    assert.equal(stack.length,1);
    assert.equal(stack[0].title,"React & TypeScript");
    assert.equal(stack[0].source,"Stack Overflow · comunidad");
    const mdn=await mdnWeb("javascript");
    assert.equal(mdn.length,1);
    assert.equal(mdn[0].url,"https://developer.mozilla.org/en-US/docs/Web/JavaScript");
    assert.equal(technicalWebQuery("react",null,null),true);
    assert.equal(technicalWebQuery("historia de méxico",null,null),false);
    assert.equal(parseQuery("React source:mdn").source,"mdn");
    assert.equal(parseQuery("api source:stackoverflow").query,"api");
  }finally{globalThis.fetch=prior;}
});
test("public page excerpts require a recent authentic search result and only return limited text",async()=>{
  const now=Date.now(),page="https://example.org/article";
  registerWebHits([
    {title:"Real result",url:page,source:"Brave Search"},
    {title:"Blocked",url:"https://127.0.0.1/admin",source:"test"}
  ],now);
  let called=0;
  const read=async url=>{
    called++;assert.equal(url,page);
    return {url,title:"Page title",text:"Contenido real y legible. ".repeat(100),
      fetchedAt:new Date(now).toISOString()};
  };
  await assert.rejects(()=>previewWebHit("https://127.0.0.1/admin",{now,read}));
  await assert.rejects(()=>previewWebHit("https://other.org/never-searched",{now,read}),
    /búsqueda reciente/);
  assert.equal(called,0);
  const result=await previewWebHit(page+"#fragment",{now,read});
  assert.equal(result.kind,"source_excerpt");
  assert.equal(result.source,"Brave Search");
  assert.equal(result.excerpt.length,1200);
  assert.equal(result.hasMore,true);
  assert.equal(called,1);
  await assert.rejects(()=>previewWebHit(page,{now:now+21*60000,read}),
    /búsqueda reciente/);
});
test("web search federates technical sources alongside real general indexes",async()=>{
  const previousFetch=globalThis.fetch;
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const env=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  keys.forEach(k=>delete process.env[k]);
  const visited=[];
  globalThis.fetch=async input=>{
    const u=new URL(input);visited.push(u.hostname);
    if(u.hostname==="api.stackexchange.com"){
      return new Response(JSON.stringify({items:[{
        title:"React error solución",link:"https://stackoverflow.com/questions/123",
        answer_count:2,score:3,creation_date:1700000000
      }]}),{status:200});
    }
    if(u.hostname==="developer.mozilla.org")
      return new Response(JSON.stringify({documents:[{
        title:"React web APIs",mdn_url:"/en-US/docs/Web/API",summary:"Guía web de React"
      }]}),{status:200});
    if(u.hostname==="hn.algolia.com")
      return new Response(JSON.stringify({hits:[]}),{status:200});
    if(u.hostname==="es.wikipedia.org")
      return new Response(JSON.stringify({query:{search:[]}}),{status:200});
    if(u.hostname==="www.wikidata.org")
      return new Response(JSON.stringify({search:[]}),{status:200});
    throw Error("unexpected "+u);
  };
  try{
    const data=await search("React error prueba-web-v3","all",{fresh:true});
    assert.equal(data.webCoverage,"specialized");
    assert.ok(data.results.some(item=>item.source==="Stack Overflow · comunidad"));
    assert.ok(data.results.some(item=>item.source==="MDN Web Docs · documentación"));
    assert.equal(data.searchCoverage.generalIndexes.length,0);
    assert.equal(data.searchCoverage.inlineExcerpt,true);
    assert.ok(visited.includes("api.stackexchange.com"));
    assert.ok(visited.includes("developer.mozilla.org"));
  }finally{
    globalThis.fetch=previousFetch;
    for(const k of keys)env[k]===undefined?delete process.env[k]:process.env[k]=env[k];
  }
});
test("native web UI offers excerpt reading, source attribution, and visible search results",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const index=readFileSync(new URL("../server/index.mjs",import.meta.url),"utf8");
  assert.match(app,/Encuentra\. Explora\. Comprende\./);
  assert.match(app,/▤ Leer aquí/);
  assert.match(app,/\/api\/web\/preview\?url=/);
  assert.match(app,/↗ Fuente original/);
  assert.match(index,/\/api\/web\/preview/);
  assert.match(index,/searxngConfig/);
});
