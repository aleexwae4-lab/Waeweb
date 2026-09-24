import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {directorySites,navigationalName,earlyWikidataSiteEligible}
  from "../server/site-discovery.mjs";
import {search} from "../server/search.mjs";
import {handler} from "../server/index.mjs";

const hosts=[
  ["quiero visitar GitHub","github.com"],
  ["quiero abrir la página oficial de GitHub","github.com"],
  ["llévame a GitHub","github.com"],
  ["dirígeme a Mercado Libre México","mercadolibre.com.mx"],
  ["quiero entrar en Instagram","instagram.com"],
  ["abre la web de TikTok","tiktok.com"],
  ["visita la página de NASA","nasa.gov"],
  ["quiero acceder a Canva","canva.com"],
  ["abre Figma","figma.com"],
  ["Google Maps","google.com"],
  ["GitHub Docs","docs.github.com"],
  ["llevame a Stack Overflow","stackoverflow.com"],
  ["quiero navegar a Docker Hub","hub.docker.com"],
  ["necesito ir a MDN","developer.mozilla.org"],
  ["ir a npm","npmjs.com"],
  ["quiero visitar IMSS","imss.gob.mx"],
  ["abre SAT México","sat.gob.mx"]
];
test("explicit conversational navigation returns known genuine destination entries",()=>{
  for(const [q,host] of hosts){
    const hits=directorySites(q);
    assert.equal(hits.length,1,q);
    assert.equal(new URL(hits[0].url).hostname.replace(/^www\./,""),host,q);
    assert.equal(hits[0].siteLink,true,q);
    assert.equal(hits[0].linkBasis,"curated_directory",q);
    assert.match(hits[0].snippet,/disponibilidad no comprobada/);
  }
});
test("navigation parsing never converts topical queries into site hits",()=>{
  for(const q of ["quiero aprender GitHub","tutorial de React en GitHub",
    "quiero ver videos de Instagram","quiero saber si SAT cobra multas",
    "noticias de NASA","mejores productos de Mercado Libre",
    "quiero abrir la puerta","canva precios",
    "quiero visitar github site:github.com",
    "ir a instagram after:2025","abrir Mercado Libre Argentina",
    "quiero visitar una web desconocida"]){
    assert.deepEqual(directorySites(q),[],q);
  }
  assert.equal(navigationalName("quiero ir a página oficial de GitHub"),"github");
  assert.equal(navigationalName("visitar la página web de GitHub"),"github");
  assert.equal(earlyWikidataSiteEligible("quiero visitar una web desconocida"),true);
  assert.equal(earlyWikidataSiteEligible("tutorial de React"),false);
});
async function serve(run){
  const server=http.createServer(handler);
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    await run("http://127.0.0.1:"+server.address().port);
  }finally{if(server.listening)
    await new Promise(resolve=>server.close(resolve));}
}
test("instant API returns curated destination without third-party fetch",async()=>{
  const original=globalThis.fetch,seen=[];
  globalThis.fetch=async(input,...opts)=>{
    const u=new URL(input);
    if(u.hostname==="127.0.0.1")return original(input,...opts);
    seen.push(u.hostname);
    return new Response("unavailable",{status:503});
  };
  try{
    await serve(async base=>{
      for(const [query,hostname]of hosts){
        const response=await fetch(base+"/api/search?nav=1&q="+
          encodeURIComponent(query));
        assert.equal(response.status,200,query);
        assert.equal(response.headers.get("x-waeweb-api"),"1",query);
        const data=await response.json();
        assert.equal(data.kind,"named_site_preview",query);
        assert.equal(data.completeSearch,false,query);
        assert.equal(data.scope,"known_named_sites_only",query);
        assert.equal(new URL(data.site.url).hostname.replace(/^www\./,""),
          hostname,query);
      }
    });
    assert.deepEqual(seen,[]);
  }finally{globalThis.fetch=original;}
});
test("federated web keeps first site card and honest coverage without general indexes",async()=>{
  const original=globalThis.fetch;
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const old=keys.map(x=>process.env[x]);
  keys.forEach(x=>delete process.env[x]);
  globalThis.fetch=async()=>new Response("unavailable",{status:503});
  try{
    const data=await search("quiero visitar GitHub","all",{fresh:true});
    assert.equal(data.results[0].url,"https://github.com/");
    assert.equal(data.results[0].siteLink,true);
    assert.deepEqual(data.searchCoverage.generalIndexes,[]);
    assert.equal(data.searchCoverage.entireWebIndexed,false);
  }finally{
    globalThis.fetch=original;
    keys.forEach((x,i)=>old[i]===undefined?delete process.env[x]:process.env[x]=old[i]);
  }
});
