import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { handler } from "../server/index.mjs";

test("Render WAEWEB serves every module/style needed by the native book library",async t=>{
  const server=createServer((req,res)=>{void handler(req,res).catch(error=>{
    if(!res.headersSent)res.writeHead(500,{"content-type":"text/plain"});
    res.end(String(error));
  });});
  server.listen(0,"127.0.0.1");
  await once(server,"listening");
  t.after(()=>new Promise(resolve=>server.close(resolve)));
  const origin="http://127.0.0.1:"+server.address().port;
  for(const [path,contentType,snippet] of [
    ["/","text/html","/book-experience.css"],
    ["/app.js","text/javascript","/book-experience.js"],
    ["/book-experience.js","text/javascript","export function openBookDetail"],
    ["/book-gallery.js","text/javascript","export function renderBookCard"],
    ["/book-experience.css","text/css",".wae-book-dialog"]
  ]){
    const res=await fetch(origin+path);
    assert.equal(res.status,200,path+" must be served rather than silently breaking ES module graph");
    assert.match(res.headers.get("content-type")||"",new RegExp(contentType),path);
    assert.match(await res.text(),new RegExp(snippet.replaceAll(".","\\.")),path);
  }
  const missing=await fetch(origin+"/not-an-asset.js");
  assert.equal(missing.status,404,"the allowlist must not become a wildcard");
  const api=await fetch(origin+"/api/health");
  assert.equal(api.status,200);
  assert.equal(api.headers.get("x-waeweb-api"),"1");
});

test("direct category URLs and history restore WAE Biblioteca without a search query",async()=>{
  const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/window\.addEventListener\("popstate",restoreRoute\)/);
  assert.match(app,/restoreRoute\(\);/);
  assert.match(app,/ROUTABLE_SECTIONS\.has\(type\).*showEmptyCategory\(type,false\)/);
  assert.match(app,/new Set\(\["all","books","knowledge","research","news","images","videos","index"\]\)/);
});
