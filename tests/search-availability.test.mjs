import test from "node:test";
import assert from "node:assert/strict";
import {search} from "../server/search.mjs";

test("provider outages do not poison search cache; reachable zero hits may cache", async()=>{
  const prior=globalThis.fetch;
  let attempts=0;
  globalThis.fetch=async url=>{
    assert.match(String(url),/openlibrary\.org\/search\.json/);
    attempts++;
    if(attempts===1)throw new Error("simulated temporary source outage");
    return new Response(JSON.stringify({docs:[]}),{
      status:200,headers:{"content-type":"application/json"}
    });
  };
  try{
    const q="waeweb-rc7-cache-outage-retry-fixture";
    const first=await search(q,"books");
    assert.deepEqual(first.failedSources,["Open Library"]);
    assert.deepEqual(first.sources,[]);
    const recovered=await search(q,"books");
    assert.deepEqual(recovered.failedSources,[]);
    assert.deepEqual(recovered.sources,["Open Library"]);
    assert.deepEqual(recovered.results,[]);
    const cached=await search(q,"books");
    assert.deepEqual(cached.results,[]);
    assert.equal(attempts,2,
      "a temporary outage is not cached but a verified zero-result response is");
  }finally{globalThis.fetch=prior;}
});
