import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {scoreResult} from "../server/intelligence.mjs";

const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
const nativeMap=readFileSync(new URL("../public/native-map.js",import.meta.url),"utf8");

test("home and map error never expose diagnostic UI links",()=>{
  assert.doesNotMatch(html,/href=["']\/diagnostico\.html["']/);
  assert.doesNotMatch(app,/external\(["']\/diagnostico\.html["']/);
  assert.doesNotMatch(html,/Resultados identificados por fuente\. Sin cifras inventadas/);
});

test("maps appears beside All in mobile-priority search tabs",()=>{
  const all=html.indexOf('data-type="all"');
  const maps=html.indexOf('data-type="maps"');
  const images=html.indexOf('data-type="images"');
  assert.ok(all>=0&&maps>all&&images>maps);
});

test("map search has an explicit location permission action",()=>{
  assert.match(app,/navigator\.geolocation\.getCurrentPosition/);
  assert.match(app,/createMapQuickSearch/);
  assert.match(app,/Mi ubicación/);
  assert.match(nativeMap,/rasterCache=new Map\(\)/);
});

test("general search favors direct named entities over matching papers",()=>{
  const entity={title:"Google",snippet:"",source:"Wikipedia"};
  const paper={title:"Google Earth and Google Maps",snippet:"",source:"Crossref"};
  assert.ok(scoreResult(entity,"Google","all")>scoreResult(paper,"Google","all"));
  assert.ok(scoreResult(paper,"Google","research")>0);
});
