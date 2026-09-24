import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {navigationalName,directorySites,earlyWikidataSiteEligible}
  from "../server/site-discovery.mjs";
import {search} from "../server/search.mjs";
import {handler} from "../server/index.mjs";

test("short informational subjects are never mistaken for named websites",()=>{
  for(const q of ["inteligencia artificial","cambio climático",
    "clima en Guadalajara","información financiera","derecho laboral",
    "recetas de cocina","cómo funciona GitHub","tutorial React hooks"]){
    assert.equal(navigationalName(q),null,q);
    assert.deepEqual(directorySites(q),[],q);
    assert.equal(earlyWikidataSiteEligible(q),false,q);
  }
});
test("known multiword brands and exact institution names still navigate",()=>{
  for(const [q,host] of [
    ["Mercado Libre","mercadolibre.com.mx"],
    ["Mercado Libre México","mercadolibre.com.mx"],
    ["Google Maps","google.com"],
    ["Stack Overflow","stackoverflow.com"],
    ["Universidad de Guadalajara","udg.mx"],
    ["GitHub Docs","docs.github.com"]
  ]){
    const sites=directorySites(q);
    assert.equal(sites.length,1,q);
    assert.equal(new URL(sites[0].url).hostname.replace(/^www\./,""),host);
  }
  assert.equal(earlyWikidataSiteEligible("Duolingo"),true);
});
test("natural al navigation routes to the exact official destination",()=>{
  for(const q of [
    "llévame al sitio oficial de GitHub",
    "dirígeme al sitio de GitHub",
    "quiero ir al sitio web de GitHub",
    "accede al sitio oficial de GitHub",
    "navega al sitio oficial de GitHub",
    "entrar al sitio de GitHub",
    "ir al sitio oficial de GitHub"
  ]){
    assert.equal(navigationalName(q),"github",q);
    assert.equal(directorySites(q)[0]?.url,"https://github.com/",q);
  }
});
test("unknown multiword entities require explicit navigation to request Wikidata P856",()=>{
  assert.equal(navigationalName("Fundación Espectral Digital"),
    "fundacion espectral digital");
  assert.equal(navigationalName("visitar el sitio oficial de Empresa Espectral"),
    "empresa espectral");
  assert.equal(navigationalName("Empresa Espectral"),null);
  assert.equal(earlyWikidataSiteEligible(
    "visitar el sitio oficial de Empresa Espectral"),true);
  assert.equal(earlyWikidataSiteEligible("Empresa Espectral"),false);
});
test("full topical web SERP does not trigger extra official-website entity lookups",async()=>{
  const before=globalThis.fetch,seen=[];
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const saved=keys.map(k=>process.env[k]);
  keys.forEach(k=>delete process.env[k]);
  globalThis.fetch=async input=>{
    const u=new URL(input);seen.push(u);
    return new Response("optional source unavailable",{status:503});
  };
  try{
    const page=await search("inteligencia artificial","all",{fresh:true});
    assert.equal(page.searchCoverage.navigationalSites,0);
    assert.deepEqual(page.searchCoverage.generalIndexes,[]);
    assert.equal(page.searchCoverage.entireWebIndexed,false);
    assert.ok(!seen.some(u=>u.searchParams.get("action")==="wbgetentities"),
      "no P856 details request for ordinary informational subject");
    assert.equal(seen.filter(u=>u.searchParams.get("action")==="wbsearchentities")
      .length,1,"ordinary knowledge snippet may search Wikidata, not official-site extras");
  }finally{
    globalThis.fetch=before;
    keys.forEach((k,i)=>saved[i]===undefined
      ?delete process.env[k]:process.env[k]=saved[i]);
  }
});
async function serve(fn){
  const server=http.createServer(handler);
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    await fn("http://127.0.0.1:"+server.address().port);
  }finally{if(server.listening)await new Promise(resolve=>server.close(resolve));}
}
test("instant web navigation does not contact Wikidata for a broad topic",async()=>{
  const original=globalThis.fetch,external=[];
  globalThis.fetch=async(input,options)=>{
    const u=new URL(input);
    if(u.hostname==="127.0.0.1")return original(input,options);
    external.push(u);
    return new Response("unavailable",{status:503});
  };
  try{
    await serve(async base=>{
      const r=await fetch(base+"/api/search?nav=1&q="+
        encodeURIComponent("inteligencia artificial"));
      const data=await r.json();
      assert.equal(r.status,200);
      assert.equal(data.kind,"named_site_preview");
      assert.equal(data.site,null);
      assert.equal(data.scope,"known_named_sites_only");
      assert.equal(data.completeSearch,false);
    });
    assert.deepEqual(external,[]);
  }finally{globalThis.fetch=original;}
});
