import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {validWikiPageId,wikipediaIntroduction} from "../server/encyclopedia.mjs";
import {handler} from "../server/index.mjs";

test("Wikipedia introduction only queries the fixed official Spanish MediaWiki host",async()=>{
  const seen=[],now=Date.now();
  const doc=await wikipediaIntroduction("301",{
    now,fetcher:async (input,options)=>{
      const url=new URL(input);seen.push(url.href);
      assert.equal(url.hostname,"es.wikipedia.org");
      assert.equal(url.pathname,"/w/api.php");
      assert.equal(url.searchParams.get("action"),"query");
      assert.equal(url.searchParams.get("pageids"),"301");
      assert.equal(url.searchParams.get("prop"),"extracts");
      assert.equal(url.searchParams.get("explaintext"),"1");
      assert.equal(url.searchParams.get("exintro"),"1");
      assert.equal(url.searchParams.get("exchars"),"2100");
      assert.equal(options.redirect,"error");
      return new Response(JSON.stringify({query:{pages:[{
        pageid:301,title:"Inteligencia artificial",
        extract:"La inteligencia artificial es un campo de la informática que estudia sistemas y métodos."
      }]}}),{status:200});
    }
  });
  assert.equal(doc.kind,"encyclopedia_introduction");
  assert.equal(doc.source,"Wikipedia · artículo original");
  assert.equal(doc.pageid,"301");
  assert.equal(doc.url,"https://es.wikipedia.org/?curid=301");
  assert.ok(doc.extract.length>=45);
  assert.match(doc.disclaimer,/no es una síntesis de IA ni una verificación independiente/);
  const again=await wikipediaIntroduction("301",{
    now:now+1000,fetcher:()=>{throw Error("Should use cache");}
  });
  assert.equal(again.extract,doc.extract);
  assert.equal(seen.length,1);
});
test("bad IDs, missing pages and short extracts cannot create synthetic answers",async()=>{
  for(const id of ["-1","0","0001","abc","301?q=x","301/../../admin","9999999999999"])
    assert.equal(validWikiPageId(id),false,id);
  assert.equal(validWikiPageId("301"),true);
  await assert.rejects(wikipediaIntroduction("https://evil.example.org/admin"),
    {code:"invalid_pageid",status:400});
  await assert.rejects(wikipediaIntroduction("302",{fetcher:async()=>new Response(JSON.stringify({
    query:{pages:[{pageid:302,missing:true,title:"No entry"}]}
  }),{status:200})}),{code:"no_extract",status:404});
  await assert.rejects(wikipediaIntroduction("303",{fetcher:async()=>new Response(JSON.stringify({
    query:{pages:[{pageid:303,title:"Sin artículo",extract:"Corto"}]}
  }),{status:200})}),{code:"no_extract",status:404});
  await assert.rejects(wikipediaIntroduction("304",{fetcher:async()=>new Response("Bad gateway",
    {status:502})}),{code:"upstream_status",status:502});
});
test("the public summary route validates identifiers without reaching arbitrary URLs",async()=>{
  const server=http.createServer((req,res)=>handler(req,res).catch(error=>{
    res.statusCode=500;res.end(error.message);
  }));
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+server.address().port;
    const response=await fetch(base+"/api/encyclopedia/summary?pageid=javascript%3Aalert(1)");
    assert.equal(response.status,400);
    assert.equal(response.headers.get("x-waeweb-api"),"1");
    assert.equal((await response.json()).code,"invalid_pageid");
  }finally{if(server.listening)await new Promise(resolve=>server.close(resolve));}
});
test("normal Wikipedia result can be read natively with voice and source attribution",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
  const start=app.indexOf("function encyclopediaWidget(item)");
  const end=app.indexOf("function renderInformationCard(item,index)",start);
  const content=app.slice(start,end);
  assert.ok(start>0&&end>start);
  assert.match(content,/item\.source!=="Wikipedia"/);
  assert.match(content,/url\.hostname!=="es\.wikipedia\.org"/);
  assert.match(content,/^[^\n]*pageid.*curid/m);
  assert.match(content,/getJSON\("\/api\/encyclopedia\/summary\?pageid="\+pageid\)/);
  assert.match(content,/data\.kind!=="encyclopedia_introduction"/);
  assert.match(content,/readAloud\(data\.extract/);
  assert.match(content,/data\.disclaimer/);
  assert.match(content,/↗ Artículo original/);
  assert.match(app,/if\(encyclopedia\)card\.append\(encyclopedia\)/);
  assert.match(app,/if\(encyclopedia\)reading\.append\(encyclopedia\)/);
  assert.match(css,/\.wae-encyclopedia-body\[hidden\]/);
});
