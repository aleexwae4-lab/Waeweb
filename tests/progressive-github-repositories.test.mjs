import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {quickOpenWeb,search} from "../server/search.mjs";

const githubFixture=()=>new Response(JSON.stringify({items:[{
  id:42,full_name:"acme/react-tool",html_url:"https://github.com/acme/react-tool",
  private:false,description:"Real public repository",language:"TypeScript",
  stargazers_count:1234,updated_at:"2026-09-24T00:00:00Z"
},{
  id:43,full_name:"bad/redirect",html_url:"https://evil.example/bad/redirect",
  private:false,description:"Must be rejected",stargazers_count:999999
}]}),{status:200,headers:{"content-type":"application/json"}});
const empty=()=>new Response(JSON.stringify({hits:[],items:[],documents:[]}),{
  status:200,headers:{"content-type":"application/json"}});
async function isolated(fn){
  const old=globalThis.fetch;
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const saved=keys.map(k=>process.env[k]);keys.forEach(k=>delete process.env[k]);
  try{await fn();}finally{
    globalThis.fetch=old;
    keys.forEach((k,i)=>saved[i]===undefined?delete process.env[k]:process.env[k]=saved[i]);
  }
}
test("explicit repository intent can surface authentic GitHub repository metadata early",async()=>isolated(async()=>{
  const hosts=[];
  globalThis.fetch=async input=>{
    const u=new URL(input);hosts.push(u.hostname);
    if(u.hostname==="api.github.com")return githubFixture();
    return empty();
  };
  const data=await quickOpenWeb("react repositorios");
  assert.equal(data.scope,"public_repository_technical_and_story_links");
  const repo=data.results.find(x=>x.source==="GitHub · repositorios públicos");
  assert.ok(repo);
  assert.equal(repo.url,"https://github.com/acme/react-tool");
  assert.equal(repo.title,"acme/react-tool");
  assert.match(repo.snippet,/TypeScript/);
  assert.match(repo.snippet,/1234/);
  assert.equal(repo.indexedScope,"repository_metadata_only");
  assert.equal(data.generalIndexes.length,0);
  assert.ok(hosts.includes("api.github.com"));
  assert.ok(!data.results.some(x=>x.url?.includes("evil.example")));
}));

test("ordinary GitHub navigation does not spend repository-search quota",async()=>isolated(async()=>{
  let githubCalls=0;
  globalThis.fetch=async input=>{
    const u=new URL(input);
    if(u.hostname==="api.github.com"){githubCalls++;return githubFixture();}
    return empty();
  };
  const data=await quickOpenWeb("GitHub");
  assert.equal(data.scope,"hacker_news_story_links");
  assert.equal(githubCalls,0);
}));

test("technical query without repository intent keeps current sources and skips GitHub API",async()=>isolated(async()=>{
  let githubCalls=0;
  globalThis.fetch=async input=>{
    const u=new URL(input);
    if(u.hostname==="api.github.com"){githubCalls++;return githubFixture();}
    return empty();
  };
  const data=await quickOpenWeb("React hooks");
  assert.equal(data.scope,"public_technical_and_story_links");
  assert.equal(githubCalls,0);
}));

test("concurrent quick and full search share one GitHub repository request",async()=>isolated(async()=>{
  let githubCalls=0;
  globalThis.fetch=async input=>{
    const u=new URL(input);
    if(u.hostname==="api.github.com"){
      githubCalls++;await new Promise(r=>setImmediate(r));return githubFixture();
    }
    if(u.hostname==="es.wikipedia.org")
      return new Response(JSON.stringify({query:{search:[]}}),{status:200});
    if(u.hostname==="www.wikidata.org")
      return new Response(JSON.stringify({search:[]}),{status:200});
    return empty();
  };
  const q="react repositorios";
  const [fast,full]=await Promise.all([quickOpenWeb(q),search(q,"all",{fresh:true})]);
  assert.equal(githubCalls,1);
  assert.ok(fast.results.some(x=>x.url==="https://github.com/acme/react-tool"));
  assert.ok(full.results.some(x=>x.url==="https://github.com/acme/react-tool"));
}));

test("progressive UI accepts repository scope and only the declared GitHub source",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/public_repository_technical_and_story_links/);
  assert.match(app,/GitHub · repositorios públicos/);
  assert.match(app,/preview\.completeSearch!==false/);
  assert.match(app,/safeUrl\(item\.url\)&&item\.title/);
});
