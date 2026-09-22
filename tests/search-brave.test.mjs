import test from "node:test";
import assert from "node:assert/strict";
import {braveSearch} from "../server/search.mjs";

test("Brave index is optional and never calls a provider without a server token",async()=>{
  const previous=process.env.BRAVE_SEARCH_API_KEY,original=globalThis.fetch;
  try{
    delete process.env.BRAVE_SEARCH_API_KEY;
    globalThis.fetch=()=>{throw Error("unexpected request");};
    assert.equal(await braveSearch("WAEWEB"),null);
  }finally{
    if(previous===undefined)delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY=previous;
    globalThis.fetch=original;
  }
});

test("Brave general web results are attributed and filter unsafe links",async()=>{
  const previous=process.env.BRAVE_SEARCH_API_KEY,original=globalThis.fetch;
  try{
    process.env.BRAVE_SEARCH_API_KEY="private-server-test-token";
    globalThis.fetch=async(url,options)=>{
      const u=new URL(url);
      assert.equal(u.hostname,"api.search.brave.com");
      assert.equal(u.pathname,"/res/v1/web/search");
      assert.equal(u.searchParams.get("country"),"MX");
      assert.equal(options.headers["x-subscription-token"],"private-server-test-token");
      assert.equal(u.searchParams.has("key"),false);
      return new Response(JSON.stringify({web:{results:[
        {title:"WAEWEB principal",url:"https://example.org/wae",description:"Resultado web genuino"},
        {title:"Inseguro",url:"javascript:alert(1)",description:"rechazar"}
      ]}}),{status:200});
    };
    const found=await braveSearch("WAEWEB");
    assert.equal(found.length,1);
    assert.equal(found[0].source,"Brave Search");
    assert.equal(found[0].url,"https://example.org/wae");
  }finally{
    if(previous===undefined)delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY=previous;
    globalThis.fetch=original;
  }
});

test("Brave image results require a real image URL and source page",async()=>{
  const previous=process.env.BRAVE_SEARCH_API_KEY,original=globalThis.fetch;
  try{
    process.env.BRAVE_SEARCH_API_KEY="private-server-test-token";
    globalThis.fetch=async(url)=>{
      assert.equal(new URL(url).pathname,"/res/v1/images/search");
      return new Response(JSON.stringify({results:[
        {title:"Imagen",url:"https://example.org/page",thumbnail:{src:"https://example.org/cover.jpg"}},
        {title:"Sin imagen",url:"https://example.org/missing",thumbnail:{}}
      ]}),{status:200});
    };
    const found=await braveSearch("WAEWEB imagen","images");
    assert.equal(found.length,1);
    assert.equal(found[0].image,"https://example.org/cover.jpg");
  }finally{
    if(previous===undefined)delete process.env.BRAVE_SEARCH_API_KEY;
    else process.env.BRAVE_SEARCH_API_KEY=previous;
    globalThis.fetch=original;
  }
});
