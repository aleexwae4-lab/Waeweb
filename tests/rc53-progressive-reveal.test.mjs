import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const start=app.indexOf('if(state.type==="all" && state.visibleCount<state.results.length){');
const end=app.indexOf('}else if(state.type==="all" && !state.selectedSource && data.hasMore){',start);
const local=app.slice(start,end);

test("revealing already-fetched web results preserves mounted readers and narration",()=>{
  assert.ok(start>0&&end>start,"test must inspect the actual local reveal handler");
  assert.match(local,/const start=state\.visibleCount/);
  assert.match(local,/const end=Math\.min\(start\+10,state\.results\.length\)/);
  assert.match(local,/for\(let index=start;index<end;index\+\+\)/);
  assert.match(local,/const card=renderResult\(state\.results\[index\],index\)/);
  assert.match(local,/resultsContainer\.insertBefore\(card,more\)/);
  assert.doesNotMatch(local,/renderData\(/,
    "renderData clears all previously mounted readers and stops speech");
  assert.doesNotMatch(local,/resultsContainer\.replaceChildren\(/);
  assert.match(app,/function renderData\(data\) \{\s*stopInlineVideo\(\);\s*speechSynthesisSafeCancel\(\)/);
});
test("more button reports accurate incremental counts and retains accessible pagination",()=>{
  assert.match(local,/state\.visibleCount=end/);
  assert.match(local,/stats\.textContent=end===count/);
  assert.match(local,/const left=count-end/);
  assert.match(local,/more\.textContent="Mostrar más resultados \("\+Math\.min\(10,left\)/);
  assert.match(local,/more\.setAttribute\("aria-label","Mostrar "/);
  assert.match(local,/else if\(!state\.selectedSource && state\.data\?\.hasMore\)/);
  assert.match(local,/const next=button\("Buscar más páginas web"/);
  assert.match(local,/more\.replaceWith\(next\)/);
  assert.match(local,/next\.focus\(\{preventScroll:true\}\)/);
  assert.match(local,/lastCard\?\.querySelector\("\.result-title"\)\?\.focus/);
});
