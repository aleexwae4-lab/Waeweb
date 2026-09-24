import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {handler} from "../server/index.mjs";

async function request(path,method="GET"){
  const server=http.createServer(handler);
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const response=await fetch("http://127.0.0.1:"+server.address().port+path,{method});
    return {status:response.status,api:response.headers.get("x-waeweb-api"),
      body:await response.json()};
  }finally{
    if(server.listening)await new Promise(resolve=>server.close(resolve));
  }
}

test("instant lookup returns actual named destinations without any network provider",async()=>{
  for(const [q,host]of [["GitHub","github.com"],
    ["Mercado Libre","mercadolibre.com.mx"],
    ["Instagram","instagram.com"]]){
    const hit=await request("/api/search?type=all&nav=1&q="+encodeURIComponent(q));
    assert.equal(hit.status,200);
    assert.equal(hit.api,"1");
    assert.equal(hit.body.kind,"named_site_preview");
    assert.equal(new URL(hit.body.site.url).hostname.replace(/^www\./,""),host);
    assert.equal(hit.body.site.siteLink,true);
    assert.equal(hit.body.site.linkBasis,"curated_directory");
    assert.equal(hit.body.scope,"known_named_sites_only");
    assert.equal(hit.body.completeSearch,false);
    assert.ok(!("generalIndexes" in hit.body));
  }
});
test("unknown names and advanced queries never fabricate a web destination",async()=>{
  for(const name of ["an unknown website test","github site:github.com",
    "Github tutorial JavaScript",""]){
    const hit=await request("/api/search?nav=1&q="+encodeURIComponent(name));
    assert.equal(hit.status,200);
    assert.equal(hit.body.site,null,name);
    assert.equal(hit.body.completeSearch,false);
  }
});
test("instant lookup validates query length, parameter and method",async()=>{
  assert.equal((await request("/api/search?nav=2&q=GitHub")).status,400);
  assert.equal((await request("/api/search?nav=1&q="+("a".repeat(181)))).status,400);
  assert.equal((await request("/api/search?nav=1&q=GitHub","POST")).status,405);
});
test("early site UI cannot overwrite a later complete response or another query",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
  assert.match(app,/getJSON\("\/api\/search\?q="\+encodeURIComponent\(q\)\+"&type=all&nav=1",signal\)/);
  assert.match(app,/fullSearchFinished\|\|signal\.aborted\|\|sequence!==state\.sequence/);
  assert.match(app,/preview\.completeSearch!==false/);
  assert.match(app,/resultsContainer\.replaceChildren\(note,card\)/);
  assert.match(app,/fullSearchFinished=true;\s*renderData\(data\)/);
  assert.match(app,/if\(earlySiteShown\)\{/);
  assert.match(css,/\.wae-instant-site-status/);
});
