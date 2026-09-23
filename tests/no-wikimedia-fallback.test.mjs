import test from "node:test";
import assert from "node:assert/strict";
import {search} from "../server/search.mjs";

test("normal video mode never calls Wikimedia Commons as a silent fallback",async()=>{
  const before=globalThis.fetch;
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_SEARCH_ENGINE_ID","YOUTUBE_DATA_API_KEY"];
  const saved=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  keys.forEach(k=>delete process.env[k]);
  const hosts=[];
  globalThis.fetch=async url=>{hosts.push(new URL(url).hostname);throw new Error("unexpected network "+url)};
  try{
    const result=await search("youtube-no-archive-fallback-fixture","videos",{fresh:true});
    assert.equal(result.mediaCollection,"web");
    assert.equal(result.results.length,0);
    assert.equal(result.videoCoverage.youtubeApi,false);
    assert.equal(result.videoCoverage.webIndex,false);
    assert.equal(hosts.includes("commons.wikimedia.org"),false);
    assert.match(result.message,/no sustituirá YouTube o TikTok con Wikimedia/i);
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
