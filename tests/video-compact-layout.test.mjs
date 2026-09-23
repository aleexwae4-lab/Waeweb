import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
const start=app.indexOf("function renderCompactVideo(item,index)");
const end=app.indexOf("function renderResult(item, index)",start);
const compact=app.slice(start,end);
test("all video results use compact purpose-built cards before generic source renderer",()=>{
  assert.ok(start>0&&end>start);
  assert.match(app,/if\(state\.type==="videos"\)return renderCompactVideo\(item,index\);/);
  assert.match(app,/state\.type==="videos"\?element\("div","video-results-grid"\)/);
  assert.match(app,/resultsContainer\.append\(cards\)/);
  assert.doesNotMatch(compact,/source-row|source-avatar|source-url|media-context/);
});
test("video card has a single visual preview and one compact action row",()=>{
  assert.match(compact,/const preview=playable\?button/);
  assert.match(compact,/video-compact-thumb/);
  assert.match(compact,/video-compact-overlay/);
  assert.match(compact,/const head=element\("div","video-compact-head"\)/);
  assert.match(compact,/const bar=element\("div","video-compact-bar"\)/);
  assert.match(compact,/const more=element\("details","video-compact-more"\)/);
  assert.match(compact,/const origin=external\(url,"↗ Fuente original"/);
  assert.doesNotMatch(compact,/Vídeo reproducible dentro de WAE WEB|Explorar vídeo|Abrir sitio original/);
});
test("player is mounted only after explicit playback and stops old video when another starts",()=>{
  assert.match(compact,/function startPlayback\(\)/);
  assert.match(compact,/stopInlineVideo\(\);\s+if\(already\)return;/);
  assert.match(compact,/player\.src=item\.mediaUrl/);
  assert.match(compact,/createYoutubeFrame\(item\.videoId,item\.title\)/);
  assert.match(compact,/createPlatformVideoFrame\(item\)/);
  assert.match(compact,/frame\.replaceChildren\(player\)/);
  assert.match(compact,/activeVideoReset=reset/);
  assert.match(app,/const reset=activeVideoReset;\s+activeVideoReset=null;\s+reset\?\.\(\)/);
  assert.match(compact,/if\(already\)return/);
  assert.match(compact,/const close=button\("✕ Cerrar vídeo",\(\)=>stopInlineVideo\(\)/);
});
test("mobile cards clamp title, preserve aspect ratio and hide secondary actions",()=>{
  assert.match(css,/\.video-results-grid\{display:grid/);
  assert.match(css,/\.video-card-compact \.video-compact-title\{display:-webkit-box;-webkit-line-clamp:2/);
  assert.match(css,/\.video-card-compact \.video-compact-preview\{[^}]*aspect-ratio:16\/9/);
  assert.match(css,/\.video-card-compact \.video-compact-options/);
  assert.match(css,/@media\(max-width:600px\)\{\s*\.video-results-grid\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/\.video-card-compact \.video-compact-player iframe,[^{]*\{[^}]*aspect-ratio:16\/9/);
  assert.match(css,/\.video-results-grid \.video-card-compact\.is-playing\{grid-column:1\/-1/);
});
