import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  createWorkspace,filterWorkspaceEntries,asComparisonMarkdown
} from "../public/workspace.js";

function storage(){const values=new Map();return {
  getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value)
};}
const one={title:"Energía solar en México",url:"https://research.example.org/solar",
  source:"Universidad pública",snippet:"Reporte original con resultados y datos reales.",
  evidenceKind:"source_excerpt",fetchedAt:"2026-09-24T05:00:00.000Z",
  date:"2026-09-22"};
const two={title:"Análisis económico",url:"https://news.example.org/economia",
  source:"Prensa",snippet:"Resumen indexado por el motor de búsqueda.",
  evidenceKind:"search_snippet",date:"2026-09-20"};
test("filters find saved sources by accents, words, text and kind locally",()=>{
  const entries=[one,two];
  assert.deepEqual(filterWorkspaceEntries(entries,"energia mexico"),[one]);
  assert.deepEqual(filterWorkspaceEntries(entries,"universidad datos"),[one]);
  assert.deepEqual(filterWorkspaceEntries(entries,"  ECONÓMICO  "),[two]);
  assert.deepEqual(filterWorkspaceEntries(entries,"sin coincidencia"),[]);
  assert.deepEqual(filterWorkspaceEntries(entries,"","source_excerpt"),[one]);
  assert.deepEqual(filterWorkspaceEntries(entries,"","search_snippet"),[two]);
  assert.deepEqual(filterWorkspaceEntries(entries,"","all"),entries);
  assert.deepEqual(filterWorkspaceEntries(null,"sol"),[]);
});
test("comparison exports exactly two attributed records without invented synthesis",()=>{
  const text=asComparisonMarkdown([one,two]);
  assert.match(text,/Comparación documental WAE WEB/);
  assert.match(text,/Fuente 1: Energía solar en México/);
  assert.match(text,/Fuente 2: Análisis económico/);
  assert.match(text,/https:\/\/research\.example\.org\/solar/);
  assert.match(text,/https:\/\/news\.example\.org\/economia/);
  assert.match(text,/Extracto recuperado de la página original/);
  assert.match(text,/Fragmento del resultado de búsqueda/);
  assert.match(text,/2026-09-24T05:00:00.000Z/);
  assert.match(text,/No determina si sus afirmaciones son verdaderas/);
  assert.throws(()=>asComparisonMarkdown([one]),/dos fuentes/);
  assert.throws(()=>asComparisonMarkdown([one,{...two,url:"javascript:alert(1)"}]),/no válida/);
});
test("compare is compatible with saved library records and preserved provenance",()=>{
  const library=createWorkspace(storage());
  library.add(two);
  library.capture(one);
  const exported=asComparisonMarkdown(library.list());
  assert.match(exported,/Reporte original con resultados/);
  assert.match(exported,/Resumen indexado por el motor/);
});
test("native comparison and filter UI stay within existing library dialog",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
  assert.match(html,/id="library-search"/);
  assert.match(html,/id="library-kind"/);
  assert.match(html,/id="library-compare"/);
  assert.match(app,/filterWorkspaceEntries\(entries,/);
  assert.match(app,/function drawLibraryComparison\(entries\)/);
  assert.match(app,/asComparisonMarkdown\(selected\)/);
  assert.match(app,/comparedLibraryUrls\.size<2/);
  assert.match(app,/selected\?"✓ Seleccionado":"▤ Comparar"/);
  assert.match(app,/aria-pressed/);
  assert.match(app,/byId\("library-search"\)\.addEventListener\("input", drawLibrary\)/);
  assert.match(app,/byId\("library-kind"\)\.addEventListener\("change", drawLibrary\)/);
  assert.match(css,/\.wae-library-compare-grid/);
  assert.match(css,/\.wae-library-compare\[hidden\]\{display:none!important\}/);
  assert.doesNotMatch(app,/fetch\("\/api\/library\/compare/);
});
