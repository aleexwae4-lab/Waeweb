import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {translateText,publicTranslateConfig,resetTranslationCooldown} from "../server/translate.mjs";
import {handler} from "../server/index.mjs";

const fixture={text:"Hola mundo",source:"es",target:"en"};
const run=async fn=>{
  const original=globalThis.fetch,prior=process.env.WAE_TRANSLATE_PROVIDER;
  process.env.WAE_TRANSLATE_PROVIDER="mymemory";
  resetTranslationCooldown();
  try{await fn();}
  finally{
    globalThis.fetch=original;
    if(prior===undefined)delete process.env.WAE_TRANSLATE_PROVIDER;
    else process.env.WAE_TRANSLATE_PROVIDER=prior;
    resetTranslationCooldown();
  }
};
test("provider quota opens a bounded circuit and subsequent requests do not consume provider quota",async()=>run(async()=>{
  let calls=0;
  globalThis.fetch=async()=>{
    calls++;
    return new Response("{}",{status:429,headers:{"retry-after":"120"}});
  };
  await assert.rejects(translateText(fixture),e=>
    e.code==="provider_quota"&&e.retryAfterSeconds===120);
  assert.equal(calls,1);
  const cap=publicTranslateConfig();
  assert.equal(cap.available,false);
  assert.equal(cap.configured,true);
  assert.equal(cap.quotaLimited,true);
  assert.ok(cap.retryAfterSeconds>0&&cap.retryAfterSeconds<=120);
  await assert.rejects(translateText(fixture),e=>
    e.code==="provider_quota"&&e.retryAfterSeconds>0);
  assert.equal(calls,1,"cooldown must prevent an upstream call");
  assert.equal(JSON.stringify(cap).includes("api.mymemory.translated.net"),false);
}));

test("upstream 200 with MyMemory daily-quota body also trips breaker, ignoring its fake text",async()=>run(async()=>{
  let calls=0;
  globalThis.fetch=async()=>{
    calls++;
    return new Response(JSON.stringify({
      responseStatus:429,responseDetails:"Daily limit reached",
      responseData:{translatedText:"NOT A TRANSLATION"}
    }),{status:200});
  };
  await assert.rejects(translateText(fixture),e=>
    e.code==="provider_quota"&&e.status===429);
  await assert.rejects(translateText(fixture),e=>e.code==="provider_quota");
  assert.equal(calls,1);
  assert.equal(publicTranslateConfig().quotaLimited,true);
}));

test("provider cooldown never erases the available config and resets after interval",async()=>run(async()=>{
  let calls=0;
  globalThis.fetch=async()=>{
    calls++;
    return calls===1?new Response("{}",{status:429}):
      new Response(JSON.stringify({
        responseStatus:200,responseData:{translatedText:"Hello world"}
      }),{status:200});
  };
  await assert.rejects(translateText(fixture),e=>
    e.retryAfterSeconds===300);
  resetTranslationCooldown();
  const translated=await translateText(fixture);
  assert.equal(translated.translatedText,"Hello world");
  assert.equal(publicTranslateConfig().available,true);
  assert.equal(publicTranslateConfig().quotaLimited,false);
  assert.equal(calls,2);
}));

test("real HTTP API and capabilities carry quota state and Retry-After without exposing secrets",async()=>run(async()=>{
  let calls=0;
  const realFetch=globalThis.fetch;
  globalThis.fetch=async(url,...args)=>String(url).includes("api.mymemory.translated.net")
    ?(calls++,new Response("{}",{status:429,headers:{"retry-after":"95"}}))
    :realFetch(url,...args);
  const server=http.createServer(handler);
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+server.address().port;
    const post=()=>fetch(base+"/api/translate",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify(fixture)
    });
    const first=await post();
    assert.equal(first.status,429);
    assert.equal(first.headers.get("retry-after"),"95");
    const body=await first.json();
    assert.equal(body.code,"provider_quota");
    assert.equal(body.retryAfterSeconds,95);
    assert.equal(body.translatedText,undefined);
    const cap=await (await fetch(base+"/api/translate/capabilities")).json();
    assert.equal(cap.quotaLimited,true);
    assert.equal(cap.available,false);
    assert.ok(cap.retryAfterSeconds>0);
    const again=await post();
    assert.equal(again.status,429);
    assert.equal((await again.json()).code,"provider_quota");
    assert.equal(calls,1);
  }finally{await new Promise(resolve=>server.close(resolve));}
}));

test("translator UI treats quota as a pause rather than a disconnected API or synthetic translation",()=>{
  const ui=readFileSync(new URL("../public/translator.js",import.meta.url),"utf8");
  assert.match(ui,/info\.quotaLimited/);
  assert.match(ui,/config\?\.quotaLimited/);
  assert.match(ui,/getJSON\("\/api\/translate\/capabilities",signal\)/);
  assert.match(ui,/El proveedor alcanzó su cuota/);
  assert.doesNotMatch(ui,/Sin traducción por ahora\..*translatedText:/);
});
