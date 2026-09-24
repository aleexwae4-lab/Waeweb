import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {mapViewport,osmSearchUrl} from "../public/maps-core.js";

const file=name=>readFileSync(new URL("../public/"+name,import.meta.url),"utf8");

test("portrait map viewport fills the available mobile area without stretching map geography",()=>{
  const portrait=mapViewport(360,540);
  assert.ok(portrait.width<900);
  assert.equal(portrait.x,(900-portrait.width)/2);
  const [x,y,width,height]=portrait.viewBox.split(" ").map(Number);
  assert.equal(x,portrait.x);
  assert.equal(y,0);
  assert.equal(height,460);
  assert.ok(Math.abs(width/height-360/540)<1e-12);
  assert.deepEqual(mapViewport(900,460),{width:900,x:0,viewBox:"0 0 900 460"});
  assert.deepEqual(mapViewport(0,0),{width:900,x:0,viewBox:"0 0 900 460"});
});

test("no-match place search links to the precise original query, never invents a business",()=>{
  const url=new URL(osmSearchUrl("Oxxo cerca de Zapopan"));
  assert.equal(url.origin,"https://www.openstreetmap.org");
  assert.equal(url.pathname,"/search");
  assert.equal(url.searchParams.get("query"),"Oxxo cerca de Zapopan");
  assert.throws(()=>osmSearchUrl(" "),{name:"TypeError"});
  const app=file("app.js");
  assert.match(app,/showDirectionsWithoutLocality\(\{query:state\.query,message:data\.message\}\)/);
  assert.match(app,/external\(osmSearchUrl\(query\),"↗ Buscar «"\+query\+"» en OpenStreetMap"/);
  assert.doesNotMatch(app,/query,source:"Coordenadas en tu dispositivo"/);
  assert.match(app,/query,source:"Coordenadas introducidas"/);
});

test("map DOM is map-first, with optional directions and compact source credit",()=>{
  const app=file("app.js"),css=file("styles.css");
  assert.match(app,/function createMapDirectionsDisclosure\(directions\)/);
  assert.match(app,/const disclosure=element\("details","map-directions-disclosure"\)/);
  assert.match(app,/section\.append\(stage,createMapDirectionsDisclosure\(directions\)\)/);
  assert.match(app,/section\.append\(stage,details\)/);
  assert.match(app,/section\.append\(createMapDirectionsDisclosure\(directions\)\)/);
  assert.match(app,/const credits=element\("details","map-credits"\)/);
  assert.match(css,/\.map-explorer \.wae-native-map-area svg\{height:clamp\(340px,57dvh,570px\)\}/);
  assert.match(css,/\.map-explorer \.wae-native-map-controls\{display:grid;grid-template-columns:repeat\(2,40px\)/);
  assert.match(css,/\.map-directions-disclosure>summary:focus-visible/);
});

test("map resizes and disposes on replacing a search; drag matches cropped projection",()=>{
  const app=file("app.js"),native=file("native-map.js");
  assert.match(native,/mapViewport\(svg\.getBoundingClientRect\(\)\.width,svg\.getBoundingClientRect\(\)\.height\)/);
  assert.match(native,/svg\.setAttribute\("viewBox",viewport\.viewBox\)/);
  assert.match(native,/spans\[level\]\.lon\*viewport\.width\/900/);
  assert.match(native,/new ResizeObserver\(\(\)=>scheduleDraw\(\)\)/);
  assert.match(native,/resizeObserver\?\.disconnect\(\)/);
  assert.match(app,/function stopDirections\(\)\{activeDirections\?\.dispose\(\);activeDirections=null;activeMap\?\.dispose\(\);activeMap=null;\}/);
  assert.match(app,/activeMap=map/);
});
