import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
const books=readFileSync(new URL("../public/libros.css",import.meta.url),"utf8");
const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
test("premium search and browser styling shares clear navy and blue design tokens",()=>{
  assert.match(css,/WAEWEB · Premium visual system RC38/);
  assert.match(css,/--wae-accent:#89b9ff/);
  assert.match(css,/\.hero-search,\.results-search/);
  assert.match(css,/\.browser-chrome\{background:#0d1a2d/);
  assert.match(css,/\.result-card:focus-within/);
});
test("mobile controls avoid tiny touch targets and zooming on input focus",()=>{
  assert.match(css,/\.tabs \.tab\{min-height:44px/);
  assert.match(css,/\.search-shell input,\.results-search input\{font-size:16px\}/);
  assert.match(css,/\.browser-form input\{font-size:16px!important\}/);
  assert.match(css,/@media\(max-width:370px\)/);
  assert.match(css,/@media\(prefers-reduced-motion:reduce\)/);
});
test("media, maps and editorial share premium visual hierarchy",()=>{
  assert.match(css,/\.image-lightbox\{background:#081426/);
  assert.match(css,/\.map-explorer\{border-radius:23px/);
  assert.match(css,/\.wae-native-map-controls button\{box-shadow/);
  assert.match(books,/WAEWEB LIBROS · Premium editorial finish/);
  assert.match(books,/\.book-catalog-empty\{background:linear-gradient/);
  assert.match(html,/id="hero-form"/);
  assert.doesNotMatch(html,/href="\/diagnostico\.html"/);
});
