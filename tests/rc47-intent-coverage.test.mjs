import test from "node:test";
import assert from "node:assert/strict";
import {directorySites} from "../server/site-discovery.mjs";
import {search,quickOpenWeb} from "../server/search.mjs";
const withoutIndexes=async work=>{
  const oldFetch=globalThis.fetch;
  const names=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const original=names.map(n=>process.env[n]);
  names.forEach(n=>delete process.env[n]);
  try{await work();}
  finally{
    globalThis.fetch=oldFetch;
    names.forEach((n,i)=>original[i]===undefined?
      delete process.env[n]:process.env[n]=original[i]);
  }
};
test("expanded navigational directory only matches known, exact names and hosts",()=>{
  const expected=new Map([
    ["ChatGPT","chatgpt.com"],["gob.mx","gob.mx"],["INEGI","inegi.org.mx"],
    ["diario oficial de la federación","dof.gob.mx"],
    ["universidad de guadalajara","udg.mx"],["Mercado Pago","mercadopago.com.mx"],
    ["Wikipedia","es.wikipedia.org"],["www.github.com","github.com"],
    ["Netflix","netflix.com"],["Notion","notion.so"]
  ]);
  for(const [name,host] of expected){
    const rows=directorySites(name);
    assert.equal(rows.length,1,name);
    assert.equal(new URL(rows[0].url).hostname.replace(/^www\./,""),host,name);
    assert.equal(rows[0].linkBasis,"curated_directory");
  }
  for(const q of ["github.com.attacker.example","Netflix opiniones",
    "imss costo de consultas","gob.mx site:gob.mx","una página inventada"])
    assert.deepEqual(directorySites(q),[],q);
});
test("ordinary AI search skips HN and returns real Wikipedia context if available",async()=>withoutIndexes(async()=>{
  const calls=[];
  globalThis.fetch=async input=>{
    const u=new URL(input);calls.push(u.hostname);
    if(u.hostname==="es.wikipedia.org")return new Response(JSON.stringify({
      query:{search:[{title:"Inteligencia artificial",pageid:42,
        snippet:"Rama informática que desarrolla sistemas inteligentes"}]}
    }),{status:200});
    if(u.hostname==="www.wikidata.org")
      return new Response(JSON.stringify({search:[]}),{status:200});
    if(u.hostname==="hn.algolia.com")throw Error("HN should not be queried");
    return new Response("Unavailable",{status:503});
  };
  const quick=await quickOpenWeb("inteligencia artificial");
  assert.equal(quick.sourceStatus,"not_applicable");
  assert.deepEqual(quick.results,[]);
  const result=await search("inteligencia artificial","all",{fresh:true});
  assert.ok(result.results.some(x=>x.source==="Wikipedia"));
  assert.ok(!result.results.some(x=>x.source==="Hacker News · web abierta"));
  assert.equal(result.webDiscovery.provider,"not_queried");
  assert.deepEqual(result.searchCoverage.generalIndexes,[]);
  assert.equal(calls.includes("hn.algolia.com"),false);
}));
test("technical searches retain explicitly labelled community story discovery",async()=>withoutIndexes(async()=>{
  globalThis.fetch=async input=>{
    const host=new URL(input).hostname;
    if(host==="hn.algolia.com")return new Response(JSON.stringify({hits:[{
      objectID:"4381",title:"Python optimization guide",
      url:"https://example.org/python-guide",created_at:"2026-09-24T00:00:00Z"
    }]}),{status:200});
    return new Response("Unavailable",{status:503});
  };
  const quick=await quickOpenWeb("python optimization");
  assert.ok(quick.results.some(x=>x.source==="Hacker News · web abierta"));
  const full=await search("python optimization","all",{fresh:true});
  assert.ok(full.results.some(x=>x.source==="Hacker News · web abierta"));
}));
