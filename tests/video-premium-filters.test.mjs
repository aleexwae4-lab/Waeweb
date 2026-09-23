import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {videoIdentity,dedupeVideoResults} from "../server/video-discovery.mjs";
import {search} from "../server/search.mjs";

test("Shorts retain vertical original URL but share playback id with full YouTube clip",()=>{
  const id="aB3_-xyZ901";
  const shorts=videoIdentity("https://youtube.com/shorts/"+id+"?feature=share");
  assert.equal(shorts.canonical,"https://www.youtube.com/shorts/"+id);
  assert.equal(shorts.videoId,id);
  const videos=dedupeVideoResults([
    {url:"https://www.youtube.com/watch?v="+id,title:"Watch"},
    {url:"https://www.youtube.com/shorts/"+id,title:"Short duplicate"},
    {url:"https://commons.wikimedia.org/wiki/File:Real_a.webm",title:"A"},
    {url:"https://commons.wikimedia.org/wiki/File:Real_b.webm",title:"B"}
  ]);
  assert.equal(videos.length,3);
  assert.equal(videos.filter(x=>x.title.startsWith("Real")).length,0);
  assert.equal(videos[1].title,"A");
  assert.equal(videos[2].title,"B");
});

test("same TikTok id from distinct author links is one clip, unrelated clips stay",()=>{
  const clips=dedupeVideoResults([
    {url:"https://www.tiktok.com/@creator/video/7420123456789012345?utm_source=x"},
    {url:"https://m.tiktok.com/@other/video/7420123456789012345"},
    {url:"https://www.tiktok.com/@creator/video/7420123456789012346"}
  ]);
  assert.equal(clips.length,2);
  assert.equal(videoIdentity(clips[0].url).videoId,"7420123456789012345");
});

test("video cards expose real platform filters, native player and truthful empty state",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
  assert.match(app,/videoPlatform: "all"/);
  assert.match(app,/aria-label","Filtrar vídeos por plataforma"/);
  assert.match(app,/aria-pressed",String\(state\.videoPlatform===platform\)/);
  assert.match(app,/item\.platform==="YouTube"\|\|item\.platform==="TikTok"/);
  assert.match(app,/\? external\(url,item\.title,"result-title web-result-title"\)/);
  assert.match(app,/const hasResults=state\.type==="images"\|\|state\.type==="businesses"/);
  assert.match(app,/Cobertura de plataformas limitada/);
  assert.match(css,/\.video-platform-filter\[aria-pressed="true"\]/);
  assert.match(css,/min-height:44px/);
});

test("provider search maintains multiple independent Commons clips and exact YouTube identities",async()=>{
  const before=globalThis.fetch;
  const brave=process.env.BRAVE_SEARCH_API_KEY,google=process.env.GOOGLE_SEARCH_API_KEY,cx=process.env.GOOGLE_SEARCH_ENGINE_ID,yt=process.env.YOUTUBE_DATA_API_KEY;
  delete process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.GOOGLE_SEARCH_API_KEY;
  delete process.env.GOOGLE_SEARCH_ENGINE_ID;
  delete process.env.YOUTUBE_DATA_API_KEY;
  globalThis.fetch=async url=>{
    const u=new URL(url);
    assert.equal(u.hostname,"commons.wikimedia.org");
    return new Response(JSON.stringify({query:{pages:{
      "1":{title:"File:First.webm",imageinfo:[{mime:"video/webm",descriptionurl:"https://commons.wikimedia.org/wiki/File:First.webm"}]},
      "2":{title:"File:Second.webm",imageinfo:[{mime:"video/webm",descriptionurl:"https://commons.wikimedia.org/wiki/File:Second.webm"}]}
    }}}),{status:200});
  };
  try{
    const result=await search("wae-video-premium-fixture-2026","videos",{fresh:true,collection:"commons"});
    assert.equal(result.results.length,2);
    assert.equal(result.videoCoverage.youtubeApi,false);
    assert.equal(result.videoCoverage.webIndex,false);
    assert.equal(result.results[0].platform,"Wikimedia Commons");
  }finally{
    globalThis.fetch=before;
    if(brave===undefined)delete process.env.BRAVE_SEARCH_API_KEY;else process.env.BRAVE_SEARCH_API_KEY=brave;
    if(google===undefined)delete process.env.GOOGLE_SEARCH_API_KEY;else process.env.GOOGLE_SEARCH_API_KEY=google;
    if(cx===undefined)delete process.env.GOOGLE_SEARCH_ENGINE_ID;else process.env.GOOGLE_SEARCH_ENGINE_ID=cx;
    if(yt===undefined)delete process.env.YOUTUBE_DATA_API_KEY;else process.env.YOUTUBE_DATA_API_KEY=yt;
  }
});
