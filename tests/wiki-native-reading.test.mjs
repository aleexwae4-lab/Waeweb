import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {wikipediaSummary} from "../server/search.mjs";
import {handler} from "../server/index.mjs";

test("numeric Wikipedia page IDs yield a source-backed extract, not a browser handoff",async()=>{
  const prior=globalThis.fetch;
  const hosts=[];
  globalThis.fetch=async url=>{
    const u=new URL(url);hosts.push(u.hostname);
    assert.equal(u.hostname,"es.wikipedia.org");
    assert.equal(u.searchParams.get("pageids"),"321");
    assert.equal(u.searchParams.get("explaintext"),"1");
    return new Response(JSON.stringify({query:{pages:{"321":{
      title:"Inteligencia artificial",extract:"Explicación pública de <b>inteligencia artificial</b>."
    }}}}),{status:200});
  };
  try{
    assert.deepEqual(await wikipediaSummary("321"),{
      pageId:321,title:"Inteligencia artificial",
      extract:"Explicación pública de inteligencia artificial.",
      source:"Wikipedia",url:"https://es.wikipedia.org/?curid=321"
    });
    assert.equal(hosts.length,1);
    assert.deepEqual(await wikipediaSummary("https://127.0.0.1/secret"),{error:"Artículo no válido."});
    assert.equal(hosts.length,1);
  }finally{globalThis.fetch=prior;}
});

test("native reading API is public, validated, and uses the same result page",async()=>{
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async url=>{
    assert.equal(new URL(url).hostname,"es.wikipedia.org");
    return new Response(JSON.stringify({query:{pages:{"321":{
      title:"Inteligencia artificial",extract:"Artículo verificable dentro de WAE WEB."
    }}}}),{status:200});
  };
  const server=http.createServer((req,res)=>handler(req,res).catch(e=>{res.statusCode=500;res.end(e.message);}));
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+server.address().port;
    const valid=await originalFetch(base+"/api/wiki/summary?pageid=321");
    assert.equal(valid.status,200);
    assert.equal((await valid.json()).source,"Wikipedia");
    const invalid=await originalFetch(base+"/api/wiki/summary?pageid=http%3A%2F%2F127.0.0.1");
    assert.equal(invalid.status,400);
  }finally{
    globalThis.fetch=originalFetch;
    if(server.listening)await new Promise(resolve=>server.close(resolve));
  }
});

test("search UI renders Wikimedia video and Wikipedia reading natively",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
  assert.match(app,/wiki-inline-extract/);
  assert.match(app,/api\/wiki\/summary\?pageid=/);
  assert.match(app,/▤ Leer artículo aquí/);
  assert.match(app,/stream\.src=item\.mediaUrl/);
  assert.match(app,/dialog\.showModal\(\)/);
  assert.match(css,/\.wiki-inline-extract\[hidden\]/);
});
