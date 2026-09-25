import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import http from "node:http";
import {handler} from "../server/index.mjs";

const publicFile=name=>readFile(new URL("../public/"+name,import.meta.url),"utf8");

test("RC55 publishes installable shell metadata while release indexing remains intentionally blocked",async()=>{
  const [html,manifest,openSearch,worker,robots]=await Promise.all([
    publicFile("index.html"),publicFile("manifest.webmanifest"),
    publicFile("opensearch.xml"),publicFile("sw.js"),publicFile("robots.txt")
  ]);
  assert.match(html,/rel="canonical" href="https:\/\/waeweb\.onrender\.com\/"/);
  assert.match(html,/rel="manifest" href="\/manifest\.webmanifest"/);
  assert.match(html,/application\/opensearchdescription\+xml/);
  assert.match(html,/application\/ld\+json/);
  assert.match(html,/name="robots" content="noindex,nofollow"/);
  assert.equal(JSON.parse(manifest).display,"standalone");
  assert.match(openSearch,/\{searchTerms\}/);
  assert.match(worker,/url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(robots,/Disallow: \/$/m);
});

test("RC55 static manifest, OpenSearch and service worker are served with strict types",async()=>{
  const worker=await publicFile("sw.js");
  const shellMatch=worker.match(/const SHELL=(\[[\s\S]*?\]);/);
  assert.ok(shellMatch,"service worker shell must remain a literal bounded list");
  const shell=JSON.parse(shellMatch[1]);
  const server=http.createServer(handler);
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+server.address().port;
    for(const [path,type]of [["/manifest.webmanifest","application/manifest+json"],
      ["/opensearch.xml","application/opensearchdescription+xml"],
      ["/sw.js","text/javascript"]]){
      const response=await fetch(base+path);
      assert.equal(response.status,200,path);
      assert.match(response.headers.get("content-type"),new RegExp(type.replace("+","\\+")));
    }
    for(const path of shell){
      assert.ok(!path.startsWith("/api/"),path);
      assert.equal((await fetch(base+path)).status,200,"offline shell "+path);
    }
  }finally{if(server.listening)await new Promise(resolve=>server.close(resolve));}
});

test("RC55 public diagnostics do not render optional providers as configured sources",async()=>{
  const app=await publicFile("app.js");
  assert.match(app,/filter\(source=>!source\.endsWith\(" no configurado"\)\)/);
  assert.doesNotMatch(app,/Google no configurado|Brave no configurado|SearXNG no configurado/);
  assert.match(app,/Los errores técnicos se conservan en la telemetría del servidor/);
});

test("RC55 translator never claims an upstream is connected before a real translation",async()=>{
  const translator=await publicFile("translator.js");
  assert.match(translator,/Traductor WAEWEB · motor automático/);
  assert.match(translator,/Proveedor externo/);
  assert.doesNotMatch(translator,/dispositivo o servicio conectado/);
});
