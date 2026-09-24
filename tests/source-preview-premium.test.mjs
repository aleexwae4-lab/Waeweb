import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {registerWebHits,previewWebHit} from "../server/web-preview.mjs";
import {search} from "../server/search.mjs";

test("preview can only read recent HTTPS source-backed search URLs",async()=>{
  const url="https://news-preview-verified.example.org/story/123";
  const now=Date.now();
  const article="Texto original de la página permitida. ".repeat(45);
  registerWebHits([
    {title:"Noticia atribuida",url,source:"Prensa auténtica"},
    {title:"Dirección maliciosa",url:"http://127.0.0.1/admin",source:"No"},
    {title:"Ruta inexistente",url:"javascript:alert(1)",source:"No"}],now);
  let calls=0;
  const read=async input=>{
    calls++;assert.equal(input,url);
    return {url,title:"Título original",text:article,
      fetchedAt:"2026-09-23T10:20:00.000Z"};
  };
  const preview=await previewWebHit(url,{now:now+1000,read});
  assert.equal(preview.title,"Título original");
  assert.equal(preview.source,"Prensa auténtica");
  assert.equal(preview.kind,"source_excerpt");
  assert.equal(preview.excerpt,article.slice(0,1200));
  assert.equal(preview.hasMore,true);
  assert.match(preview.disclaimer,/robots\.txt/);
  assert.equal(calls,1);
  await assert.rejects(previewWebHit("https://not-discovered-preview.example.org/other",
    {now,read}),{code:"not_search_result"});
  await assert.rejects(previewWebHit("http://127.0.0.1/admin",{now,read}),
    {code:"invalid_url"});
  await assert.rejects(previewWebHit(url,{now:now+21*60000,read}),
    {code:"not_search_result"});
  assert.equal(calls,1,"expired or forged URL never initiates reading");
});
test("news search registers real feed records for optional on-demand preview",async()=>{
  const oldFetch=globalThis.fetch;
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_SEARCH_ENGINE_ID"];
  const saved=keys.map(k=>process.env[k]);keys.forEach(k=>delete process.env[k]);
  const pub=new Date(Date.now()-12*60000).toUTCString();
  const newsUrl="https://news-original-preview.example.org/actualidad/2026";
  const feed='<?xml version="1.0"?><rss version="2.0"><channel><item>'+
    '<title>Investigación verificable sobre energía</title><link>'+newsUrl+
    '</link><pubDate>'+pub+'</pubDate><description>Fuente y contexto</description>'+
    '</item></channel></rss>';
  globalThis.fetch=async input=>{
    const u=new URL(input);
    if(["news.google.com","www.bbc.com","feeds.elpais.com"].includes(u.hostname))
      return new Response(u.hostname==="www.bbc.com"?feed:
        '<?xml version="1.0"?><rss><channel></channel></rss>',{status:200});
    throw Error("Other feed unavailable");
  };
  try{
    const data=await search("investigación energía","news",{newsWindow:"24h",fresh:true});
    assert.equal(data.results.length,1);
    assert.equal(data.results[0].url,newsUrl);
    const page=await previewWebHit(newsUrl,{read:async url=>({
      url,title:"Texto desde el sitio original",
      text:"Texto del sitio original obtenido tras comprobar robots.txt y DNS. "+
        "La consulta de noticias por sí sola no proporciona este cuerpo.",
      fetchedAt:new Date().toISOString()
    })});
    assert.equal(page.source,"BBC Mundo · RSS");
    assert.match(page.excerpt,/obtenido tras comprobar/);
    assert.equal(page.kind,"source_excerpt");
    // The cached result also renews the preview registration, independently
    // of the preview's own 20-minute expiry.
    const cached=await search("investigación energía","news",{newsWindow:"24h"});
    assert.equal(cached.results[0].url,newsUrl);
    const again=await previewWebHit(newsUrl,{read:async url=>({
      url,title:"Texto auténtico",text:"Extracto original nuevamente disponible desde búsqueda cacheada.",
      fetchedAt:new Date().toISOString()
    })});
    assert.equal(again.kind,"source_excerpt");
  }finally{
    globalThis.fetch=oldFetch;
    keys.forEach((k,i)=>saved[i]===undefined?delete process.env[k]:process.env[k]=saved[i]);
  }
});
test("news and knowledge UI fetches limited source text only after user clicks, never claims full article",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const searchCode=readFileSync(new URL("../server/search.mjs",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
  const start=app.indexOf("function renderInformationCard(item,index)");
  const end=app.indexOf("function renderResult(item, index)",start);
  const card=app.slice(start,end);
  assert.match(card,/const recover=button\("▤ Ampliar desde el sitio original",async\(\)=>/);
  assert.match(card,/getJSON\("\/api\/web\/preview\?url="\+encodeURIComponent\(url\)\)/);
  assert.match(card,/data\.kind!=="source_excerpt"/);
  assert.match(card,/data\.excerpt\.length<30/);
  assert.match(card,/sourceExcerpt=data\.excerpt/);
  assert.match(card,/readAloud\(sourceExcerpt/);
  assert.match(card,/Extracto original recuperado/);
  assert.match(card,/Conservamos el extracto inicial y el enlace original/);
  assert.match(card,/reading\.append\(external\(url,"↗ Leer documento completo en la fuente"/);
  assert.match(searchCode,/if\(\["all","news","knowledge","research"\]\.includes\(selected\)\)/);
  assert.match(css,/\.wae-reading-recovery-body\[hidden\]/);
  assert.doesNotMatch(card,/Texto completo recuperado/);
});
