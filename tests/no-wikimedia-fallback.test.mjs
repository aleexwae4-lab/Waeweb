import test from "node:test";
import assert from "node:assert/strict";
import {search} from "../server/search.mjs";

test("normal video results include genuine Commons clips without mislabelling platforms",async()=>{
  const before=globalThis.fetch;
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_SEARCH_ENGINE_ID","YOUTUBE_DATA_API_KEY"];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  keys.forEach(k=>delete process.env[k]);
  const hosts=[];
  globalThis.fetch=async url=>{
    const u=new URL(url);
    hosts.push(u.hostname);
    if(u.hostname==="commons.wikimedia.org")
      return new Response(JSON.stringify({query:{pages:{"1":{title:"File:Real.webm",imageinfo:[{
        mime:"video/webm",descriptionurl:"https://commons.wikimedia.org/wiki/File:Real.webm",
        url:"https://upload.wikimedia.org/wikipedia/commons/real.webm"
      }]}}}}),{status:200});
    throw new Error("unavailable provider "+url);
  };
  try{
    const result=await search("video-organic-wikimedia-fixture","videos",{fresh:true});
    assert.equal(result.mediaCollection,"web");
    assert.equal(result.results.length,1);
    assert.equal(result.results[0].platform,"Wikimedia Commons");
    assert.equal(result.results[0].source,"Wikimedia Commons · Video");
    assert.match(result.results[0].mediaUrl,/upload\.wikimedia\.org/);
    assert.equal(result.videoCoverage.youtubeApi,false);
    assert.equal(result.videoCoverage.webIndex,false);
    assert.equal(result.videoCoverage.commonsAvailable,true);
    assert.ok(hosts.includes("commons.wikimedia.org"));
    assert.equal(result.message,null);
  }finally{
    globalThis.fetch=before;
    for(const k of keys)saved[k]===undefined?delete process.env[k]:process.env[k]=saved[k];
  }
});

test("legacy explicit Commons collection remains compatible with existing API clients",async()=>{
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
  }finally{globalThis.fetch=before;}
});
