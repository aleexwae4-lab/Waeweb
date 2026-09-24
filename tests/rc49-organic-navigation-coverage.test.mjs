import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {siteVisitMode} from "../public/browser-core.js";
import {search} from "../server/search.mjs";
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const withBrave=async (results,fn)=>{
  const prior=globalThis.fetch;
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const saved=keys.map(key=>process.env[key]);
  keys.forEach(key=>delete process.env[key]);
  process.env.BRAVE_SEARCH_API_KEY="fixture-only";
  globalThis.fetch=async input=>{
    const url=new URL(input);
    if(url.hostname==="api.search.brave.com")
      return new Response(JSON.stringify({web:{results}}),{status:200});
    if(url.hostname==="es.wikipedia.org")
      return new Response(JSON.stringify({query:{search:[]}}),{status:200});
    if(url.hostname==="www.wikidata.org")
      return new Response(JSON.stringify({search:[]}),{status:200});
    return new Response("unavailable",{status:503});
  };
  try{await fn();}
  finally{
    globalThis.fetch=prior;
    keys.forEach((key,i)=>saved[i]===undefined?delete process.env[key]:process.env[key]=saved[i]);
  }
};
test("a responsive but empty general index never claims web-result coverage",async()=>{
  await withBrave([],async()=>{
    const page=await search("orbital vacuum gearbox","all",{fresh:true});
    assert.equal(page.searchCoverage.generalIndexDiagnosis.state,"empty");
    assert.deepEqual(page.searchCoverage.respondingGeneralIndexes,["Brave"]);
    assert.deepEqual(page.searchCoverage.generalIndexes,[]);
    assert.equal(page.webCoverage,"limited");
    assert.deepEqual(page.results,[]);
  });
});
test("a returned organic page remains separately verifiable as general-index coverage",async()=>{
  await withBrave([{title:"Orbital vacuum gearbox research",
    url:"https://example.org/orbital-vacuum-gearbox",
    description:"Real publisher page"}],async()=>{
    const page=await search("orbital vacuum gearbox","all",{fresh:true});
    assert.equal(page.searchCoverage.generalIndexDiagnosis.state,"results");
    assert.deepEqual(page.searchCoverage.generalIndexes,["Brave"]);
    assert.deepEqual(page.searchCoverage.respondingGeneralIndexes,["Brave"]);
    assert.equal(page.webCoverage,"general-index");
    assert.equal(page.results[0].url,"https://example.org/orbital-vacuum-gearbox");
  });
});
test("organic restricted websites bypass a known dead iframe, retaining the reader",()=>{
  assert.equal(siteVisitMode("https://github.com/owner/repo",false),"original");
  assert.equal(siteVisitMode("https://www.gob.mx/tramites",false),"original");
  assert.equal(siteVisitMode("https://www.instagram.com/explore/",false),"original");
  assert.equal(siteVisitMode("https://github.com/owner/repo",true),"integrated");
  assert.equal(siteVisitMode("https://example.org/article",false),"integrated");
  assert.match(app,/const directSite=state\.type==="all"&&\s*siteVisitMode\(url,window\.waeDesktop\?\.isNative===true\)==="original"/);
  assert.match(app,/directSite\s*\? external\(url,item\.title,"result-title web-result-title wae-external-site-title"\)/);
  assert.match(app,/const reader=createWebSourceReader\(item,url\)/);
  assert.match(app,/if\(!directSite\)meta\.append\(external\(url,"↗ Origen","save-button"\)\)/);
  assert.match(app,/const respondingIndexes=coverage\?\.respondingGeneralIndexes\|\|indexes/);
});
