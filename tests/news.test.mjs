import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {parseNewsFeed,normalizeNewsDate,rankNewsResults,newsFeedSources} from "../server/news.mjs";
import {search} from "../server/search.mjs";
const now=Date.now();
const stamp=offset=>new Date(now-offset).toUTCString();
const feed=(items)=>'<?xml version="1.0"?><rss version="2.0"><channel>'+items.map(item=>
  "<item><title><![CDATA["+item.title+"]]></title><link>"+item.url+
  "</link><pubDate>"+item.date+"</pubDate><description><![CDATA["+
  (item.description||"Inteligencia artificial en México")+"]]></description>"+
  (item.source?"<source>"+item.source+"</source>":"")+"</item>"
).join("")+"</channel></rss>";
test("RSS parser requires source-backed HTTPS links and real dates within window",()=>{
  const xml=feed([
    {title:"IA &amp; tecnología",url:"https://news.google.com/rss/articles/real",date:stamp(50000),
      description:"<b>Inteligencia</b> artificial",source:"Medio Ejemplo"},
    {title:"Old news",url:"https://news.example.org/old",date:stamp(40*86400000)},
    {title:"Unsafe",url:"javascript:alert(1)",date:stamp(50000)},
    {title:"No date",url:"https://news.example.org/no-date",date:""}
  ]);
  const actual=parseNewsFeed(xml,{source:"Google News",window:"24h",now});
  assert.equal(actual.length,1);
  assert.equal(actual[0].publisher,"Medio Ejemplo");
  assert.equal(actual[0].title,"IA & tecnología");
  assert.equal(actual[0].snippet,"Inteligencia artificial");
  assert.equal(actual[0].newsDateKind,"published");
  assert.equal(actual[0].source,"Google News · Medio Ejemplo");
});
test("news records do not invent publication dates from GDELT discovery",()=>{
  assert.equal(normalizeNewsDate("not a date"),null);
  const rows=[
    {title:"La misma noticia",url:"https://example.org/a",date:new Date(now-10000).toISOString()},
    {title:"La misma noticia",url:"https://example.org/b",date:new Date(now-20000).toISOString()},
    {title:"La anterior",url:"https://example.org/old",date:new Date(now-9*86400000).toISOString()},
    {title:"Sin hora publicada",url:"https://example.org/c",seenAt:new Date(now-30000).toISOString()}
  ];
  const actual=rankNewsResults(rows,"noticia","24h",now);
  assert.deepEqual(actual.map(x=>x.title),["La misma noticia","Sin hora publicada"]);
  assert.equal(actual[1].date,undefined);
});
test("federated newsroom combines RSS and GDELT without needing paid API keys",async()=>{
  const original=globalThis.fetch;
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_SEARCH_ENGINE_ID"];
  const saved=keys.map(key=>process.env[key]);keys.forEach(key=>delete process.env[key]);
  const seen=[];
  const pub=stamp(15*60000);
  globalThis.fetch=async input=>{
    const u=new URL(input);seen.push(u.hostname);
    if(u.hostname==="api.gdeltproject.org"){
      assert.equal(u.searchParams.get("sort"),"datedesc");
      assert.equal(u.searchParams.get("timespan"),"1d");
      const seenAt=new Date(now-10*60000).toISOString().replace(/[-:]/g,"").replace(".000","").replace(/\.\d{3}/,"");
      return new Response(JSON.stringify({articles:[{
        title:"La IA en México según prensa",
        url:"https://press.example.org/actual",
        seendate:seenAt,domain:"press.example.org",language:"Spanish"
      }]}),{status:200});
    }
    const google=u.hostname==="news.google.com";
    if(google){
      assert.equal(u.searchParams.get("q").includes("when:1d"),true);
      return new Response(feed([{title:"Inteligencia artificial en México",
        url:"https://news.google.com/rss/articles/report-a",date:pub,
        source:"Agencia de ejemplo"}]),{status:200});
    }
    if(u.hostname==="www.bbc.com")return new Response(feed([{
      title:"Inteligencia artificial: avances en México",
      url:"https://www.bbc.com/mundo/articles/actual",date:pub
    }]),{status:200});
    if(u.hostname==="feeds.elpais.com")return new Response(feed([{
      title:"México e inteligencia artificial",
      url:"https://elpais.com/tecnologia/actual",date:pub
    }]),{status:200});
    throw new Error("Unexpected news URL "+u);
  };
  try{
    const data=await search("inteligencia artificial","news",{newsWindow:"24h",fresh:true});
    assert.equal(data.newsWindow,"24h");
    assert.equal(data.newsCoverage.liveGuarantee,false);
    assert.equal(data.newsCoverage.respondingSources.length,5);
    assert.equal(data.results.length,4,"Google edition duplication removed");
    assert.ok(data.results.some(item=>item.source.startsWith("Google News · ")));
    assert.ok(data.results.some(item=>item.source==="BBC Mundo · RSS"));
    assert.ok(data.results.some(item=>item.source==="El País · RSS"));
    const gdelt=data.results.find(item=>item.source==="GDELT · prensa");
    assert.equal(gdelt.date,null);
    assert.equal(gdelt.newsDateKind,"detected");
    assert.ok(seen.includes("api.gdeltproject.org"));
    assert.equal(data.message,null);
  }finally{
    globalThis.fetch=original;
    keys.forEach((key,i)=>saved[i]===undefined?delete process.env[key]:process.env[key]=saved[i]);
  }
});
test("news feed endpoints are fixed providers; no arbitrary client URL is fetched",()=>{
  const sources=newsFeedSources("prueba","24h");
  assert.deepEqual(sources.map(([name])=>name),[
    "Google News · México","Google News · Internacional",
    "BBC Mundo · RSS","El País · RSS"
  ]);
});
test("news UI has date windows, refresh and native article browsing",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
  assert.match(app,/Noticias al momento/);
  assert.match(app,/↻ Actualizar noticias/);
  assert.match(app,/&window=/);
  assert.match(app,/&fresh=1/);
  assert.match(app,/Publicado · /);
  assert.match(app,/Detectado · /);
  assert.match(app,/document\.visibilityState!=="visible"/);
  assert.match(css,/\.news-live-header/);
});
