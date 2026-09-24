import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {directorySites,navigationalName,publicSiteUrl,
  wikidataSiteRecords,wikidataOfficialSites} from "../server/site-discovery.mjs";
import {search} from "../server/search.mjs";
import {parseQuery,rankResults} from "../server/intelligence.mjs";

test("navigation finds concrete GitHub, Mercado Libre MX and social roots only on exact names",()=>{
  const urls=new Map([
    ["github","https://github.com/"],
    ["mercado libre","https://www.mercadolibre.com.mx/"],
    ["ir a facebook","https://www.facebook.com/"],
    ["sitio oficial de instagram","https://www.instagram.com/"],
    ["tik tok","https://www.tiktok.com/"],
    ["linkedin","https://www.linkedin.com/"],
    ["twitter","https://x.com/"]
  ]);
  for(const [q,url] of urls){
    const rows=directorySites(q);
    assert.equal(rows.length,1,q);
    assert.equal(rows[0].url,url,q);
    assert.equal(rows[0].siteLink,true,q);
    assert.equal(rows[0].linkBasis,"curated_directory",q);
  }
  for(const q of ["github búsqueda de repositorios en javascript",
    "sitio oficial sitio raro no indexado","not-a-real-network",
    "github site:github.com", ""]){
    assert.deepEqual(directorySites(q),[],q);
  }
  assert.equal(navigationalName("página oficial Mercado Libre"),"mercado libre");
});
test("Wikidata official P856 is attributed and exact-entity matched, never a guessed URL",()=>{
  const data={entities:{
    Q1:{labels:{es:{value:"Mercado Libre"}},descriptions:{es:{value:"Comercio electrónico"}},
      claims:{P856:[
        {rank:"deprecated",mainsnak:{datavalue:{value:"https://old.example.org"}}},
        {rank:"normal",mainsnak:{datavalue:{value:"https://www.mercadolibre.com/"}}}
      ]}},
    Q2:{labels:{es:{value:"Mercado Libre falso"}},claims:{
      P856:[{rank:"normal",mainsnak:{datavalue:{value:"https://impostor.example.org/"}}}]
    }}
  }};
  const records=wikidataSiteRecords(data,"Mercado Libre");
  assert.equal(records.length,1);
  assert.equal(records[0].url,"https://www.mercadolibre.com/");
  assert.equal(records[0].linkBasis,"wikidata_P856");
  assert.equal(records[0].provenanceUrl,"https://www.wikidata.org/wiki/Q1");
  assert.match(records[0].snippet,/no verifica la titularidad/);
  assert.deepEqual(wikidataSiteRecords(data,"otro negocio"),[]);
  assert.equal(publicSiteUrl("javascript:alert(1)"),null);
  assert.equal(publicSiteUrl("http://example.org"),null);
  assert.equal(publicSiteUrl("https://localhost/app"),null);
  assert.equal(publicSiteUrl("https://user:pass@example.org"),null);
});
test("Wikidata API search resolves entity detail before emitting official URL",async()=>{
  const old=globalThis.fetch,called=[];
  globalThis.fetch=async url=>{
    const target=new URL(url);called.push(target);
    const mode=target.searchParams.get("action");
    return new Response(JSON.stringify(mode==="wbsearchentities"
      ? {search:[{id:"Q364"},{id:"P856"},{id:"Qbad"}]}
      : {entities:{Q364:{labels:{en:{value:"GitHub"}},
          descriptions:{en:{value:"Software hosting"}},
          claims:{P856:[{rank:"normal",
            mainsnak:{datavalue:{value:"https://github.com/"}}}]}}}}),
      {status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const rows=await wikidataOfficialSites("GitHub");
    assert.equal(rows.length,1);
    assert.equal(rows[0].url,"https://github.com/");
    assert.equal(rows[0].provenanceUrl,"https://www.wikidata.org/wiki/Q364");
    assert.equal(called.length,3);
    assert.equal(called[2].searchParams.get("ids"),"Q364");
  }finally{globalThis.fetch=old;}
});
test("source-backed website outranks the encyclopaedia and repository for navigational query",()=>{
  const rows=rankResults([
    {title:"GitHub",url:"https://www.wikidata.org/wiki/Q364",source:"Wikidata",snippet:"entity"},
    {title:"GitHub sample",url:"https://github.com/demo/sample",source:"GitHub · repositorios públicos",snippet:"repo"},
    directorySites("github")[0]
  ],parseQuery("github"),"all");
  assert.equal(rows[0].url,"https://github.com/");
  assert.equal(rows.length,3);
});
test("general public search includes actual named site even when all general indexes fail",async()=>{
  const old=globalThis.fetch;
  const env=[
    ["BRAVE_SEARCH_API_KEY",process.env.BRAVE_SEARCH_API_KEY],
    ["GOOGLE_SEARCH_API_KEY",process.env.GOOGLE_SEARCH_API_KEY],
    ["GOOGLE_SEARCH_ENGINE_ID",process.env.GOOGLE_SEARCH_ENGINE_ID],
    ["WAE_SEARXNG_URL",process.env.WAE_SEARXNG_URL]
  ];
  for(const [name] of env)delete process.env[name];
  globalThis.fetch=async ()=>new Response("unavailable",{status:503});
  try{
    const response=await search("Mercado Libre","all",{fresh:true});
    assert.equal(response.results[0].url,"https://www.mercadolibre.com.mx/");
    assert.equal(response.results[0].siteLink,true);
    assert.equal(response.webCoverage,"specialized");
    assert.deepEqual(response.searchCoverage.generalIndexes,[]);
    assert.ok(response.searchCoverage.navigationalSites>=1);
    assert.equal(response.searchCoverage.entireWebIndexed,false);
  }finally{
    globalThis.fetch=old;
    for(const [name,value]of env)
      if(value===undefined)delete process.env[name];else process.env[name]=value;
  }
});
test("known domains suppress alternate Wikidata P856 navigation while keeping encyclopedia enrichment",async()=>{
  const old=globalThis.fetch;
  const env=[["BRAVE_SEARCH_API_KEY",process.env.BRAVE_SEARCH_API_KEY],
    ["GOOGLE_SEARCH_API_KEY",process.env.GOOGLE_SEARCH_API_KEY],
    ["GOOGLE_SEARCH_ENGINE_ID",process.env.GOOGLE_SEARCH_ENGINE_ID],
    ["WAE_SEARXNG_URL",process.env.WAE_SEARXNG_URL]];
  for(const [name]of env)delete process.env[name];
  let entityDetailRequests=0;
  globalThis.fetch=async url=>{
    const u=new URL(url);
    if(u.searchParams.get("action")==="wbgetentities")entityDetailRequests++;
    return new Response("unavailable",{status:503});
  };
  try{
    for(const [name,domain]of [["github","github.com"],
      ["Mercado Libre","mercadolibre.com.mx"],["instagram","instagram.com"]]){
      const page=await search(name,"all",{fresh:true});
      assert.equal(new URL(page.results[0].url).hostname.replace(/^www\./,""),domain);
      assert.equal(page.results[0].linkBasis,"curated_directory");
      assert.equal(page.results.filter(item=>item.siteLink).length,1);
    }
    assert.equal(entityDetailRequests,0);
  }finally{
    globalThis.fetch=old;
    for(const [name,value]of env)
      if(value===undefined)delete process.env[name];else process.env[name]=value;
  }
});
test("native result cards visit site with explicit provenance; no full-web claims",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/state\.type === "all" && item\.siteLink===true/);
  assert.match(app,/button\(item\.title,\(\)=>openBrowser\(url\),"result-title web-result-title"\)/);
  assert.match(app,/directSite\s*\? external\(url,item\.title,"result-title web-result-title wae-external-site-title"\)/);
  assert.doesNotMatch(app,/meta\.append\(directSite\s*\?/);
  assert.match(app,/ⓘ Procedencia/);
  assert.match(app,/Índice web general no configurado/);
  assert.match(app,/La búsqueda web amplia requiere que Brave, Google o SearXNG esté configurado y responda/);
});
