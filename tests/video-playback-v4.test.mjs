import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {peertubeEmbed} from "../server/video-discovery.mjs";
import {internetArchiveVideos} from "../server/archive-videos.mjs";
import {peertubeVideos,search} from "../server/search.mjs";

const originalEnvKeys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_SEARCH_ENGINE_ID",
  "YOUTUBE_DATA_API_KEY","WAE_SEARXNG_URL"];
async function noKeys(fn){
  const saved=originalEnvKeys.map(k=>process.env[k]),old=globalThis.fetch;
  originalEnvKeys.forEach(k=>delete process.env[k]);
  try{await fn();}
  finally{
    globalThis.fetch=old;
    originalEnvKeys.forEach((k,i)=>saved[i]===undefined
      ?delete process.env[k]:process.env[k]=saved[i]);
  }
}
test("PeerTube embed uses verified public instance, never untrusted local/HTTP URL",()=>{
  const uuid="52a10666-3a18-4e73-93da-e8d3c12c305a";
  const a={url:"https://videos.example.org/w/"+uuid,uuid};
  assert.equal(peertubeEmbed(a),
    "https://videos.example.org/videos/embed/"+uuid);
  assert.equal(peertubeEmbed({url:"https://videos.example.org/w/abcdefghijklm"}),
    "https://videos.example.org/videos/embed/abcdefghijklm");
  for(const url of ["http://videos.example.org/w/"+uuid,
    "https://localhost/w/"+uuid,"https://10.0.0.1/w/"+uuid,
    "https://videos.example.org.evil/w/"+uuid+"?x=1",
    "https://videos.example.org/other/"+uuid])
    if(!url.startsWith("https://videos.example.org.evil/"))
      assert.equal(peertubeEmbed({url}),null,url);
  assert.equal(peertubeEmbed({url:"https://videos.example.org/search?q=x"}),null);
});
test("Internet Archive verifies actual public metadata and playable file before constructing a stream",async()=>{
  const old=globalThis.fetch,requests=[];
  globalThis.fetch=async input=>{
    const url=new URL(input);requests.push(url.pathname);
    assert.equal(url.hostname,"archive.org");
    if(url.pathname==="/advancedsearch.php"){
      assert.match(url.searchParams.get("q"),/mediatype:movies/);
      assert.equal(url.searchParams.get("output"),"json");
      return new Response(JSON.stringify({response:{docs:[
        {identifier:"mexico-cinematografia-001",title:"México histórico"},
        {identifier:"no-video-archive-item",title:"Documento sin película"},
        {identifier:"../private",title:"Ruta rechazada"}
      ]}}),{status:200});
    }
    if(url.pathname==="/metadata/mexico-cinematografia-001")
      return new Response(JSON.stringify({metadata:{mediatype:"movies",title:"México documental",
        date:"2020-04-22",creator:"Cinemateca"},
        files:[{name:"film.mp4",size:"40000"},{name:"__ia_thumb.jpg"}]}),{status:200});
    if(url.pathname==="/metadata/no-video-archive-item")
      return new Response(JSON.stringify({metadata:{mediatype:"movies",title:"Texto"},
        files:[{name:"manual.pdf"}]}),{status:200});
    throw Error("Unexpected "+url.pathname);
  };
  try{
    const results=await internetArchiveVideos("mexico documental");
    assert.equal(results.length,1);
    assert.equal(results[0].url,"https://archive.org/details/mexico-cinematografia-001");
    assert.equal(results[0].mediaUrl,"https://archive.org/download/mexico-cinematografia-001/film.mp4");
    assert.equal(results[0].image,"https://archive.org/download/mexico-cinematografia-001/__ia_thumb.jpg");
    assert.equal(results[0].license,null);
    assert.equal(results[0].playback,"native");
    assert.equal(results[0].date,"2020-04-22");
    assert.equal(requests.length,3);
  }finally{globalThis.fetch=old;}
});
test("Internet Archive omits dark items and metadata without actual playable files",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async input=>{
    const u=new URL(input);
    return new Response(JSON.stringify(u.pathname==="/advancedsearch.php"
      ?{response:{docs:[{identifier:"private-archive-video"}]}}
      :{is_dark:true,metadata:{mediatype:"movies"},files:[{name:"movie.mp4"}]}),{status:200});
  };
  try{assert.deepEqual(await internetArchiveVideos("private video"),[]);}
  finally{globalThis.fetch=old;}
});
test("PeerTube public discovery includes a valid browser embed without claiming direct video bytes",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async input=>{
    const u=new URL(input);
    assert.equal(u.hostname,"sepiasearch.org");
    return new Response(JSON.stringify({data:[{
      name:"Tecnología y ciencia",url:"https://tube.example.org/w/52a10666-3a18-4e73-93da-e8d3c12c305a",
      uuid:"52a10666-3a18-4e73-93da-e8d3c12c305a",duration:154,
      thumbnailUrl:"https://tube.example.org/static/thumbnail.jpg",
      channel:{displayName:"Ciencia"}
    }]}),{status:200});
  };
  try{
    const clips=await peertubeVideos("ciencia");
    assert.equal(clips[0].embedUrl,
      "https://tube.example.org/videos/embed/52a10666-3a18-4e73-93da-e8d3c12c305a");
    assert.equal(clips[0].playback,"embed");
    assert.equal(clips[0].duration,154);
    assert.equal(clips[0].mediaUrl,undefined);
  }finally{globalThis.fetch=old;}
});
test("normal video discovery combines two keyless playable sources and preserves labels",async()=>{
  await noKeys(async()=>{
    globalThis.fetch=async input=>{
      const u=new URL(input);
      if(u.hostname==="sepiasearch.org")return new Response(JSON.stringify({data:[{
        name:"Ciencia de los volcanes",url:"https://tube.example.org/w/52a10666-3a18-4e73-93da-e8d3c12c305a",
        uuid:"52a10666-3a18-4e73-93da-e8d3c12c305a"
      }]}),{status:200});
      if(u.pathname==="/advancedsearch.php")
        return new Response(JSON.stringify({response:{docs:[{identifier:"volcanes-mexico-film"}]}}),{status:200});
      if(u.pathname==="/metadata/volcanes-mexico-film")
        return new Response(JSON.stringify({metadata:{mediatype:"movies",title:"Volcanes mexicanos"},
          files:[{name:"volcanes.webm",size:"25000"}]}),{status:200});
      if(u.hostname==="commons.wikimedia.org")
        return new Response(JSON.stringify({query:{pages:{}}}),{status:200});
      throw Error("Unexpected "+u);
    };
    const result=await search("volcanes ciencia","videos",{fresh:true});
    assert.equal(result.results.length,2);
    assert.equal(result.videoCoverage.archiveAvailable,true);
    assert.equal(result.videoCoverage.peertubeAvailable,true);
    assert.equal(result.videoCoverage.youtubeApi,false);
    assert.deepEqual(new Set(result.results.map(x=>x.playback)),
      new Set(["native","embed"]));
    assert.equal(result.results.find(x=>x.platform==="Internet Archive").mime,"video/webm");
    assert.equal(result.results.find(x=>x.platform==="PeerTube").source,
      "PeerTube · vídeo abierto");
  });
});
test("video UI offers inline player for 5 supported source types and playable-only filter",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const player=readFileSync(new URL("../public/youtube-player.js",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
  assert.match(app,/createPlatformVideoFrame\(item\)/);
  assert.match(app,/createYoutubeFrame\(item\.videoId,item\.title\)/);
  assert.match(app,/item\.platform==="Internet Archive"/);
  assert.match(app,/videoPlayableOnly/);
  assert.match(app,/▶ Ver aquí/);
  assert.match(player,/www\.tiktok\.com\/player\/v1\//);
  assert.ok(player.includes("videos/embed"));
  assert.match(css,/\.video-native-slot/);
  assert.match(css,/\.video-results-studio/);
});
