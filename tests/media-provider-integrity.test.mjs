import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {search} from "../server/search.mjs";
import {handler} from "../server/index.mjs";

const KEYS=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_SEARCH_ENGINE_ID","YOUTUBE_DATA_API_KEY"];
async function withoutIndexes(callback){
  const saved=KEYS.map(k=>process.env[k]);
  const old=globalThis.fetch;
  KEYS.forEach(k=>delete process.env[k]);
  try{return await callback();}
  finally{
    globalThis.fetch=old;
    KEYS.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];});
  }
}
test("default search returns attributed Wikipedia and Wikimedia even without a paid index",async()=>{
  await withoutIndexes(async()=>{
    const seen=[];
    globalThis.fetch=async input=>{
      const u=new URL(input);seen.push(u.hostname);
      if(u.hostname==="es.wikipedia.org")return new Response(JSON.stringify({
        query:{search:[{title:"Inteligencia artificial",pageid:321,snippet:"Conocimiento público"}]}}),{status:200});
      if(u.hostname==="commons.wikimedia.org"){
        const video=u.searchParams.get("gsrsearch")?.startsWith("filetype:video ");
        return new Response(JSON.stringify({query:{pages:video
          ?{"1":{title:"File:AI.webm",imageinfo:[{mime:"video/webm",descriptionurl:"https://commons.wikimedia.org/wiki/File:AI.webm",url:"https://upload.wikimedia.org/ai.webm"}]}}
          :{"2":{title:"File:AI.jpg",imageinfo:[{mime:"image/jpeg",descriptionurl:"https://commons.wikimedia.org/wiki/File:AI.jpg",thumburl:"https://upload.wikimedia.org/ai.jpg"}]}}
        }}),{status:200});
      }
      throw Error("Other source unavailable");
    };
    const web=await search("inteligencia artificial","all",{fresh:true});
    assert.equal(web.results.length,1);
    assert.equal(web.results[0].source,"Wikipedia");
    assert.equal(web.results[0].pageId,321);
    assert.equal(web.webCoverage,"specialized");
    const videos=await search("inteligencia artificial","videos",{fresh:true});
    assert.equal(videos.results.length,1);
    assert.equal(videos.results[0].source,"Wikimedia Commons · Video");
    assert.equal(videos.results[0].platform,"Wikimedia Commons");
    assert.equal(videos.mediaCollection,"web");
    const images=await search("inteligencia artificial","images",{fresh:true});
    assert.equal(images.results.length,1);
    assert.equal(images.results[0].source,"Wikimedia Commons");
    assert.ok(seen.includes("commons.wikimedia.org"));
  });
});
test("archive-only filter remains available alongside federated default results",async()=>{
  await withoutIndexes(async()=>{
    const seen=[];
    globalThis.fetch=async url=>{
      const u=new URL(url);
      seen.push(u.hostname);
      assert.equal(u.hostname,"commons.wikimedia.org");
      if(u.searchParams.get("gsrsearch")?.startsWith("filetype:video "))
        return new Response(JSON.stringify({query:{pages:{
          "1":{title:"File:Real.webm",imageinfo:[{mime:"video/webm",
            descriptionurl:"https://commons.wikimedia.org/wiki/File:Real.webm",url:"https://upload.wikimedia.org/real.webm"}]}
        }}}),{status:200});
      return new Response(JSON.stringify({query:{pages:{
        "2":{title:"File:Photo.jpg",imageinfo:[{mime:"image/jpeg",
          descriptionurl:"https://commons.wikimedia.org/wiki/File:Photo.jpg",thumburl:"https://upload.wikimedia.org/photo.jpg"}]}
      }}}),{status:200});
    };
    const videos=await search("wae-real-video-archive","videos",{collection:"commons",fresh:true});
    assert.equal(videos.results.length,1);
    assert.equal(videos.results[0].platform,"Wikimedia Commons");
    assert.equal(videos.mediaCollection,"commons");
    assert.equal(videos.videoCoverage.youtubeApi,false);
    const images=await search("wae-real-image-archive","images",{collection:"commons",fresh:true});
    assert.equal(images.results.length,1);
    assert.equal(images.mediaCollection,"commons");
    assert.deepEqual(seen,["commons.wikimedia.org","commons.wikimedia.org"]);
    assert.match((await search("foo bar","all",{collection:"commons"})).error,/Colección/);
  });
});
test("public media API rejects archive misuse and returns honest zero video results",async()=>{
  await withoutIndexes(async()=>{
    const nativeFetch=globalThis.fetch;
    globalThis.fetch=()=>{throw Error("Unexpected public provider request");};
    const server=http.createServer((req,res)=>handler(req,res).catch(error=>{
      res.statusCode=500;res.end(error.message);
    }));
    try{
      await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
      const base="http://127.0.0.1:"+server.address().port;
      const result=await nativeFetch(base+"/api/search?q=YouTube&type=videos");
      assert.equal(result.status,200);
      const json=await result.json();
      assert.equal(json.results.length,0);
      assert.equal(json.mediaCollection,"web");
      assert.equal(json.videoCoverage.webIndex,false);
      const bad=await nativeFetch(base+"/api/search?q=YouTube&type=all&collection=commons");
      assert.equal(bad.status,400);
    }finally{if(server.listening)await new Promise(resolve=>server.close(resolve));}
  });
});
test("search UI separates open archive from platform search, including history and empty state",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/Wikimedia Commons/);
  assert.match(app,/Todos los resultados/);
  assert.match(app,/collection=commons/);
  assert.match(app,/state\.results\.some\(item=>safeUrl\(item\.url\)&&safeUrl\(item\.image\)\)/);
  assert.doesNotMatch(app,/Sin índice general de imágenes/);
});
