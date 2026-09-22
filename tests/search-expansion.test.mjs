import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {wikidata,europePMC,wikimediaVideos,gdeltNews,search} from "../server/search.mjs";

const mock=async(fn,callback)=>{
  const old=globalThis.fetch;
  globalThis.fetch=fn;
  try{return await callback();}finally{globalThis.fetch=old;}
};
test("Wikidata returns attributable entity links and rejects malformed identifiers",async()=>{
  await mock(async url=>{
    const u=new URL(url);
    assert.equal(u.hostname,"www.wikidata.org");
    assert.equal(u.searchParams.get("limit"),"12");
    return new Response(JSON.stringify({search:[
      {id:"Q42",label:"Douglas Adams",description:"British writer"},
      {id:"BAD",label:"not safe"},{id:"Q7",label:""]}
    ]}),{status:200});
  },async()=>{
    const data=await wikidata("Douglas Adams");
    assert.equal(data.length,2);
    assert.equal(data[0].source,"Wikidata");
    assert.equal(data[0].url,"https://www.wikidata.org/wiki/Q42");
    assert.equal(data[1].title,"Q7");
  });
});
test("Europe PMC preserves DOI provenance and real publication metadata",async()=>{
  await mock(async url=>{
    const u=new URL(url);
    assert.equal(u.hostname,"www.ebi.ac.uk");
    assert.equal(u.searchParams.get("pageSize"),"10");
    return new Response(JSON.stringify({resultList:{result:[
      {id:"123",source:"MED",title:"Clinical trial",authorString:"A. Author",
        pubYear:"2025",firstPublicationDate:"2025-05-03"},
      {id:"no-id",doi:"10.1000/abc",title:"Another paper"},
      {id:"not-a-number",title:"Invalid citation"}
    ]}}),{status:200});
  },async()=>{
    const found=await europePMC("clinical trial");
    assert.equal(found.length,2);
    assert.equal(found[0].source,"Europe PMC");
    assert.equal(found[0].date,"2025-05-03");
    assert.match(found[0].url,/europepmc\.org\/article\/MED\/123/);
    assert.match(found[1].url,/doi\.org/);
  });
});
test("Commons videos filter actual video mime; do not relabel image hits",async()=>{
  await mock(async url=>{
    const u=new URL(url);
    assert.equal(u.hostname,"commons.wikimedia.org");
    assert.match(u.searchParams.get("gsrsearch"),/filetype:video/);
    return new Response(JSON.stringify({query:{pages:{
      "1":{title:"File:Lecture.webm",imageinfo:[{mime:"video/webm",descriptionurl:"https://commons.wikimedia.org/wiki/File:Lecture.webm",thumburl:"https://upload.wikimedia.org/thumb.jpg"}]},
      "2":{title:"File:Still.jpg",imageinfo:[{mime:"image/jpeg",descriptionurl:"https://commons.wikimedia.org/wiki/File:Still.jpg"}]}
    }}}),{status:200});
  },async()=>{
    const found=await wikimediaVideos("lecture");
    assert.equal(found.length,1);
    assert.equal(found[0].source,"Wikimedia Commons · Video");
    assert.ok(found[0].url.endsWith(".webm"));
    assert.match(found[0].snippet,/video\/webm/);
  });
});
test("GDELT news uses real article links; unavailable provider does not manufacture results",async()=>{
  await mock(async url=>{
    const u=new URL(url);
    assert.equal(u.hostname,"api.gdeltproject.org");
    assert.equal(u.searchParams.get("timespan"),"1week");
    return new Response(JSON.stringify({articles:[
      {title:"Actual article",url:"https://newspaper.example/story",
        domain:"newspaper.example",language:"Spanish",seendate:"20260922T130000Z"},
      {title:"Unsafe",url:"javascript:alert(1)"}
    ]}),{status:200});
  },async()=>{
    const found=await gdeltNews("technology");
    assert.equal(found.length,1);
    assert.equal(found[0].source,"GDELT · prensa");
  });
  const old=process.env.GOOGLE_SEARCH_API_KEY;
  delete process.env.GOOGLE_SEARCH_API_KEY;
  try{
    await mock(async()=>new Response("Service Unavailable",{status:503}),async()=>{
      const response=await search("noticias ensayo fallo fuentes rc35","news",{fresh:true});
      assert.deepEqual(response.results,[]);
      assert.ok(response.failedSources.includes("GDELT · prensa"));
      assert.match(response.message,/proveedores disponibles/);
    });
  }finally{
    if(old!==undefined)process.env.GOOGLE_SEARCH_API_KEY=old;
  }
});
test("category tabs replace translator instead of leaving it static",async()=>{
  const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  const html=await readFile(new URL("../public/index.html",import.meta.url),"utf8");
  const translator=await readFile(new URL("../public/translator.js",import.meta.url),"utf8");
  assert.match(app,/function showEmptyCategory\(type,push=true\)/);
  assert.match(app,/showEmptyCategory\(type,push\)/);
  assert.match(app,/translator\.hide\(\);sourceFilter\.hidden=false/);
  assert.match(translator,/TRANSLATE_TIMEOUT_MS=12000/);
  assert.match(translator,/const useLocal=engine==="local"/);
  assert.match(translator,/const cancel=button\("■ Detener"/);
  assert.match(translator,/cancel\.hidden=true/);
  assert.doesNotMatch(html,/id="preview-banner"/);
  assert.doesNotMatch(html,/los pagos y las publicaciones reales todavía están desactivados/);
  assert.match(html,/Acceso empresarial en preparación/);
});
