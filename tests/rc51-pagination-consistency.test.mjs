import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {mergeWebPageResponse} from "../public/web-page-merge.js";
import {handler} from "../server/index.mjs";
const row=(name,state,results=0)=>({name,state,results});
const coverage=(providers,extra={})=>({
  generalIndexes:providers.filter(p=>p.state==="results").map(p=>p.name),
  respondingGeneralIndexes:providers.filter(p=>["results","empty"].includes(p.state)).map(p=>p.name),
  specialistSources:extra.specialistSources||[],
  navigationalSites:extra.navigationalSites||0,
  webPages:extra.webPages||0,
  encyclopediaPages:extra.encyclopediaPages||0,
  generalIndexDiagnosis:{state:providers.some(p=>p.results)?"results":"empty",
    providers,totalHits:providers.reduce((sum,p)=>sum+p.results,0)}
});
test("pagination recomputes unique result kinds and accumulates observed source coverage",()=>{
  const site={title:"GitHub",siteLink:true,url:"https://github.com/",source:"WAE WEB · directorio navegacional"};
  const wiki={title:"Python",url:"https://es.wikipedia.org/wiki/Python",source:"Wikipedia"};
  const organic={title:"Python docs",url:"https://docs.example.org/guide",source:"Brave Search"};
  const later={title:"Python tutorial",url:"https://tutorial.example.org/guide",source:"Google Programmable Search"};
  const prior={page:1,results:[site,wiki,organic],sources:["Brave","Wikipedia"],
    failedSources:[],hasMore:true,webCoverage:"general-index",
    searchCoverage:coverage([row("Brave","results",1),row("Google","unconfigured"),
      row("SearXNG","unconfigured")],{navigationalSites:1,webPages:1,encyclopediaPages:1})};
  const next={page:2,results:[organic,later],sources:["Google"],
    failedSources:["SearXNG"],hasMore:true,webCoverage:"general-index",
    searchCoverage:coverage([row("Brave","empty"),row("Google","results",2),
      row("SearXNG","unavailable")])};
  const merged=mergeWebPageResponse(prior,next,[later]);
  assert.deepEqual(merged.results,[site,wiki,organic,later]);
  assert.deepEqual(merged.sources,["Brave","Wikipedia","Google"]);
  assert.deepEqual(merged.failedSources,["SearXNG"]);
  assert.equal(merged.searchCoverage.navigationalSites,1);
  assert.equal(merged.searchCoverage.webPages,2);
  assert.equal(merged.searchCoverage.encyclopediaPages,1);
  assert.deepEqual(merged.searchCoverage.generalIndexes,["Brave","Google"]);
  assert.deepEqual(merged.searchCoverage.respondingGeneralIndexes,["Brave","Google"]);
  assert.equal(merged.searchCoverage.generalIndexDiagnosis.totalHits,3);
  assert.equal(merged.hasMore,true);
  assert.equal(merged.webCoverage,"general-index");
});
test("duplicate-only pages do not prematurely exhaust index or erase specialist coverage",()=>{
  const original={url:"https://docs.example.org/a",title:"Doc",source:"MDN Web Docs"};
  const old={page:1,results:[original],sources:["MDN Web Docs"],
    hasMore:true,webCoverage:"specialized",
    searchCoverage:coverage([row("Brave","empty"),
      row("Google","unconfigured"),row("SearXNG","unconfigured")],
      {specialistSources:["MDN Web Docs"],webPages:1})};
  const second={page:2,results:[original],hasMore:true,webCoverage:"limited",
    searchCoverage:coverage([row("Brave","empty"),
      row("Google","unconfigured"),row("SearXNG","unconfigured")])};
  const merged=mergeWebPageResponse(old,second,[]);
  assert.equal(merged.results.length,1);
  assert.equal(merged.hasMore,true);
  assert.equal(merged.webCoverage,"specialized");
  assert.equal(merged.searchCoverage.webPages,1);
  assert.deepEqual(merged.searchCoverage.specialistSources,["MDN Web Docs"]);
  const last=mergeWebPageResponse(merged,{...second,page:5,hasMore:true},[]);
  assert.equal(last.hasMore,false,"API permits at most five pages");
});
test("page-merger is actually loaded by the web UI and served as first-party JS",async()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/import \{mergeWebPageResponse\} from "\/web-page-merge\.js"/);
  assert.match(app,/state\.data=mergeWebPageResponse\(prior,extra,unique\)/);
  const server=http.createServer(handler);
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const res=await fetch("http://127.0.0.1:"+server.address().port+"/web-page-merge.js");
    assert.equal(res.status,200);
    assert.match(res.headers.get("content-type"),/javascript/);
    assert.match(await res.text(),/export function mergeWebPageResponse/);
  }finally{if(server.listening)await new Promise(resolve=>server.close(resolve));}
});
