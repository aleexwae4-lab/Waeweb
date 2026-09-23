import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {pinterestPinUrl,pinterestQuery,pinterestVisualIntent,
  verifiedPinterestImages,labelPinterestImages} from "../server/pinterest-discovery.mjs";
import {parseQuery} from "../server/intelligence.mjs";
import {search} from "../server/search.mjs";

const KEYS=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_SEARCH_ENGINE_ID"];
async function withKeys(values,fn){
  const saved=KEYS.map(k=>process.env[k]),prior=globalThis.fetch;
  KEYS.forEach((k,i)=>values[i]===null?delete process.env[k]:process.env[k]=values[i]);
  try{await fn();}
  finally{
    globalThis.fetch=prior;
    KEYS.forEach((k,i)=>saved[i]===undefined?delete process.env[k]:process.env[k]=saved[i]);
  }
}
test("only actual HTTPS numeric pin links can claim Pinterest attribution",()=>{
  assert.equal(pinterestPinUrl("https://www.pinterest.com/pin/1234567890/?utm_source=x#ref"),
    "https://www.pinterest.com/pin/1234567890/");
  assert.equal(pinterestPinUrl("https://mx.pinterest.com/pin/1234567890"),
    "https://www.pinterest.com/pin/1234567890/");
  for(const bad of ["https://pinterest.com.evil.org/pin/1234567890/",
    "https://www.pinterest.com/search/pins/?q=bolsas",
    "https://www.pinterest.com/pin/not-real/",
    "https://www.pinterest.com/pin/1234567890/other",
    "http://www.pinterest.com/pin/1234567890/",
    "https://pinterest.com@evil.example.org/pin/1234567890/",
    "javascript:alert(1)"])
    assert.equal(pinterestPinUrl(bad),null,bad);
  assert.equal(pinterestQuery("bolsas"),"bolsas site:pinterest.com/pin/");
  assert.equal(pinterestVisualIntent("bolsas dama"),true);
  assert.equal(pinterestVisualIntent("noticias politica", "general"),false);
  assert.equal(parseQuery("bolsas source:pinterest").source,"pinterest");
  assert.equal(parseQuery("bolsas source:pinterest").query,"bolsas");
});
test("only indexed genuine pins with a provided image survive and keep provenance",()=>{
  const items=verifiedPinterestImages([
    {title:"Bolsa real",url:"https://mx.pinterest.com/pin/123456789012/",
      image:"https://i.pinimg.com/236x/a.jpg",source:"Brave Search",license:"not verified"},
    {title:"Sin imagen",url:"https://pinterest.com/pin/1111111111/"},
    {title:"Mira Pinterest",url:"https://evil.pinterest.com.fake.org/pin/1111111111/",
      image:"https://image.example.org/fake.jpg"}
  ],"Brave");
  assert.equal(items.length,1);
  assert.equal(items[0].source,"Pinterest · vía Brave");
  assert.equal(items[0].url,"https://www.pinterest.com/pin/123456789012/");
  assert.equal(items[0].pinId,"123456789012");
  assert.equal(items[0].license,null);
  assert.equal(verifiedPinterestImages(null,"Brave"),null);
  const organic=labelPinterestImages([{...items[0],
    source:"Google Programmable Search"},{title:"No pin",
    url:"https://www.pinterest.com/search/pins/?q=x",
    image:"https://image.example.org/thumb.jpg",source:"Brave Search"}]);
  assert.equal(organic[0].source,"Pinterest · vía Google");
  assert.equal(organic[1].source,"Brave Search");
});
test("explicit Pinterest image search consumes only configured indexes, filters impostors and deduplicates same pin",async()=>{
  await withKeys(["token","key","engine"],async()=>{
    const requests=[];
    globalThis.fetch=async (input,opts)=>{
      const u=new URL(input),q=u.searchParams.get("q");requests.push(u.hostname);
      assert.equal(q,"bolsas source-test-fixture site:pinterest.com/pin/");
      if(u.hostname==="api.search.brave.com"){
        assert.equal(opts.headers["x-subscription-token"],"token");
        return new Response(JSON.stringify({results:[
          {title:"Bolsa artesanal elegante",url:"https://mx.pinterest.com/pin/123456789012/",
            thumbnail:{src:"https://i.pinimg.com/236x/bolsa.jpg"}},
          {title:"Sitio falso",url:"https://pinterest.com.evil.example.org/pin/123456789012/",
            thumbnail:{src:"https://evil.example.org/bolsa.jpg"}}
        ]}),{status:200});
      }
      assert.equal(u.hostname,"www.googleapis.com");
      assert.equal(u.searchParams.get("searchType"),"image");
      return new Response(JSON.stringify({items:[
        {title:"Bolsa artesanal elegante",link:"https://i.pinimg.com/originals/bolsa.jpg",
          image:{contextLink:"https://www.pinterest.com/pin/123456789012/",
            thumbnailLink:"https://i.pinimg.com/474x/bolsa.jpg"}},
        {title:"No es un pin",link:"https://images.example.org/fake.jpg",
          image:{contextLink:"https://www.pinterest.com/search/pins/",
            thumbnailLink:"https://images.example.org/fake-small.jpg"}}
      ]}),{status:200});
    };
    const result=await search("bolsas source-test-fixture source:pinterest","images",{fresh:true});
    assert.equal(result.results.length,1);
    assert.equal(result.results[0].source.startsWith("Pinterest · vía "),true);
    assert.equal(result.results[0].url,"https://www.pinterest.com/pin/123456789012/");
    assert.equal(result.imageDiscovery.pinterest.hits,1);
    assert.equal(result.imageDiscovery.pinterest.officialApi,false);
    assert.equal(result.imageDiscovery.pinterest.mode,"indexed_public_pins");
    assert.equal(result.imageDiscovery.duplicatesRemoved,1);
    assert.deepEqual(new Set(requests),new Set(["api.search.brave.com","www.googleapis.com"]));
    assert.equal(result.mediaCoverage.webIndex,false,"targeted index is identified separately");
  });
});
test("without general search credentials Pinterest returns no manufactured previews",async()=>{
  await withKeys([null,null,null],async()=>{
    globalThis.fetch=()=>{throw Error("No upstream request allowed");};
    const result=await search("bolsas source:pinterest","images",{fresh:true});
    assert.deepEqual(result.results,[]);
    assert.equal(result.imageDiscovery.pinterest.hits,0);
    assert.equal(result.imageDiscovery.pinterest.notGuaranteed,true);
    assert.ok(result.sources.every(x=>x.endsWith(" no configurado")));
  });
});
test("Pinterest images already returned in ordinary queries join the normal image gallery",async()=>{
  await withKeys(["token",null,null],async()=>{
    globalThis.fetch=async input=>{
      const u=new URL(input);
      if(u.hostname==="api.search.brave.com"){
        const special=(u.searchParams.get("q")||"").includes("site:pinterest.com/pin/");
        return new Response(JSON.stringify({results:special?[]:[
          {title:"Bolsa de moda",url:"https://www.pinterest.com/pin/123456789099/",
            thumbnail:{src:"https://i.pinimg.com/236x/moda.jpg"}},
          {title:"Bolsa catálogo",url:"https://shop.example.org/bolsa",
            thumbnail:{src:"https://shop.example.org/bolsa.jpg"}}
        ]}),{status:200});
      }
      throw Error("Offline "+u.hostname);
    };
    const result=await search("bolsas para dama pinterest-fixture","images",{fresh:true});
    assert.equal(result.results.filter(x=>x.imagePlatform==="Pinterest").length,1);
    assert.equal(result.results.find(x=>x.imagePlatform==="Pinterest").source,"Pinterest · vía Brave");
    assert.ok(result.results.some(x=>x.source==="Brave Search"));
    assert.equal(result.imageDiscovery.pinterest.hits,1);
    assert.ok(result.failedSources.includes("Openverse"));
  });
});
test("Pinterest image UI has a real pin facet and original destination, not a fake content feed",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/state\.imagePlatform==="all"\|\|item\.imagePlatform===state\.imagePlatform/);
  assert.match(app,/https:\/\/www\.pinterest\.com\/search\/pins\/\?q=/);
  assert.match(app,/↗ Buscar también en Pinterest/);
  assert.match(app,/Los pines aparecen aquí cuando un índice web conectado devuelve imágenes reales/);
});
