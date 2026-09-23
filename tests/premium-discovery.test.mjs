import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {dedupe} from "../server/search.mjs";
import {visibleStreetTiles} from "../public/map-tiles.js";
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
const map=readFileSync(new URL("../public/native-map.js",import.meta.url),"utf8");

test("gallery uses real previews with accessible modal and original source",()=>{
  assert.match(app,/dialog\.showModal\(\)/);
  assert.match(app,/ArrowRight/);
  assert.match(app,/ArrowLeft/);
  assert.match(app,/image-lightbox-source/);
  assert.match(app,/origin\.href=safeUrl\(item\.url\)/);
  assert.match(css,/\.image-lightbox::backdrop/);
});
test("videos and books display truthful media-specific copy",()=>{
  assert.match(app,/Ficha bibliográfica/);
  assert.match(app,/Vídeo · Consulta en la fuente original/);
  assert.match(app,/▷ Vídeo reproducible dentro de WAE WEB/);
  assert.match(app,/▷ Explorar vídeo/);
  assert.doesNotMatch(app,/Comprar ahora/);
});
test("search keeps asynchronous weather and links to category-specific fallbacks",()=>{
  const start=app.indexOf("function renderData(data)");
  const end=app.indexOf("function renderSearchFallback",start);
  assert.ok(start>=0&&end>start);
  assert.doesNotMatch(app.slice(start,end),/weatherSlot\.replaceChildren\(\)/);
  assert.match(app,/youtube\.com\/results\?search_query=/);
  assert.match(app,/books\.google\.com/);
});
test("deduplication ignores tracking but preserves case-sensitive paths",()=>{
  const items=[
    {title:"Uno",url:"https://example.org/Topic?utm_source=a#x"},
    {title:"Uno otra vez",url:"https://example.org/Topic?utm_source=b#y"},
    {title:"Otro",url:"https://example.org/topic"}
  ];
  assert.equal(dedupe(items).length,2);
});
test("map has accessible controls and deeper bounded street tiles",()=>{
  assert.match(map,/Acercar mapa/);
  assert.match(map,/dblclick/);
  assert.match(map,/lat:\.0015,lon:\.003/);
  const tiles=visibleStreetTiles({latitude:20.6767,longitude:-103.3475},{lat:.0015,lon:.003});
  assert.ok(tiles.length>0&&tiles.length<=24);
  assert.ok(tiles.every(t=>t.url.startsWith("https://tile.openstreetmap.org/")));
});

test("verified Commons videos can play natively without synthetic embeds",()=>{
  const search=readFileSync(new URL("../server/search.mjs",import.meta.url),"utf8");
  const server=readFileSync(new URL("../server/index.mjs",import.meta.url),"utf8");
  assert.match(search,/item\.mediaUrl=video\.url/);
  assert.match(app,/▷ Reproducir aquí/);
  assert.match(app,/stream\.preload="none"/);
  assert.match(app,/stream\.play\(\)\.catch/);
  assert.match(app,/stopInlineVideo\(\)/);
  assert.match(server,/media-src https:\/\/upload\.wikimedia\.org/);
});
