import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {directorySites,navigationalName,wikidataOfficialSites} from "../server/site-discovery.mjs";
import {search} from "../server/search.mjs";

test("official-page phrasing and regional names lead to existing, curated destinations",()=>{
  for(const [name,expected]of [
    ["github oficial","github.com"],["sitio web de GitHub","github.com"],
    ["Mercado Libre México","mercadolibre.com.mx"],
    ["Mercado Libre MX","mercadolibre.com.mx"],
    ["página oficial de mercado libre mexico","mercadolibre.com.mx"],
    ["ir a Pinterest","pinterest.com"],["portal oficial de NASA","nasa.gov"],
    ["Amazon México","amazon.com.mx"],["UNAM oficial","unam.mx"],
    ["X","x.com"]
  ]){
    const rows=directorySites(name);
    assert.equal(rows.length,1,name);
    assert.equal(new URL(rows[0].url).hostname.replace(/^www\./,""),expected,name);
    assert.equal(rows[0].siteLink,true);
    assert.equal(rows[0].linkBasis,"curated_directory");
  }
});

test("topical and foreign-market queries do not silently redirect to curated sites",()=>{
  for(const name of ["tutorial de GitHub","github javascript repositorios",
    "mejores productos mercado libre","Mercado Libre Argentina",
    "NASA últimas noticias","Pinterest ideas de decoración",
    "amazon envíos baratos","servicios de la UNAM"]) {
    assert.deepEqual(directorySites(name),[],name);
  }
});

test("long institutional names resolve only with institutional or explicit website intent",()=>{
  assert.equal(navigationalName("Instituto Mexicano del Seguro Social"),
    "instituto mexicano del seguro social");
  assert.equal(navigationalName("página oficial de Centro Nacional de Investigación de México"),
    "centro nacional de investigacion de mexico");
  assert.equal(navigationalName("mejores sitios para investigar inteligencia artificial"),
    null);
  assert.equal(navigationalName("sitio web de mejor receta de pastel de chocolate"),
    "mejor receta de pastel de chocolate");
});

test("long institutional lookup still requires an exact Wikidata name and P856, not guessed domains",async()=>{
  const previous=globalThis.fetch,calls=[];
  globalThis.fetch=async input=>{
    const url=new URL(input);
    calls.push(url);
    const mode=url.searchParams.get("action");
    return new Response(JSON.stringify(mode==="wbsearchentities"
      ? {search:[{id:"Q123"},{id:"Q124"}]}
      : {entities:{
        Q123:{labels:{es:{value:"Instituto Mexicano del Seguro Social"}},
          claims:{P856:[{rank:"normal",mainsnak:{datavalue:{
            value:"https://www.imss.gob.mx/"
          }}}]}},
        Q124:{labels:{es:{value:"Instituto Mexicano del Seguro Social FALSO"}},
          claims:{P856:[{rank:"normal",mainsnak:{datavalue:{
            value:"https://impostor.example.org/"
          }}}]}}
      }}),{status:200,headers:{"content-type":"application/json"}});
  };
  try{
    const rows=await wikidataOfficialSites("Instituto Mexicano del Seguro Social");
    assert.equal(rows.length,1);
    assert.equal(rows[0].url,"https://www.imss.gob.mx/");
    assert.equal(rows[0].linkBasis,"wikidata_P856");
    assert.equal(rows[0].provenanceUrl,"https://www.wikidata.org/wiki/Q123");
    assert.equal(calls.length,3);
  }finally{globalThis.fetch=previous;}
});

test("single-character X is allowed only for Web navigation, not arbitrary one-character searches",async()=>{
  const old=globalThis.fetch;
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const saved=keys.map(key=>process.env[key]);
  for(const key of keys)delete process.env[key];
  globalThis.fetch=async()=>new Response("unavailable",{status:503});
  try{
    const x=await search("X","all",{fresh:true});
    assert.equal(x.results[0].url,"https://x.com/");
    assert.equal(x.results[0].linkBasis,"curated_directory");
    assert.equal(x.searchCoverage.generalIndexes.length,0);
    assert.match((await search("a","all",{fresh:true})).error,/dos caracteres/);
    assert.match((await search("X","images",{fresh:true})).error,/dos caracteres/);
  }finally{
    globalThis.fetch=old;
    keys.forEach((key,i)=>saved[i]===undefined
      ?delete process.env[key]:process.env[key]=saved[i]);
  }
});

test("browser keeps a short X query in web search without changing other categories",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/q\.length < 2 && !\(type==="all"&&q\.toLowerCase\(\)==="x"\)/);
});
