import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {videoIdentity,verifiedVideoResults,youtubeDataVideos} from "../server/video-discovery.mjs";
import {search} from "../server/search.mjs";
import {handler} from "../server/index.mjs";

test("only real and correctly shaped platform clip URLs are recognized",()=>{
  const id="aB3_-xyZ901";
  assert.deepEqual(videoIdentity("https://youtu.be/"+id+"?si=tracking"),{
    platform:"YouTube",videoId:id,canonical:"https://www.youtube.com/watch?v="+id
  });
  assert.equal(videoIdentity("https://youtube.com/shorts/"+id)?.videoId,id);
  assert.equal(videoIdentity("https://www.youtube.com/watch?v="+id)?.videoId,id);
  assert.equal(videoIdentity("https://www.tiktok.com/@creator/video/7420123456789012345")?.platform,"TikTok");
  for(const url of [
    "https://youtube.com/results?search_query=video",
    "https://www.youtube.com/watch?v=bad",
    "https://youtube.com.evil.example/watch?v="+id,
    "https://tiktok.com/@creator",
    "https://tiktok.evil.example/@creator/video/7420123456789012345",
    "javascript:alert(1)"
  ])assert.equal(videoIdentity(url),null,url);
  assert.equal(verifiedVideoResults([
    {url:"https://youtube.com/watch?v="+id,title:"A"},
    {url:"https://tiktok.com/@a/video/7420123456789012345",title:"B"}
  ],"YouTube").length,1);
});
test("YouTube official discovery is opt-in and uses API supplied title, thumbnail and id",async()=>{
  const old=globalThis.fetch,key=process.env.YOUTUBE_DATA_API_KEY;
  try{
    delete process.env.YOUTUBE_DATA_API_KEY;
    globalThis.fetch=()=>{throw Error("No external call without key");};
    assert.equal(await youtubeDataVideos("motos"),null);
    process.env.YOUTUBE_DATA_API_KEY="test-server-key";
    globalThis.fetch=async url=>{
      const u=new URL(url);
      assert.equal(u.hostname,"www.googleapis.com");
      assert.equal(u.pathname,"/youtube/v3/search");
      assert.equal(u.searchParams.get("type"),"video");
      assert.equal(u.searchParams.get("part"),"snippet");
      assert.equal(u.searchParams.get("regionCode"),"MX");
      assert.equal(u.searchParams.get("key"),"test-server-key");
      return new Response(JSON.stringify({items:[
        {id:{videoId:"aB3_-xyZ901"},snippet:{
          title:"Motos en Jalisco",description:"Clip real",
          channelTitle:"Taller WAE",publishedAt:"2026-09-21T12:00:00Z",
          thumbnails:{medium:{url:"https://i.ytimg.com/vi/aB3_-xyZ901/mqdefault.jpg"}}
        }},
        {id:{videoId:"invalid"},snippet:{title:"No inventar"}}
      ]}),{status:200});
    };
    const items=await youtubeDataVideos("motos");
    assert.equal(items.length,1);
    assert.equal(items[0].platform,"YouTube");
    assert.equal(items[0].videoId,"aB3_-xyZ901");
    assert.equal(items[0].image,"https://i.ytimg.com/vi/aB3_-xyZ901/mqdefault.jpg");
    assert.match(items[0].snippet,/Taller WAE/);
  }finally{
    globalThis.fetch=old;
    if(key===undefined)delete process.env.YOUTUBE_DATA_API_KEY;else process.env.YOUTUBE_DATA_API_KEY=key;
  }
});
test("federated video discovery adds real TikTok and YouTube links without making up search hits",async()=>{
  const old=globalThis.fetch;
  const brave=process.env.BRAVE_SEARCH_API_KEY,google=process.env.GOOGLE_SEARCH_API_KEY,cx=process.env.GOOGLE_SEARCH_ENGINE_ID,yt=process.env.YOUTUBE_DATA_API_KEY;
  try{
    process.env.BRAVE_SEARCH_API_KEY="test-key";
    delete process.env.GOOGLE_SEARCH_API_KEY;
    delete process.env.GOOGLE_SEARCH_ENGINE_ID;
    delete process.env.YOUTUBE_DATA_API_KEY;
    globalThis.fetch=async url=>{
      const u=new URL(url);
      if(u.hostname==="commons.wikimedia.org")
        return new Response(JSON.stringify({query:{pages:{}}}),{status:200});
      if(u.hostname!=="api.search.brave.com")throw Error("Unexpected "+u.hostname);
      const q=u.searchParams.get("q")||"";
      const entries=q.includes("tiktok.com")?
        [{url:"https://www.tiktok.com/@wae/video/7420123456789012345",title:"TikTok motos",description:"Clip",thumbnail:{src:"https://example.org/tiktok.jpg"}}]:
        q.includes("youtube.com")?
        [{url:"https://youtube.com/shorts/aB3_-xyZ901",title:"YouTube Short",description:"Clip",thumbnail:{src:"https://example.org/short.jpg"}},
        {url:"https://youtube.com/results?search_query=motos",title:"No clip"}]:
        [];
      return new Response(JSON.stringify({web:{results:entries},results:entries}),{status:200});
    };
    const data=await search("motos-premium-video-2026","videos",{fresh:true});
    assert.equal(data.results.filter(x=>x.platform==="YouTube").length,1);
    assert.equal(data.results.filter(x=>x.platform==="TikTok").length,1);
    assert.ok(!data.results.some(x=>/results\?search_query=/.test(x.url)));
    assert.ok(data.results.every(x=>x.url.startsWith("https://")));
  }finally{
    globalThis.fetch=old;
    if(brave===undefined)delete process.env.BRAVE_SEARCH_API_KEY;else process.env.BRAVE_SEARCH_API_KEY=brave;
    if(google===undefined)delete process.env.GOOGLE_SEARCH_API_KEY;else process.env.GOOGLE_SEARCH_API_KEY=google;
    if(cx===undefined)delete process.env.GOOGLE_SEARCH_ENGINE_ID;else process.env.GOOGLE_SEARCH_ENGINE_ID=cx;
    if(yt===undefined)delete process.env.YOUTUBE_DATA_API_KEY;else process.env.YOUTUBE_DATA_API_KEY=yt;
  }
});
test("video player stays isolated and loads only on click; server serves module",async()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const player=readFileSync(new URL("../public/youtube-player.js",import.meta.url),"utf8");
  assert.match(app,/createYoutubeFrame\(item\.videoId,item\.title\)/);
  assert.match(app,/▶ Reproducir YouTube aquí/);
  assert.doesNotMatch(app,/https:\/\/www\.tiktok\.com\/search\?q=/);
  assert.match(player,/youtube-nocookie\.com\/embed/);
  assert.match(player,/^[\s\S]*document\.createElement\("iframe"\)/);
  const server=http.createServer((req,res)=>handler(req,res).catch(e=>{res.statusCode=500;res.end(e.message);}));
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const response=await fetch("http://127.0.0.1:"+server.address().port+"/youtube-player.js");
    assert.equal(response.status,200);
    assert.match(response.headers.get("content-type"),/javascript/);
  }finally{if(server.listening)await new Promise(resolve=>server.close(resolve));}
});
