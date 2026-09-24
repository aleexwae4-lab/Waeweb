import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {handler} from "../server/index.mjs";
import {previewWebHit} from "../server/web-preview.mjs";
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
async function serve(fn){
  const server=http.createServer(handler);
  try{
    await new Promise(ok=>server.listen(0,"127.0.0.1",ok));
    await fn("http://127.0.0.1:"+server.address().port);
  }finally{if(server.listening)
    await new Promise(ok=>server.close(ok));}
}
const mockReader=url=>({url,title:"Texto de fuente pública",
  text:"Extracto auténtico consultado únicamente a solicitud del usuario. ".repeat(3),
  fetchedAt:new Date().toISOString()});
test("curated early site is eligible for source reading before full search finishes",async()=>{
  await serve(async base=>{
    const response=await fetch(base+"/api/search?nav=1&q="+encodeURIComponent("INEGI"));
    assert.equal(response.status,200);
    const body=await response.json();
    assert.equal(body.kind,"named_site_preview");
    assert.equal(body.site.url,"https://www.inegi.org.mx/");
    const text=await previewWebHit(body.site.url,{read:async url=>mockReader(url)});
    assert.equal(text.kind,"source_excerpt");
    assert.equal(text.source,body.site.source);
    assert.match(text.excerpt,/solicitud del usuario/);
  });
});
test("Wikidata P856 early site is eligible without granting unrelated URLs access",async()=>{
  const before=globalThis.fetch;
  const declared="https://www.early-wae-brand.example.org/";
  globalThis.fetch=async (url,...args)=>{
    if(new URL(url).hostname==="127.0.0.1")return before(url,...args);
    const u=new URL(url);
    assert.equal(u.hostname,"www.wikidata.org");
    if(u.searchParams.get("action")==="wbsearchentities")
      return new Response(JSON.stringify({search:[{id:"Q974001"}]}),{status:200});
    return new Response(JSON.stringify({entities:{Q974001:{
      labels:{es:{value:"Waeportalx"}},
      descriptions:{es:{value:"Servicio de prueba"}},
      claims:{P856:[{rank:"normal",mainsnak:{datavalue:{value:declared}}}]}
    }}}),{status:200});
  };
  try{
    await serve(async base=>{
      const res=await fetch(base+"/api/search?nav=1&q=Waeportalx");
      assert.equal(res.status,200);
      const data=await res.json();
      assert.equal(data.site.url,declared);
      assert.equal(data.site.linkBasis,"wikidata_P856");
      const read=await previewWebHit(declared,{read:async url=>mockReader(url)});
      assert.equal(read.kind,"source_excerpt");
      assert.equal(read.source,data.site.source);
      await assert.rejects(()=>previewWebHit(
        "https://never-discovered-wae.example.org/",{
          read:async()=>{throw Error("Must never fetch unknown URLs");}
        }),{code:"not_search_result"});
    });
  }finally{globalThis.fetch=before;}
});
test("reader avoids a known blocked iframe while preserving ordinary internal navigation",()=>{
  const start=app.indexOf("function createWebSourceReader(item,url)");
  const end=app.indexOf("function renderResult(item, index)",start);
  const reader=app.slice(start,end);
  assert.match(reader,/siteVisitMode\(url,window\.waeDesktop\?\.isNative===true\)==="original"/);
  assert.match(reader,/actions\.append\(external\(url,"↗ Visitar sitio original"/);
  assert.match(reader,/else actions\.append\(button\("◎ Navegar dentro",\(\)=>openBrowser\(url\)/);
  assert.match(reader,/▤ Recuperar texto original/);
  assert.match(app,/public_specialist_story_links/);
});
