import test from "node:test";
import assert from "node:assert/strict";
import {githubPublicRepositories} from "../server/web-providers.mjs";
import {parseQuery} from "../server/intelligence.mjs";
import {search} from "../server/search.mjs";

test("GitHub repository search uses authentic public metadata without a paid API key",async()=>{
  const original=globalThis.fetch;
  globalThis.fetch=async input=>{
    const u=new URL(input);
    assert.equal(u.hostname,"api.github.com");
    assert.equal(u.pathname,"/search/repositories");
    assert.equal(u.searchParams.get("q"),"react typescript");
    assert.equal(u.searchParams.get("per_page"),"8");
    return new Response(JSON.stringify({items:[
      {id:123,full_name:"owner/useful-repository",html_url:"https://github.com/owner/useful-repository",
        description:"React + TypeScript sample",language:"TypeScript",
        stargazers_count:54,updated_at:"2026-09-20T03:00:00Z",private:false},
      {id:124,full_name:"owner/secret",html_url:"https://github.com/owner/secret",
        private:true,description:"not public"},
      {id:125,full_name:"owner/fake",html_url:"https://github.com.evil.org/owner/fake",
        private:false,description:"malicious redirect"},
      {id:126,full_name:"owner/another",html_url:"http://github.com/owner/another",private:false}
    ]}),{status:200});
  };
  try{
    const hits=await githubPublicRepositories("react typescript");
    assert.equal(hits.length,1);
    assert.equal(hits[0].url,"https://github.com/owner/useful-repository");
    assert.equal(hits[0].source,"GitHub · repositorios públicos");
    assert.match(hits[0].snippet,/React \+ TypeScript sample/);
    assert.match(hits[0].snippet,/Estrellas públicas: 54/);
    assert.equal(hits[0].date,null,"updated_at must not claim publication date");
    assert.equal(hits[0].updatedAt,"2026-09-20T03:00:00Z");
    assert.equal(hits[0].indexedScope,"repository_metadata_only");
  }finally{globalThis.fetch=original;}
});
test("source:github works in normal web mode and is not a universal web-index claim",async()=>{
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_SEARCH_ENGINE_ID",
    "WAE_SEARXNG_URL"];
  const prior=keys.map(k=>process.env[k]),old=globalThis.fetch;
  keys.forEach(k=>delete process.env[k]);
  globalThis.fetch=async input=>{
    const u=new URL(input);
    if(u.hostname!=="api.github.com")throw Error("Provider temporarily unavailable");
    return new Response(JSON.stringify({items:[{
      id:301,full_name:"example/waeweb",
      html_url:"https://github.com/example/waeweb",description:"React TypeScript search UI",
      private:false,stargazers_count:20
    }]}),{status:200});
  };
  try{
    const parsed=parseQuery("react typescript source:github");
    assert.equal(parsed.source,"github");
    assert.equal(parsed.query,"react typescript");
    const result=await search("react typescript source:github","all",{fresh:true});
    assert.equal(result.results.length,1);
    assert.equal(result.results[0].source,"GitHub · repositorios públicos");
    assert.equal(result.searchCoverage.generalIndexes.length,0);
    assert.ok(result.searchCoverage.specialistSources.includes("GitHub · repositorios públicos"));
    assert.equal(result.webDiscovery.independentlyVerifiedContent,false);
  }finally{
    globalThis.fetch=old;
    keys.forEach((k,i)=>prior[i]===undefined?delete process.env[k]:process.env[k]=prior[i]);
  }
});
test("GitHub upstream failures produce no fabricated repositories",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>new Response("search rate exceeded",{status:403});
  try{await assert.rejects(githubPublicRepositories("software"),/discovery_status_403/);}
  finally{globalThis.fetch=old;}
});
