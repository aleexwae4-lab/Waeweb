import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {search} from "../server/search.mjs";
import {searxngImages} from "../server/web-providers.mjs";

const VARS=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
async function environment(values,run){
  const saved=VARS.map(k=>process.env[k]),original=globalThis.fetch;
  VARS.forEach((k,i)=>values[i]===null?delete process.env[k]:process.env[k]=values[i]);
  try{await run();}
  finally{globalThis.fetch=original;VARS.forEach((k,i)=>
    saved[i]===undefined?delete process.env[k]:process.env[k]=saved[i]);}
}
test("ordinary non-fashion image queries also recover actual pins in the same result array",async()=>{
  await environment(["mock-token",null,null,null],async()=>{
    const queries=[];
    globalThis.fetch=async input=>{
      const u=new URL(input);
      if(u.hostname!=="api.search.brave.com")throw Error("other provider unavailable");
      const q=u.searchParams.get("q");queries.push(q);
      const target=q.includes("site:pinterest.com/pin/");
      return new Response(JSON.stringify({results:target?[
        {title:"Anatomía vascular diagrama ilustrado",url:"https://mx.pinterest.com/pin/123456789012/",
          thumbnail:{src:"https://imgs.example.org/vascular-pin.jpg"},
          properties:{url:"https://imgs.example.org/vascular-original.jpg",width:1800,height:1300}}
      ]:[
        {title:"Anatomía vascular atlas",url:"https://atlas.example.org/vascular",
          thumbnail:{src:"https://imgs.example.org/vascular-atlas.jpg"},
          properties:{width:1400,height:1100}}
      ]}),{status:200});
    };
    const response=await search("anatomía vascular atlas","images",{fresh:true});
    assert.deepEqual(queries,["anatomía vascular atlas",
      "anatomía vascular atlas site:pinterest.com/pin/"]);
    assert.equal(response.type,"images");
    assert.equal(response.mediaCollection,"web");
    assert.equal(response.imageDiscovery.pinterest.hits,1);
    assert.equal(response.results.length,2);
    assert.ok(response.results.some(x=>x.source==="Pinterest · vía Brave"&&
      x.url==="https://www.pinterest.com/pin/123456789012/"));
    assert.ok(response.results.some(x=>x.source==="Brave Search"));
    assert.equal(response.results.find(x=>x.imagePlatform==="Pinterest").image,
      "https://imgs.example.org/vascular-pin.jpg");
  });
});
test("SearXNG image API contributes ordinary images and a dedicated verified Pinterest pin",async()=>{
  await environment([null,null,null,"https://search.example.org/"],async()=>{
    const queries=[];
    globalThis.fetch=async input=>{
      const u=new URL(input);
      if(u.hostname!=="search.example.org")throw Error("Other source unavailable");
      assert.equal(u.pathname,"/search");
      assert.equal(u.searchParams.get("categories"),"images");
      assert.equal(u.searchParams.get("format"),"json");
      const q=u.searchParams.get("q");
      queries.push(q);
      const pin=q.includes("site:pinterest.com/pin/");
      return new Response(JSON.stringify({results:pin?[
        {title:"Arquitectura moderna México",url:"https://www.pinterest.com/pin/987654321098/",
          img_src:"https://i.pinimg.com/originals/arch.jpg",
          thumbnail_src:"https://i.pinimg.com/236x/arch.jpg",
          resolution:"1440 x 1080",engine:"bing images"}
      ]:[
        {title:"Arquitectura mexicana",url:"https://architecture.example.org/article",
          img_src:"https://media.example.org/architecture.jpg",
          thumbnail_src:"https://media.example.org/architecture-small.jpg",
          resolution:"1200 x 800",engine:"duckduckgo images"}
      ]}),{status:200});
    };
    const ordinary=await search("arquitectura contemporánea méxico","images",{fresh:true});
    assert.deepEqual(queries,["arquitectura contemporánea méxico",
      "arquitectura contemporánea méxico site:pinterest.com/pin/"]);
    assert.equal(ordinary.results.length,2);
    assert.equal(ordinary.imageDiscovery.pinterest.hits,1);
    assert.equal(ordinary.results.find(x=>x.imagePlatform==="Pinterest").source,
      "Pinterest · vía SearXNG");
    assert.equal(ordinary.results.find(x=>x.source==="SearXNG · imágenes").width,1200);
    assert.equal(ordinary.mediaCoverage.webIndex,true);
    assert.ok(ordinary.sources.includes("SearXNG · imágenes"));
    const parsed=await searxngImages("arquitectura contemporánea méxico");
    assert.equal(parsed[0].fullImage,"https://media.example.org/architecture.jpg");
    assert.equal(parsed[0].image,"https://media.example.org/architecture-small.jpg");
  });
});
test("when all image indexes are unavailable, the normal gallery never invents Pinterest images",async()=>{
  await environment([null,null,null,null],async()=>{
    globalThis.fetch=async input=>{throw Error("Open catalogs unavailable: "+input);};
    const response=await search("arquitectura sin servicios prueba","images",{fresh:true});
    assert.equal(response.imageDiscovery.pinterest.hits,0);
    assert.deepEqual(response.results,[]);
    assert.ok(!response.sources.some(source=>source.endsWith(" no configurado")));
    assert.ok(response.imageDiscovery.pinterest.unconfigured.includes("Pinterest · SearXNG"));
    assert.ok(response.failedSources.includes("Openverse"));
  });
});
test("images gallery displays recovered pins as normal tiles, never requires source filter or outbound search",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const searchCode=readFileSync(new URL("../server/search.mjs",import.meta.url),"utf8");
  assert.match(searchCode,/A regular image query always includes Pinterest discovery/);
  assert.match(searchCode,/Pinterest · SearXNG/);
  assert.match(app,/const grid = renderImages\(shown\)/);
  assert.match(app,/sourceResults\.filter\(item=>item\.imagePlatform==="Pinterest"\)/);
  assert.match(app,/if\(pinterestCount\)/);
  assert.match(app,/image-gallery-source/);
  assert.doesNotMatch(app,/↗ Buscar también en Pinterest/);
});
