import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {earlyWikidataSiteEligible,wikidataOfficialSites}
  from "../server/site-discovery.mjs";
import {handler} from "../server/index.mjs";

const fixture={entities:{
  Q310:{labels:{en:{value:"Spotify"},es:{value:"Spotify"}},
    descriptions:{es:{value:"Servicio de música"}},
    claims:{P856:[{rank:"normal",mainsnak:{datavalue:{value:"https://www.spotify.com/"}}}]}},
  Q311:{labels:{en:{value:"Spotify impostor"}},
    claims:{P856:[{rank:"normal",mainsnak:{datavalue:{value:"https://impostor.example.org/"}}}]}}
}};
const json=data=>new Response(JSON.stringify(data),{
  status:200,headers:{"content-type":"application/json"}});
async function serve(fn){
  const server=http.createServer(handler);
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    await fn("http://127.0.0.1:"+server.address().port);
  }finally{if(server.listening)await new Promise(resolve=>server.close(resolve));}
}

test("extra early provider lookup is limited to named-brand or official-site intent",()=>{
  for(const q of ["Spotify","sitio oficial de Spotify",
    "Instituto Nacional de Investigación Digital"])
    assert.equal(earlyWikidataSiteEligible(q),true,q);
  for(const q of ["github","Mercado Libre México",
    "tutorial de GitHub","clima en Guadalajara","inteligencia artificial",
    "medicamentos baratos","site:spotify.com Spotify","x",""])
    assert.equal(earlyWikidataSiteEligible(q),false,q);
});

test("unknown brand obtains real P856 URL and clear provenance, without claiming a web index",async()=>{
  const prior=globalThis.fetch,urls=[];
  globalThis.fetch=async(input,options)=>{
    const url=new URL(input);
    if(url.hostname!=="www.wikidata.org")return prior(input,options);
    urls.push(url);
    return json(url.searchParams.get("action")==="wbsearchentities"
      ?{search:[{id:"Q310"},{id:"Q311"}]}:fixture);
  };
  try{
    await serve(async base=>{
      const res=await fetch(base+"/api/search?nav=1&type=all&q=Spotify");
      const body=await res.json();
      assert.equal(res.status,200);
      assert.equal(res.headers.get("x-waeweb-api"),"1");
      assert.equal(body.kind,"named_site_preview");
      assert.equal(body.completeSearch,false);
      assert.equal(body.scope,"wikidata_P856_exact_name");
      assert.equal(body.sourceStatus,"found");
      assert.equal(body.site.url,"https://www.spotify.com/");
      assert.equal(body.site.linkBasis,"wikidata_P856");
      assert.equal(body.site.provenanceUrl,"https://www.wikidata.org/wiki/Q310");
      assert.doesNotMatch(body.site.url,/impostor/);
      assert.ok(!("generalIndexes" in body));
    });
    assert.equal(urls.length,3);
  }finally{globalThis.fetch=prior;}
});

test("concurrent identical official-site lookups share provider calls and release the in-flight request",async()=>{
  const prior=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async input=>{
    calls++;
    const url=new URL(input);
    await Promise.resolve();
    return json(url.searchParams.get("action")==="wbsearchentities"
      ?{search:[{id:"Q310"}]}:fixture);
  };
  try{
    const [a,b]=await Promise.all([
      wikidataOfficialSites("Spotify oficial"),
      wikidataOfficialSites("sitio web de Spotify")
    ]);
    assert.equal(a[0].url,"https://www.spotify.com/");
    assert.equal(b[0].url,a[0].url);
    assert.equal(calls,3,"two languages and one detail call, not duplicated");
    await wikidataOfficialSites("Spotify");
    assert.equal(calls,6,"completed result is not a persistent new web index");
  }finally{globalThis.fetch=prior;}
});

test("unknown-name outage produces an honest optional preview and keeps the normal API separate",async()=>{
  const prior=globalThis.fetch;
  globalThis.fetch=async(input,options)=>{
    if(new URL(input).hostname==="www.wikidata.org")
      return new Response("unavailable",{status:503});
    return prior(input,options);
  };
  try{
    await serve(async base=>{
      const bad=await (await fetch(base+"/api/search?nav=1&q=Spotify")).json();
      assert.equal(bad.site,null);
      assert.equal(bad.sourceStatus,"unavailable");
      assert.equal(bad.scope,"wikidata_P856_exact_name");
      assert.equal(bad.completeSearch,false);
      const topical=await (await fetch(base+"/api/search?nav=1&q="+
        encodeURIComponent("clima en Guadalajara"))).json();
      assert.equal(topical.site,null);
      assert.equal(topical.scope,"known_named_sites_only");
      const advanced=await (await fetch(base+"/api/search?nav=1&q="+
        encodeURIComponent("Spotify site:spotify.com"))).json();
      assert.equal(advanced.site,null);
      assert.equal(advanced.scope,"known_named_sites_only");
    });
  }finally{globalThis.fetch=prior;}
});

test("progressive UI indicates P856 as declared rather than independently verified",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/q\.length<=120/);
  assert.match(app,/earlySite\?\.linkBasis==="wikidata_P856"/);
  assert.match(app,/Sitio declarado en Wikidata · Otras páginas en recuperación/);
  assert.match(app,/fullSearchFinished\|\|signal\.aborted\|\|sequence!==state\.sequence/);
});
