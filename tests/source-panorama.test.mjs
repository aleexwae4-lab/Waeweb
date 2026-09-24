import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");

test("research and knowledge display a source-grounded panorama without generated claims",()=>{
  const start=app.indexOf("function renderSummary(data)");
  const end=app.indexOf("function refreshLibraryCount()",start);
  assert.ok(start>0&&end>start);
  const render=app.slice(start,end);
  assert.match(render,/Resumen extractivo construido únicamente con fragmentos devueltos por las fuentes/);
  assert.match(render,/No es una respuesta generada ni una verificación independiente/);
  assert.match(render,/const title=button\(note\.title,\(\)=>openBrowser\(url\)/);
  assert.match(render,/button\("◎ Explorar aquí",\(\)=>openBrowser\(url\)/);
  assert.match(render,/external\(url,"↗ Origen"/);
  assert.match(render,/button\("▶ Escuchar panorama"/);
  assert.match(render,/button\("◇ Guardar fuentes"/);
  assert.match(app,/if \(\["knowledge","research"\]\.includes\(type\)\) renderSummary\(data\)/);
  assert.doesNotMatch(app,/if \(\["all","news"\]\.includes\(type\)\) renderSummary\(data\)/);
});
test("panorama remains compact and becomes single-column on mobile",()=>{
  assert.match(css,/\.wae-source-panorama \.brief-notes\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css,/@media\(max-width:720px\)\{\.wae-source-panorama\{padding:13px 12px\}\.wae-source-panorama \.brief-notes\{grid-template-columns:1fr\}/);
  assert.match(css,/\.wae-panorama-action\{display:inline-flex;align-items:center;min-height:31px/);
});
