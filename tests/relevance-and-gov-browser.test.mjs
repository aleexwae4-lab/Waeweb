import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {flickrPublicImages,flickrTags} from "../server/flickr-images.mjs";
import {rankImageResults,imageRelevant} from "../server/image-intelligence.mjs";
import {browserPresentation,siteVisitMode} from "../public/browser-core.js";
import {search} from "../server/search.mjs";

test("Flickr matches ALL meaningful metadata terms instead of unrelated any-tag photos",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async input=>{
    const url=new URL(input);
    assert.equal(url.hostname,"www.flickr.com");
    assert.equal(url.searchParams.get("tagmode"),"all");
    assert.equal(url.searchParams.get("tags"),"inteligencia,artificial");
    return new Response(JSON.stringify({items:[
      {title:"You first - No you first",tags:"artificial photo",
        link:"https://www.flickr.com/photos/author/111111/",
        media:{m:"https://live.staticflickr.com/1/noise_m.jpg"}},
      {title:"Inteligencia artificial en laboratorio",tags:"inteligencia artificial",
        link:"https://www.flickr.com/photos/author/222222/",
        media:{m:"https://live.staticflickr.com/1/ai_m.jpg"}}
    ]}),{status:200});
  };
  try{
    assert.deepEqual(flickrTags("gato fotografía"),["gato"]);
    const matches=await flickrPublicImages("inteligencia artificial");
    assert.equal(matches.length,1);
    assert.equal(matches[0].title,"Inteligencia artificial en laboratorio");
  }finally{globalThis.fetch=old;}
});

test("image results require metadata relevance and limit one landing page without collapsing distinct images",()=>{
  assert.equal(imageRelevant({title:"You first",snippet:"Autoría indicada"},"inteligencia artificial"),false);
  assert.equal(imageRelevant({title:"Robot",snippet:"Inteligencia artificial"},"inteligencia artificial"),true);
  const base={url:"https://album.example.org/ai",snippet:"Inteligencia artificial",source:"Flickr · fotos públicas"};
  const items=[
    {...base,title:"You first",image:"https://cdn.example.org/bad.jpg",snippet:"Foto cotidiana"},
    ...Array.from({length:6},(_,i)=>({...base,title:"Inteligencia artificial imagen "+i,
      image:"https://cdn.example.org/ai-"+i+".jpg"}))
  ];
  const ranked=rankImageResults(items,"inteligencia artificial");
  assert.equal(ranked.results.length,4);
  assert.equal(ranked.lowRelevanceRemoved,1);
  assert.equal(ranked.duplicatesRemoved,0);
});

test("government portal and its subdomains avoid blank embedded frames on hosted web",()=>{
  for(const url of ["https://www.gob.mx/","https://www.gob.mx/tramites",
    "https://salud.gob.mx/","https://www.gob.mx.evil.test/"]){
    const expected=!url.includes("evil");
    assert.equal(browserPresentation(url).externalFirst,expected,url);
    assert.equal(siteVisitMode(url,false),expected?"original":"integrated");
  }
  assert.equal(siteVisitMode("https://www.gob.mx/",true),"integrated");
});

test("broad public search shows encyclopedia without unrelated HN stories when indexes are absent",async()=>{
  const prior=globalThis.fetch;
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const saved=keys.map(k=>process.env[k]);keys.forEach(k=>delete process.env[k]);
  globalThis.fetch=async input=>{
    const u=new URL(input);
    if(u.hostname==="es.wikipedia.org")return new Response(JSON.stringify({query:{search:[
      {title:"Inteligencia artificial",pageid:99,snippet:"Tecnología de aprendizaje"}
    ]}}),{status:200});
    if(u.hostname==="hn.algolia.com")return new Response(JSON.stringify({hits:[
      {objectID:"982377",title:"Old article about artificial intelligence",
        url:"https://publisher.example.org/ai",created_at:"2019-03-01T00:00:00Z"}
    ]}),{status:200});
    if(u.hostname==="www.wikidata.org")return new Response(JSON.stringify({search:[]}),{status:200});
    throw Error("Catalog unavailable: "+u.hostname);
  };
  try{
    const result=await search("inteligencia artificial","all",{fresh:true});
    const wiki=result.results.findIndex(x=>x.source==="Wikipedia");
    const hn=result.results.findIndex(x=>x.source==="Hacker News · web abierta");
    assert.ok(wiki>=0,"real encyclopedia context remains available");
    assert.equal(hn,-1,"unrelated old community stories must not impersonate general web results");
    assert.equal(result.webCoverage,"limited");
    assert.equal(result.searchCoverage.generalIndexes.length,0);
  }finally{
    globalThis.fetch=prior;
    keys.forEach((k,i)=>saved[i]===undefined?delete process.env[k]:process.env[k]=saved[i]);
  }
});

test("image filters and web snippets reduce clutter without suppressing source controls",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
  assert.match(app,/wae-image-advanced/);
  assert.match(app,/advanced\.append\(sourceDetail\)/);
  assert.match(css,/RC46 · Relevant images lead/);
  assert.match(app,/Enlace publicado por la comunidad de Hacker News; contenido del sitio original no verificado por WAEWEB/);
  assert.match(app,/if\(webReadingSlot\)card\.append\(webReadingSlot\)/);
  assert.match(app,/if\(!directSite\)meta\.append\(external\(url,"↗ Origen"/);
});
