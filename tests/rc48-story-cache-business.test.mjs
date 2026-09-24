import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {indexLinkedPage,localWebSearch} from "../server/web-index.mjs";
import {quickOpenWeb,search} from "../server/search.mjs";
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
const story={
  objectID:"989810101",title:"Aerostática semántica: artículo comunitario",
  url:"https://source.example.org/aerostatica-semantica",
  created_at:"2026-09-24T00:00:00Z"
};
test("general web never leaks historical Hacker News local-index aliases",async()=>{
  const oldFetch=globalThis.fetch;
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const prior=keys.map(k=>process.env[k]);
  for(const k of keys)delete process.env[k];
  const url=indexLinkedPage(story)?.url;
  assert.equal(url,story.url);
  assert.equal(localWebSearch("aerostática semántica")[0].source,"WAE Index local · HN");
  let hnCalls=0;
  globalThis.fetch=async input=>{
    const u=new URL(input);
    if(u.hostname==="hn.algolia.com"){hnCalls++;throw Error("Unexpected HN request");}
    if(u.hostname==="es.wikipedia.org")
      return new Response(JSON.stringify({query:{search:[]}}),{status:200});
    if(u.hostname==="www.wikidata.org")
      return new Response(JSON.stringify({search:[]}),{status:200});
    return new Response("Unavailable",{status:503});
  };
  try{
    const early=await quickOpenWeb("aerostática semántica");
    assert.deepEqual(early.results,[]);
    assert.equal(early.sourceStatus,"not_applicable");
    const full=await search("aerostática semántica","all",{fresh:true});
    assert.ok(!full.results.some(x=>x.url===story.url));
    assert.ok(!full.sources.includes("WAE Index local"));
    assert.equal(full.webDiscovery.provider,"not_queried");
    assert.equal(hnCalls,0);
  }finally{
    globalThis.fetch=oldFetch;
    keys.forEach((k,i)=>prior[i]===undefined?delete process.env[k]:process.env[k]=prior[i]);
  }
});
test("business results link directly to iframe-restricted domains and retain one optional origin",()=>{
  assert.match(app,/const restricted=siteVisitMode\(url,window\.waeDesktop\?\.isNative===true\)==="original"/);
  assert.match(app,/if\(restricted\)card\.append\(external\(url,"↗ Visitar sitio web","link-button"\)\)/);
  assert.match(app,/const more=element\("details","business-website-more"\)/);
  assert.match(app,/card\.append\(button\("◎ Abrir sitio",\(\)=>openBrowser\(url\),"link-button"\)\)/);
  assert.match(css,/\.business-website-more>summary\{list-style:none/);
});
