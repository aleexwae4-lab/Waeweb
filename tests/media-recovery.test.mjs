import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {openverseImages,peertubeVideos,search} from "../server/search.mjs";

const INDEX_KEYS=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_SEARCH_ENGINE_ID","YOUTUBE_DATA_API_KEY"];
async function noPaidIndex(run){
  const saved=INDEX_KEYS.map(k=>process.env[k]);
  const original=globalThis.fetch;
  INDEX_KEYS.forEach(k=>delete process.env[k]);
  try{await run();}
  finally{
    globalThis.fetch=original;
    INDEX_KEYS.forEach((k,i)=>saved[i]===undefined?delete process.env[k]:process.env[k]=saved[i]);
  }
}
test("keyless Openverse offers genuine non-Wikimedia images with attributed originals",async()=>{
  await noPaidIndex(async()=>{
    const hosts=[];
    globalThis.fetch=async input=>{
      const u=new URL(input);hosts.push(u.hostname);
      assert.equal(u.hostname,"api.openverse.org");
      assert.equal(u.pathname,"/v1/images/");
      return new Response(JSON.stringify({results:[
        {title:"Gato blanco",foreign_landing_url:"https://www.flickr.com/photos/user/123",
          thumbnail:"https://live.staticflickr.com/1/123.jpg",source:"flickr",
          creator:"Foto Ejemplo",license:"by"},
        {title:"Archivo Commons",foreign_landing_url:"https://commons.wikimedia.org/wiki/File:Cat.jpg",
          thumbnail:"https://upload.wikimedia.org/example.jpg",source:"wikimedia"}
      ]}),{status:200});
    };
    const raw=await openverseImages("gatos");
    assert.equal(raw.length,1);
    assert.equal(raw[0].url,"https://www.flickr.com/photos/user/123");
    assert.match(raw[0].snippet,/Foto Ejemplo/);
    const data=await search("gatos","images",{fresh:true});
    assert.equal(data.results.length,1);
    assert.equal(data.mediaCoverage.openverseAvailable,true);
    assert.equal(data.mediaCoverage.webIndex,false);
    assert.equal(hosts.includes("commons.wikimedia.org"),false);
  });
});
test("keyless PeerTube delivers real videos without claiming they came from YouTube",async()=>{
  await noPaidIndex(async()=>{
    globalThis.fetch=async input=>{
      const u=new URL(input);
      assert.equal(u.hostname,"sepiasearch.org");
      assert.equal(u.pathname,"/api/v1/search/videos");
      return new Response(JSON.stringify({data:[
        {name:"Gatos jugando",url:"https://video.example.org/w/a-real-video",
          thumbnailUrl:"https://video.example.org/lazy-static.jpg",
          channel:{name:"Gatitos"},description:"Gatos reales",publishedAt:"2026-09-01"},
        {name:"No network URL",url:"javascript:alert(1)"}
      ]}),{status:200});
    };
    const raw=await peertubeVideos("gatos");
    assert.equal(raw.length,1);
    assert.equal(raw[0].platform,"PeerTube");
    const data=await search("gatos","videos",{fresh:true});
    assert.equal(data.results.length,1);
    assert.equal(data.results[0].source,"PeerTube · vídeo abierto");
    assert.equal(data.videoCoverage.youtubeApi,false);
    assert.equal(data.videoCoverage.peertubeAvailable,true);
    assert.equal(data.videoCoverage.webIndex,false);
  });
});
test("main web entry does not statically import optional book UI; homepage retains category links",async()=>{
  const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  const html=await readFile(new URL("../public/index.html",import.meta.url),"utf8");
  assert.doesNotMatch(app,/^import .*from "\/book-(?:experience|gallery)\.js";/m);
  assert.match(app,/async function loadBookModules\(/);
  assert.match(app,/type==="books"\?loadBookModules\(\):null/);
  for(const type of ["all","images","videos","knowledge","maps","books"])
    assert.ok(html.includes('href="/?type='+type+'"'),type+" must be accessible directly from hero");
});
