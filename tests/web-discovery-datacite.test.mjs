import test from "node:test";
import assert from "node:assert/strict";
import {indexLinkedPage,indexedUrl,localWebSearch,discoverOpenWeb,webIndexStats} from "../server/web-index.mjs";
import {dataCite,search} from "../server/search.mjs";

test("WAE metadata index keeps legitimate HTTPS links only; does not scrape or invent article bodies",()=>{
  for(const input of ["http://unsafe.test/a","javascript:alert(1)",
    "https://localhost/a","https://127.0.0.1/a","https://[::ffff:127.0.0.1]/",
    "https://www.wikipedia.org/wiki/A","https://example.org.evil.test:999/a"])
    assert.equal(indexedUrl(input),null,input);
  assert.equal(indexedUrl("https://example.org/article?utm_source=track&key=1#ref"),
    "https://example.org/article?key=1");
  assert.equal(indexLinkedPage({url:"https://example.org/a",title:"Missing ID"}),null);
  const entry=indexLinkedPage({objectID:"123456",url:"https://example.org/real",
    title:"Article about WAEWEB search",created_at:"2026-09-23T03:25:00.000Z"});
  assert.equal(entry.source,"Hacker News · web abierta");
  assert.match(entry.snippet,/no verificado/);
  const matched=localWebSearch("WAEWEB search");
  assert.ok(matched.some(item=>item.url==="https://example.org/real"));
  assert.ok(matched.every(item=>item.indexPersistence==="memory_only"));
  assert.ok(webIndexStats().documents<=500);
});

test("real open-web discovery only ingests actual HN-linked articles and keeps source attribution",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async (url,options)=>{
    const u=new URL(url);
    assert.equal(u.hostname,"hn.algolia.com");
    assert.equal(u.pathname,"/api/v1/search");
    assert.equal(u.searchParams.get("tags"),"story");
    assert.equal(u.searchParams.get("hitsPerPage"),"20");
    assert.ok(options.signal);
    return new Response(JSON.stringify({hits:[
      {objectID:"813",title:"A source-backed WAEWEB story",url:"https://news.example.org/story",
        created_at:"2026-09-23T00:00:00.000Z",story_text:"Reported by original journalist"},
      {objectID:"814",title:"No outbound article URL"},
      {objectID:"815",title:"Wrong scheme",url:"javascript:alert(1)"},
      {objectID:"816",title:"Wiki substitution",url:"https://es.wikipedia.org/wiki/Something"}
    ]}),{status:200});
  };
  try{
    const docs=await discoverOpenWeb("WAEWEB");
    assert.equal(docs.length,1);
    assert.equal(docs[0].url,"https://news.example.org/story");
    assert.equal(docs[0].hnStory,"https://news.ycombinator.com/item?id=813");
    assert.equal(docs[0].source,"Hacker News · web abierta");
  }finally{globalThis.fetch=old;}
});

test("default Web uses specialist public links without relabeling them general-index",async()=>{
  const old=globalThis.fetch;
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_SEARCH_ENGINE_ID"];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  keys.forEach(k=>delete process.env[k]);
  globalThis.fetch=async url=>{
    assert.equal(new URL(url).hostname,"hn.algolia.com");
    return new Response(JSON.stringify({hits:[{objectID:"93491",
      title:"WAE real web index release",
      url:"https://site.example.org/wae-release",created_at:"2026-09-23T03:00:00Z"}]}),{status:200});
  };
  try{
    const data=await search("WAE real web index release","all",{fresh:true});
    assert.equal(data.results.length,1);
    assert.equal(data.results[0].url,"https://site.example.org/wae-release");
    assert.equal(data.webCoverage,"specialized");
    assert.equal(data.webDiscovery.provider,"available");
    assert.equal(data.webDiscovery.independentlyVerifiedContent,false);
    assert.equal(data.hasMore,false);
    assert.ok(!data.sources.some(s=>/wiki/i.test(s)));
  }finally{
    globalThis.fetch=old;
    for(const key of keys)saved[key]===undefined?delete process.env[key]:process.env[key]=saved[key];
  }
});

test("DataCite returns DOI records with real titles, and excludes missing or malformed metadata",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async url=>{
    const u=new URL(url);
    assert.equal(u.hostname,"api.datacite.org");
    assert.equal(u.pathname,"/dois");
    assert.equal(u.searchParams.get("page[size]"),"12");
    return new Response(JSON.stringify({data:[
      {id:"10.1234/research",attributes:{
        doi:"10.1234/research",titles:[{title:"A sourced data record"}],
        publisher:"Data repository",publicationYear:2025,types:{resourceTypeGeneral:"Dataset"},
        descriptions:[{description:"Public data metadata"}]}},
      {id:"invalid",attributes:{titles:[{title:"Not a DOI"}]}},
      {id:"10.1234/no-title",attributes:{doi:"10.1234/no-title",titles:[]}}
    ]}),{status:200});
  };
  try{
    const data=await dataCite("WAE index");
    assert.equal(data.length,1);
    assert.equal(data[0].source,"DataCite");
    assert.equal(data[0].url,"https://doi.org/10.1234%2Fresearch");
    assert.match(data[0].snippet,/Dataset/);
    assert.equal(data[0].date,"2025");
  }finally{globalThis.fetch=old;}
});
