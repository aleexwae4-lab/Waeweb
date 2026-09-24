import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {gitlabRepositoryIntentTerms,normalizeGitlabProject,GITLAB_SOURCE}
  from "../server/gitlab-discovery.mjs";
import {parseQuery} from "../server/intelligence.mjs";
import {quickOpenWeb,search} from "../server/search.mjs";
import {handler} from "../server/index.mjs";

const json=data=>new Response(JSON.stringify(data),{
  status:200,headers:{"content-type":"application/json"}});
const projects=json([
  {id:123,path_with_namespace:"studio/react-components",
    web_url:"https://gitlab.com/studio/react-components",visibility:"public",
    archived:false,description:"Public React UI components",
    star_count:55,last_activity_at:"2026-09-24T00:00:00Z"},
  {id:124,path_with_namespace:"studio/design/react-kit",
    web_url:"https://gitlab.com/studio/design/react-kit",visibility:"public",
    archived:false,description:"Nested React kit",star_count:3},
  {id:125,path_with_namespace:"studio/evil",
    web_url:"https://gitlab.com.evil.example/studio/evil",
    visibility:"public",archived:false},
  {id:126,path_with_namespace:"studio/private",
    web_url:"https://gitlab.com/studio/private",visibility:"private"},
  {id:127,path_with_namespace:"studio/archived",
    web_url:"https://gitlab.com/studio/archived",
    visibility:"public",archived:true},
  {id:128,path_with_namespace:"studio/mismatch",
    web_url:"https://gitlab.com/studio/other",visibility:"public"},
  {id:129,path_with_namespace:"studio/unknown",
    web_url:"https://gitlab.com/studio/unknown"}
]);
const empty=json({hits:[],items:[],documents:[],query:{search:[]},search:[]});
async function fixture(run){
  const previous=globalThis.fetch,seen=[];
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const saved=keys.map(k=>process.env[k]);
  keys.forEach(k=>delete process.env[k]);
  globalThis.fetch=async(input,...options)=>{
    const url=new URL(input);
    if(url.hostname==="127.0.0.1")return previous(input,...options);
    seen.push(url);
    if(url.hostname==="gitlab.com")return projects.clone();
    if(["api.github.com","hn.algolia.com","api.stackexchange.com",
      "developer.mozilla.org","es.wikipedia.org","www.wikidata.org"]
      .includes(url.hostname))return empty.clone();
    return new Response("upstream unavailable",{status:503});
  };
  try{await run(seen);}
  finally{
    globalThis.fetch=previous;
    keys.forEach((k,i)=>saved[i]===undefined
      ?delete process.env[k]:process.env[k]=saved[i]);
  }
}
async function serve(run){
  const server=http.createServer(handler);
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    await run("http://127.0.0.1:"+server.address().port);
  }finally{if(server.listening)
    await new Promise(resolve=>server.close(resolve));}
}
test("GitLab intent is repository- and technology-scoped, never brand-only",()=>{
  for(const [q,expected] of [
    ["repositorios React","React"],
    ["GitLab repos React","React"],
    ["repositorios de GitLab Python SQLite","Python SQLite"],
    ["React repositories","React"]
  ])assert.equal(gitlabRepositoryIntentTerms(q),expected,q);
  for(const q of ["GitLab","GitLab oficial","GitLab tutorial",
    "github repos React","GitHub","repositorios","React tutorial",
    "Mercado Libre México"])
    assert.equal(gitlabRepositoryIntentTerms(q),null,q);
});
test("public GitLab records validate exact canonical HTTPS project URLs",()=>{
  const item=normalizeGitlabProject({id:10,visibility:"public",
    path_with_namespace:"group/subgroup/react-kit",
    web_url:"https://gitlab.com/group/subgroup/react-kit",
    description:"<b>React</b> kit",star_count:7});
  assert.equal(item.url,"https://gitlab.com/group/subgroup/react-kit");
  assert.equal(item.source,GITLAB_SOURCE);
  assert.equal(item.indexedScope,"repository_metadata_only");
  assert.match(item.snippet,/React kit/);
  for(const url of ["https://gitlab.com.evil.example/group/repo",
    "http://gitlab.com/group/repo","https://gitlab.com/group/other",
    "https://gitlab.com/group/repo?token=private",
    "https://gitlab.com/group/repo#fragment",
    "https://gitlab.com:444/group/repo",
    "https://user:pass@gitlab.com/group/repo"]){
    assert.equal(normalizeGitlabProject({id:20,visibility:"public",
      path_with_namespace:"group/repo",web_url:url}),null,url);
  }
  assert.equal(normalizeGitlabProject({id:21,visibility:"internal",
    path_with_namespace:"group/repo",web_url:"https://gitlab.com/group/repo"}),null);
});
test("real quick web API includes GitLab results and excludes private and impostors",
  async()=>fixture(async calls=>{
    await serve(async base=>{
      const response=await fetch(base+"/api/search?quick=1&type=all&q="+
        encodeURIComponent("GitLab repos React"));
      const data=await response.json();
      assert.equal(response.status,200);
      assert.equal(response.headers.get("x-waeweb-api"),"1");
      assert.equal(data.scope,"public_code_and_story_links");
      assert.equal(data.completeSearch,false);
      assert.deepEqual(data.generalIndexes,[]);
      const gitlab=data.results.filter(x=>x.source===GITLAB_SOURCE);
      assert.equal(gitlab.length,2);
      assert.ok(gitlab.every(x=>x.indexedScope==="repository_metadata_only"));
      assert.ok(gitlab.some(x=>x.url==="https://gitlab.com/studio/react-components"));
      assert.ok(!JSON.stringify(data.results).includes("evil.example"));
    });
    const gitlab=calls.filter(u=>u.hostname==="gitlab.com");
    assert.equal(gitlab.length,1);
    assert.equal(gitlab[0].pathname,"/api/v4/projects");
    assert.equal(gitlab[0].searchParams.get("search"),"React");
    assert.equal(gitlab[0].searchParams.get("visibility"),"public");
    assert.equal(calls.filter(u=>u.hostname==="api.github.com").length,0);
  }));
test("quick and full search coalesce GitLab requests and retain source boundaries",
  async()=>fixture(async calls=>{
    const [early,full]=await Promise.all([
      quickOpenWeb("GitLab repos React"),
      search("GitLab repos React","all",{fresh:true})
    ]);
    const url="https://gitlab.com/studio/react-components";
    assert.ok(early.results.some(x=>x.url===url));
    assert.ok(full.results.some(x=>x.url===url));
    assert.equal(calls.filter(u=>u.hostname==="gitlab.com").length,1);
    assert.equal(calls.filter(u=>u.hostname==="api.github.com").length,0);
    assert.ok(full.searchCoverage.specialistSources.includes(GITLAB_SOURCE));
    assert.equal(full.searchCoverage.entireWebIndexed,false);
    assert.deepEqual(full.searchCoverage.generalIndexes,[]);
  }));
test("generic repository search can return both platforms while GitHub-only stays GitHub",
  async()=>fixture(async calls=>{
    await search("repositorios React","all",{fresh:true});
    assert.equal(calls.filter(u=>u.hostname==="api.github.com").length,1);
    assert.equal(calls.filter(u=>u.hostname==="gitlab.com").length,1);
    const before=calls.filter(u=>u.hostname==="gitlab.com").length;
    await search("GitHub repos React","all",{fresh:true});
    assert.equal(calls.filter(u=>u.hostname==="gitlab.com").length,before);
  }));
test("full GitLab source operator is parsed and filters to GitLab results",
  async()=>fixture(async calls=>{
    assert.equal(parseQuery("React source:gitlab").source,"gitlab");
    const data=await search("React source:gitlab","all",{fresh:true});
    assert.ok(data.results.length>0);
    assert.ok(data.results.every(x=>x.source===GITLAB_SOURCE));
    assert.equal(calls.filter(u=>u.hostname==="gitlab.com").length,1);
  }));
test("advanced operators and ordinary navigation cannot leak early project cards",
  async()=>fixture(async calls=>{
    for(const q of ["GitLab repos React site:other.example",
      "GitLab repos React source:github",'"GitLab repos React"',
      "GitLab repos React -studio","GitLab repos React after:2026"]){
      const result=await quickOpenWeb(q);
      assert.equal(result.sourceStatus,"not_applicable",q);
      assert.deepEqual(result.results,[],q);
    }
    await quickOpenWeb("GitLab");
    assert.equal(calls.filter(u=>u.hostname==="gitlab.com").length,0);
  }));
test("existing native results UI shows verified GitLab project cards",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/"GitLab · repositorios públicos"/);
  assert.match(app,/\].includes\(item.source\)/);
  assert.match(app,/fullSearchFinished\|\|signal\.aborted\|\|sequence!==state\.sequence/);
});
