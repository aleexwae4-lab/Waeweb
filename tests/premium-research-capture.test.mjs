import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createWorkspace,asMarkdown} from "../public/workspace.js";

function memoryStore(){
  const rows=new Map();
  return {getItem:key=>rows.get(key)||null,setItem:(key,value)=>rows.set(key,value)};
}
const original={
  title:"Documento fuente",url:"https://research.example.org/paper",
  source:"Institución",date:"2026-09-23",snippet:"Extracto original recuperado con evidencia y procedencia verificable.",
  evidenceKind:"source_excerpt",fetchedAt:"2026-09-24T06:45:00.000Z"
};

test("source capture upgrades a saved search result without duplicating it",()=>{
  const library=createWorkspace(memoryStore());
  assert.equal(library.add({...original,snippet:"Resultado de búsqueda inicial.",evidenceKind:undefined}).ok,true);
  const first=library.list()[0];
  assert.equal(first.evidenceKind,"search_snippet");
  const outcome=library.capture(original);
  assert.equal(outcome.ok,true);
  assert.equal(outcome.updated,true);
  assert.equal(outcome.persisted,true);
  assert.equal(library.count(),1);
  assert.equal(library.list()[0].savedAt,first.savedAt);
  assert.equal(library.list()[0].evidenceKind,"source_excerpt");
  assert.equal(library.list()[0].snippet,original.snippet);
  assert.equal(library.list()[0].fetchedAt,original.fetchedAt);
});

test("capture refuses missing or mislabelled body, and normal add preserves old duplicate semantics",()=>{
  const library=createWorkspace(memoryStore());
  for(const entry of [
    {...original,snippet:""},
    {...original,snippet:"Short"},
    {...original,evidenceKind:"search_snippet"}
  ]){
    assert.equal(library.capture(entry).ok,false);
    assert.equal(library.count(),0);
  }
  assert.equal(library.capture(original).updated,false);
  assert.equal(library.add({...original,snippet:"Search snippet",evidenceKind:undefined}).duplicate,true);
  assert.equal(library.list()[0].snippet,original.snippet);
});

test("original extract stays capped and attribution survives Markdown export",()=>{
  const library=createWorkspace(memoryStore());
  const long={...original,snippet:"Fuente ".repeat(500)};
  assert.equal(library.capture(long).ok,true);
  assert.equal(library.list()[0].snippet.length,1200);
  const markdown=asMarkdown(library.list());
  assert.match(markdown,/Extracto recuperado de la página original/);
  assert.match(markdown,/Recuperado: 2026-09-24T06:45:00.000Z/);
  assert.match(markdown,/https:\/\/research.example.org\/paper/);
  assert.match(markdown,/Institución/);
  assert.doesNotMatch(markdown,/Texto completo verificado/);
});

test("storage refusal never claims persistence",()=>{
  const library=createWorkspace({getItem(){throw Error("blocked");},
    setItem(){throw Error("blocked");}});
  const saved=library.capture(original);
  assert.equal(saved.ok,true);
  assert.equal(saved.persisted,false);
  assert.equal(library.count(),1);
});

test("both source-backed readers capture after verified preview with compact controls",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const information=app.slice(app.indexOf("function renderInformationCard(item,index)"),
    app.indexOf("function createWebSourceReader(item,url)"));
  const web=app.slice(app.indexOf("function createWebSourceReader(item,url)"),
    app.indexOf("function renderResult(item, index)"));
  for(const reader of [information,web]){
    assert.match(reader,/data\.kind!=="source_excerpt"/);
    assert.match(reader,/workspace\.capture\(/);
    assert.match(reader,/evidenceKind:"source_excerpt",fetchedAt:data\.fetchedAt/);
    assert.match(reader,/◇ Guardar extracto/);
    assert.match(reader,/saved\.persisted===false/);
    assert.match(reader,/refreshLibraryCount\(\)/);
  }
});
