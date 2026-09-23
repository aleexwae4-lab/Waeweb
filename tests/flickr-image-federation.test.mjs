import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {flickrPublicImages,flickrTags} from "../server/flickr-images.mjs";
import {search} from "../server/search.mjs";

test("Flickr public feed only returns genuine linked photos with matching tags and no assumed license",async()=>{
  const old=globalThis.fetch;
  const requested=[];
  globalThis.fetch=async input=>{
    const u=new URL(input);requested.push(u.hostname);
    assert.equal(u.hostname,"www.flickr.com");
    assert.equal(u.pathname,"/services/feeds/photos_public.gne");
    assert.equal(u.searchParams.get("format"),"json");
    assert.equal(u.searchParams.get("nojsoncallback"),"1");
    assert.equal(u.searchParams.get("tags"),"bolsas,dama");
    return new Response(JSON.stringify({items:[
      {title:"Bolsa de dama elegante",tags:"bolsas dama azul",
        link:"https://www.flickr.com/photos/artist/12345678/",
        author:"author (Ejemplo)",media:{m:"https://live.staticflickr.com/100/bolsa_m.jpg"}},
      {title:"No corresponde",tags:"flores verdes",
        link:"https://www.flickr.com/photos/artist/12345679/",
        media:{m:"https://live.staticflickr.com/100/flowers_m.jpg"}},
      {title:"Sitio falso",tags:"bolsas dama",
        link:"https://www.flickr.com.evil.org/photos/artist/12345680/",
        media:{m:"https://live.staticflickr.com/100/fake_m.jpg"}},
      {title:"JS photo",tags:"bolsas dama",
        link:"javascript:alert(1)",media:{m:"https://live.staticflickr.com/100/js_m.jpg"}}
    ]}),{status:200});
  };
  try{
    assert.deepEqual(flickrTags("bolsas para dama"),["bolsas","dama"]);
    const images=await flickrPublicImages("bolsas para dama");
    assert.equal(images.length,1);
    assert.equal(images[0].url,"https://www.flickr.com/photos/artist/12345678/");
    assert.equal(images[0].image,"https://live.staticflickr.com/100/bolsa_m.jpg");
    assert.equal(images[0].source,"Flickr · fotos públicas");
    assert.equal(images[0].license,null);
    assert.equal(images[0].fullImage,null);
    assert.deepEqual(requested,["www.flickr.com"]);
  }finally{globalThis.fetch=old;}
});

test("Flickr joins normal gallery but never falsely claims Pinterest or an unrestricted license",async()=>{
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_SEARCH_ENGINE_ID","WAE_SEARXNG_URL"];
  const saved=keys.map(k=>process.env[k]),old=globalThis.fetch;
  keys.forEach(k=>delete process.env[k]);
  globalThis.fetch=async input=>{
    const u=new URL(input);
    if(u.hostname==="www.flickr.com")return new Response(JSON.stringify({items:[
      {title:"Gato doméstico",tags:"gato gatos cat",
        link:"https://www.flickr.com/photos/photographer/123456789/",
        media:{m:"https://live.staticflickr.com/one/cat_m.jpg"}}
    ]}),{status:200});
    throw Error("Other catalogs unavailable");
  };
  try{
    const result=await search("gato fotografía","images",{fresh:true});
    assert.equal(result.results.length,1);
    assert.equal(result.results[0].source,"Flickr · fotos públicas");
    assert.equal(result.results[0].imagePlatform,undefined);
    assert.equal(result.imageDiscovery.pinterest.hits,0);
    assert.equal(result.mediaCoverage.flickrAvailable,true);
    assert.equal(result.mediaCoverage.webIndex,false);
  }finally{
    globalThis.fetch=old;
    keys.forEach((k,i)=>saved[i]===undefined?delete process.env[k]:process.env[k]=saved[i]);
  }
});
test("Flickr API failure is honestly represented rather than replaced by a fake pin",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async()=>new Response("Temporary outage",{status:503});
  try{await assert.rejects(flickrPublicImages("gato"),/flickr_feed_status_503/);}
  finally{globalThis.fetch=old;}
});
test("Flickr is in the same normal gallery, not a separate redirect or Pinterest surrogate",()=>{
  const code=readFileSync(new URL("../server/search.mjs",import.meta.url),"utf8");
  assert.match(code,/Flickr · fotos públicas",\(\)=>flickrPublicImages\(q\)/);
  assert.match(code,/flickrAvailable:available\.includes\("Flickr · fotos públicas"\)/);
});
