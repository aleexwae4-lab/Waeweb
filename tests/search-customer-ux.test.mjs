import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");

test("regular web and media SERPs prioritize retrieved results, not competitor exits",()=>{
  const start=app.indexOf("function renderData(data)");
  const end=app.indexOf("// Pull an actual subsequent page",start);
  assert.ok(start>=0&&end>start);
  const results=app.slice(start,end);
  assert.doesNotMatch(results,/Cobertura de plataformas limitada/);
  assert.doesNotMatch(results,/Buscar en YouTube|Buscar en TikTok|↗ Google|↗ Bing/);
  assert.match(results,/Wikimedia Commons/);
  assert.match(results,/state\.mediaCollection==="commons"/);
  assert.match(results,/displayed\.forEach/);
});

test("technical source details are opt-in and the empty state stays inside WAE WEB",()=>{
  assert.match(app,/element\("details", "panel"\)/);
  assert.match(app,/element\("summary", "", "Fuentes y detalles de la consulta"\)/);
  const start=app.indexOf("function renderSearchFallback(query,message)");
  const end=app.indexOf("async function renderWeather",start);
  assert.ok(start>=0&&end>start);
  const fallback=app.slice(start,end);
  assert.match(fallback,/↻ Reintentar/);
  assert.match(fallback,/performSearch\(query,state\.type,false,state\.mediaCollection\)/);
  assert.doesNotMatch(fallback,/https?:\/\//);
});
