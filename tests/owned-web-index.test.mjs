import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {indexLinkedPage,enrichIndexedPage,localWebSearch,webIndexStats} from "../server/web-index.mjs";
import {handler} from "../server/index.mjs";

const resolver=async()=>[{address:"93.184.215.14",family:4}];
function transport(robots,html,seen){
  return async(url,address)=>{
    seen.push({path:url.pathname,ip:address.address});
    return url.pathname==="/robots.txt"
      ?{status:200,body:robots,headers:{"content-type":"text/plain"}}
      :{status:200,body:html,headers:{"content-type":"text/html; charset=utf-8"}};
  };
}
test("web-index reader only accepts previously discovered source-backed URLs",async()=>{
  await assert.rejects(()=>enrichIndexedPage("https://unknown.example.org/unseen"),
    {name:"ReaderError",code:"not_discovered"});
  await assert.rejects(()=>enrichIndexedPage("https://localhost/admin"),
    {name:"ReaderError",code:"not_discovered"});
});
test("user-initiated reading obeys robots and enriches keyword search with real source text",async()=>{
  const url="https://reader-owned-index.example.org/articles/wae";
  indexLinkedPage({objectID:"957312",url,title:"Original article title"});
  const seen=[];
  const entry=await enrichIndexedPage(url,{
    resolver,transport:transport("User-agent: *\\nAllow: /\\n",
      "<html><head><title>Research article</title></head><main>The original article contains authenticated source text about pericial sciences and forensic methods.</main></html>",seen)
  });
  assert.equal(entry.url,url);
  assert.equal(entry.contentRecovered,true);
  assert.equal(entry.cached,false);
  assert.equal(entry.persistence,"memory_only");
  assert.match(entry.fingerprint,/^[0-9a-f]{64}$/);
  assert.ok(seen.some(x=>x.path==="/robots.txt"));
  assert.ok(seen.some(x=>x.path==="/articles/wae"));
  assert.ok(seen.every(x=>x.ip==="93.184.215.14"));
  assert.ok(localWebSearch("pericial sciences").some(x=>x.url===url));
  assert.ok(webIndexStats().enrichedDocuments>=1);
  const cached=await enrichIndexedPage(url,{resolver,transport:()=>{throw Error("unnecessary re-fetch");}});
  assert.equal(cached.cached,true);
});
test("robots disallow preserves source metadata but never indexes forbidden text",async()=>{
  const url="https://reader-robots-blocked.example.org/blocked/page";
  indexLinkedPage({objectID:"957313",url,title:"Blocked page with link metadata"});
  const seen=[];
  await assert.rejects(()=>enrichIndexedPage(url,{
    resolver,transport:transport("User-agent: *\\nDisallow: /blocked\\n",
      "<title>Private</title><main>Text from a route blocked by robots must never appear.</main>",seen)
  }),{code:"robots_disallowed"});
  assert.deepEqual(seen.map(x=>x.path),["/robots.txt"]);
  assert.ok(!localWebSearch("must never appear").some(x=>x.url===url));
});
test("public reading requires a discovered URL even in isolated preview; no private vault",async()=>{
  const old=process.env.WAE_PREVIEW_MODE;
  process.env.WAE_PREVIEW_MODE="true";
  const server=http.createServer((req,res)=>handler(req,res).catch(e=>{
    res.statusCode=500;res.end(e.message);
  }));
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+server.address().port;
    const cap=await fetch(base+"/api/capabilities");
    assert.equal(cap.status,200);
    const config=await cap.json();
    assert.equal(config.webDiscovery.userInitiatedRobotsCompliantReading,true);
    assert.equal(config.webDiscovery.generalWebIndex,false);
    const response=await fetch(base+"/api/web-index/read?url="+encodeURIComponent("https://not-discovered.example.org/"));
    assert.equal(response.status,422);
    assert.equal(response.headers.get("x-waeweb-api"),"1");
    assert.equal((await response.json()).code,"not_discovered");
  }finally{
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    if(old===undefined)delete process.env.WAE_PREVIEW_MODE;
    else process.env.WAE_PREVIEW_MODE=old;
  }
});
