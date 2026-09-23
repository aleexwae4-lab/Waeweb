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
test("video/web/images no longer manufacture relevance from Wikimedia or Wikipedia without indexes",async()=>{
  await withoutIndexes(async()=>{
    globalThis.fetch=()=>{throw Error("An archive must not be queried without explicit consent");};
    for(const [type,q] of [["all","YouTube"],["videos","YouTube"],["images","YouTube"]]){
      const result=await search(q+"-provider-integrity-check",type,{fresh:true});
      assert.deepEqual(result.results,[],type);
      assert.ok(result.sources.every(name=>name.endsWith(" no configurado")),type);
      assert.ok(result.message,type);
    }
  });
});
test("open archive is opt-in and never leaks into general or platform results",async()=>{
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
    globalThis.fetch=()=>{throw Error("Unexpected public provider request");};
    const server=http.createServer((req,res)=>handler(req,res).catch(error=>{
      res.statusCode=500;res.end(error.message);
    }));
    try{
      await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
      const base="http://127.0.0.1:"+server.address().port;
      const result=await fetch(base+"/api/search?q=YouTube&type=videos");
      assert.equal(result.status,200);
      const json=await result.json();
      assert.equal(json.results.length,0);
      assert.equal(json.mediaCollection,"web");
      assert.equal(json.videoCoverage.webIndex,false);
      const bad=await fetch(base+"/api/search?q=YouTube&type=all&collection=commons");
      assert.equal(bad.status,400);
    }finally{if(server.listening)await new Promise(resolve=>server.close(resolve));}
  });
});
test("search UI separates open archive from platform search, including history and empty state",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/Explorar archivo Wikimedia/);
  assert.match(app,/Volver a búsqueda web/);
  assert.match(app,/collection=commons/);
  assert.match(app,/state\.results\.some\(item=>safeUrl\(item\.url\)&&safeUrl\(item\.image\)\)/);
  assert.match(app,/Sin índice general de imágenes/);
});
