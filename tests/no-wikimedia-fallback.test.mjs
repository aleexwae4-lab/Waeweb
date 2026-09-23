import test from "node:test";
import assert from "node:assert/strict";
import {search} from "../server/search.mjs";

test("default video search includes actual Wikimedia files without calling them YouTube",async()=>{
  const before=globalThis.fetch;
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_SEARCH_ENGINE_ID","YOUTUBE_DATA_API_KEY"];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  keys.forEach(k=>delete process.env[k]);
  const hosts=[];
  globalThis.fetch=async url=>{
    const u=new URL(url);hosts.push(u.hostname);
    if(u.hostname==="commons.wikimedia.org")
      return new Response(JSON.stringify({query:{pages:{"1":{title:"File:Actual.webm",
        imageinfo:[{mime:"video/webm",descriptionurl:"https://commons.wikimedia.org/wiki/File:Actual.webm",
          url:"https://upload.wikimedia.org/actual.webm"}]}}}}),{status:200});
    throw Error("Provider unavailable");
  };
  try{
    const result=await search("youtube-federated-commons-fixture","videos",{fresh:true});
    assert.equal(result.mediaCollection,"web");
    assert.equal(result.results.length,1);
    assert.equal(result.results[0].platform,"Wikimedia Commons");
    assert.equal(result.results[0].mediaUrl,"https://upload.wikimedia.org/actual.webm");
    assert.equal(result.videoCoverage.youtubeApi,false);
    assert.equal(result.videoCoverage.webIndex,false);
    assert.equal(hosts.includes("commons.wikimedia.org"),true);
    assert.equal(result.message,null);
  }finally{
    globalThis.fetch=before;
    for(const k of keys)saved[k]===undefined?delete process.env[k]:process.env[k]=saved[k];
  }
});

test("Commons remains available only when explicitly requested as archive",async()=>{
  const before=globalThis.fetch;
  globalThis.fetch=async url=>{
    assert.equal(new URL(url).hostname,"commons.wikimedia.org");
    return new Response(JSON.stringify({query:{pages:{"1":{title:"File:Archive.webm",imageinfo:[{
      mime:"video/webm",descriptionurl:"https://commons.wikimedia.org/wiki/File:Archive.webm"
    }]}}}}),{status:200});
  };
  try{
    const result=await search("archive-explicit-fixture","videos",{fresh:true,collection:"commons"});
    assert.equal(result.mediaCollection,"commons");
    assert.equal(result.results.length,1);
    assert.equal(result.results[0].source,"Wikimedia Commons · Video");
  }finally{globalThis.fetch=before}
});
