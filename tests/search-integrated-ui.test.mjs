import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {handler} from "../server/index.mjs";
import http from "node:http";
const root=new URL("../public/",import.meta.url);
const file=path=>readFile(new URL(path,root),"utf8");

test("WAEWEB browser is part of search results, not a standalone page",async()=>{
  const html=await file("index.html");
  const results=html.indexOf('<section id="results-view"');
  const main=html.indexOf('<div class="results-main">',results);
  const browser=html.indexOf('<section id="browser-view"');
  const reader=html.indexOf('<section id="reader-panel"');
  const resultsEnd=html.indexOf('<aside id="knowledge-panel"',results);
  assert.ok(results>=0&&main>results&&browser>main&&reader>browser&&
    resultsEnd>reader);
  assert.equal((html.match(/id="browser-view"/g)||[]).length,1);
  assert.doesNotMatch(html,/id="hero-browser"|<h1>Navegador WAEWEB<\/h1>/);
  assert.match(html,/id="hero-input"[^>]*placeholder="Busca o escribe una URL HTTPS/);
  assert.match(html,/id="results-input"[^>]*placeholder="Busca o escribe una URL HTTPS/);
  assert.match(html,/id="account-unavailable"/);
});

test("both search forms and voice use same router; browser header focuses the search",async()=>{
  const app=await file("app.js"),browser=await file("browser.js");
  assert.match(app,/import \{ classifyOmnibox \} from "\/omnibox\.js"/);
  assert.match(app,/function runOmnibox\(/);
  assert.match(app,/performSearch\(intent\.value,type,push\)/);
  assert.match(app,/runOmnibox\(heroInput\.value\)/);
  assert.match(app,/runOmnibox\(resultsInput\.value, state\.type\)/);
  assert.match(app,/runOmnibox\(event\.results\[0\]\[0\]\.transcript\)/);
  assert.doesNotMatch(browser,/hero-browser|\$\("browser-open"\).*openBrowser\(\)/);
  assert.match(browser,/\$\("results-view"\)\.hidden = false/);
  assert.match(browser,/view\.scrollIntoView/);
  assert.match(browser,/stage\.classList\.toggle\("is-empty"/);
  assert.match(browser,/if \(lastView === "hero"\)/);
});
test("public unauthorized response cannot masquerade as expired vault credential",async()=>{
  const app=await file("app.js");
  assert.match(app,/if \(isPrivate\)\s*\{[\s\S]*?La credencial de tu índice privado/);
  assert.match(app,/La búsqueda pública devolvió HTTP 401/);
  assert.match(app,/if \(type === "index" && !readerEnabled\)/);
  assert.match(app,/if \(type === "all"\) void renderWeather\(q,signal,sequence\)/);
});
test("Node server also serves new search intent module as JavaScript",async()=>{
  const server=http.createServer(handler);
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+server.address().port;
    const response=await fetch(base+"/omnibox.js");
    assert.equal(response.status,200);
    assert.match(response.headers.get("content-type"),/javascript/);
    assert.match(await response.text(),/classifyOmnibox/);
  }finally{if(server.listening)await new Promise(resolve=>server.close(resolve));}
});
