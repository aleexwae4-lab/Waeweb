import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {translatorConfig,publicTranslateConfig,translateText,TranslateError} from "../server/translate.mjs";
import api from "../api/translate.js";
import {handler} from "../server/index.mjs";
const keys=["WAE_TRANSLATE_PROVIDER","WAE_TRANSLATE_URL","WAE_TRANSLATE_API_KEY","WAE_TRANSLATE_ALLOW_LOCAL","WAE_PREVIEW_MODE","VERCEL_ENV"];
function save(){return Object.fromEntries(keys.map(k=>[k,process.env[k]]));}
function restore(old){for(const [key,v]of Object.entries(old))if(v===undefined)delete process.env[key];else process.env[key]=v;}
test("MyMemory validates languages, UTF-8 bytes and never uses auto detection",async()=>{
  const old=save(),fetchOld=globalThis.fetch;
  try{
    process.env.WAE_TRANSLATE_PROVIDER="mymemory";
    assert.equal(publicTranslateConfig().autoDetect,false);
    await assert.rejects(translateText({text:"hola",source:"auto",target:"en"}),e=>e.code==="invalid_language");
    await assert.rejects(translateText({text:"á".repeat(226),source:"es",target:"en"}),e=>e.code==="text_too_long");
    await assert.rejects(translateText({text:"hola",source:"es",target:"es"}),e=>e.code==="same_language");
    let calls=0;
    globalThis.fetch=async url=>{
      calls++;
      const u=new URL(url);assert.equal(u.hostname,"api.mymemory.translated.net");
      assert.equal(u.searchParams.get("langpair"),"es|en");
      return new Response(JSON.stringify({responseStatus:200,responseData:{translatedText:"Hello"}}),{status:200});
    };
    const translated=await translateText({text:"Hola",source:"es",target:"en"});
    assert.equal(translated.translatedText,"Hello");
    assert.equal(translated.provider,"MyMemory");
    assert.equal(calls,1);
  }finally{restore(old);globalThis.fetch=fetchOld;}
});
test("LibreTranslate is opt-in and keys stay on server",async()=>{
  const old=save(),fetchOld=globalThis.fetch;
  try{
    process.env.WAE_TRANSLATE_PROVIDER="libretranslate";
    delete process.env.WAE_TRANSLATE_URL;
    assert.equal(translatorConfig().available,false);
    await assert.rejects(translateText({text:"Hola",source:"es",target:"en"}),e=>e.status===503);
    process.env.WAE_TRANSLATE_URL="http://169.254.169.254/";
    assert.equal(translatorConfig().available,false);
    process.env.WAE_TRANSLATE_URL="https://translate.example.test/";
    process.env.WAE_TRANSLATE_API_KEY="server-only-example";
    let payload;
    globalThis.fetch=async(url,options)=>{
      assert.equal(String(url),"https://translate.example.test/translate");
      assert.equal(options.redirect,"error");
      payload=JSON.parse(options.body);
      return new Response(JSON.stringify({translatedText:"Hello",detectedLanguage:{language:"es"}}),{status:200});
    };
    const result=await translateText({text:"Hola",source:"auto",target:"en"});
    assert.equal(result.detectedLanguage,"es");
    assert.equal(payload.api_key,"server-only-example");
    assert.equal(JSON.stringify(result).includes("server-only-example"),false);
  }finally{restore(old);globalThis.fetch=fetchOld;}
});
test("provider failure and quota fail honestly",async()=>{
  const old=save(),fetchOld=globalThis.fetch;
  try{
    process.env.WAE_TRANSLATE_PROVIDER="mymemory";
    globalThis.fetch=async()=>new Response("{}",{status:429});
    await assert.rejects(translateText({text:"Hola",source:"es",target:"en"}),e=>e.code==="provider_quota");
    globalThis.fetch=async()=>new Response(JSON.stringify({responseStatus:200,responseData:{}}),{status:200});
    await assert.rejects(translateText({text:"Hola",source:"es",target:"en"}),e=>e.code==="provider_unavailable");
  }finally{restore(old);globalThis.fetch=fetchOld;}
});
test("translator public POST in preview cannot access vault or mutate private APIs",async()=>{
  const old=save(),fetchOld=globalThis.fetch;
  process.env.WAE_PREVIEW_MODE="true";
  process.env.WAE_TRANSLATE_PROVIDER="mymemory";
  globalThis.fetch=async(url,options)=>String(url).includes("api.mymemory.translated.net")?
    new Response(JSON.stringify({responseStatus:200,responseData:{translatedText:"Hello"}}),{status:200}):fetchOld(url,options);
  const server=http.createServer(api);
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+server.address().port;
    const post=async (path,body)=>fetch(base+path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    const cap=await (await fetch(base+"/api/translate/capabilities")).json();
    assert.equal(cap.available,true);assert.equal(cap.autoDetect,false);
    const response=await post("/api/translate",{text:"Hola",source:"es",target:"en"});
    assert.equal(response.status,200);
    assert.equal(response.headers.get("x-waeweb-api"),"1");
    assert.equal((await response.json()).translatedText,"Hello");
    assert.equal((await fetch(base+"/api/translate")).status,405);
    assert.equal((await post("/api/read",{url:"https://example.org"})).status,503);
    assert.equal((await post("/api/account/register",{email:"nobody@example.org"})).status,503);
    assert.equal((await post("/api/translate",{text:"",source:"es",target:"en"})).status,400);
  }finally{
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    globalThis.fetch=fetchOld;restore(old);
  }
});
test("translator tab remains next to index and never requests a vault token",async()=>{
  const{readFile}=await import("node:fs/promises");
  const html=await readFile(new URL("../public/index.html",import.meta.url),"utf8");
  const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  const ix=html.indexOf('data-type="index"'),tr=html.indexOf('data-type="translate"'),book=html.indexOf('data-type="books"');
  assert.ok(ix>0&&tr>ix&&book>tr);
  assert.match(app,/\/api\/translate\/capabilities/);
  assert.match(app,/\/api\/translate"/);
  assert.match(app,/function renderTranslator/);
  assert.match(app,/No introduzcas datos confidenciales/);
});
