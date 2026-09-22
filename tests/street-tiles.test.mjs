import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {visibleStreetTiles} from "../public/map-tiles.js";

test("only the current viewport receives a bounded set of correctly addressed street tiles",()=>{
  const tiles=visibleStreetTiles({latitude:20.6767,longitude:-103.3475},{lat:1.4,lon:2.8});
  assert.ok(tiles.length>0&&tiles.length<=24);
  for(const tile of tiles){
    const u=new URL(tile.url);
    assert.equal(u.protocol,"https:");
    assert.equal(u.hostname,"tile.openstreetmap.org");
    assert.match(u.pathname,/^\/[1-9]\d*\/\d+\/\d+\.png$/);
    for(const key of ["x","y","width","height"])assert.ok(Number.isFinite(tile[key]));
    assert.ok(tile.width>0&&tile.height>0);
  }
});

test("bad map dimensions and excessive tile requests remain disabled",()=>{
  assert.deepEqual(visibleStreetTiles(null,{lat:1,lon:1}),[]);
  assert.deepEqual(visibleStreetTiles({latitude:1,longitude:1},{lat:0,lon:1}),[]);
  assert.deepEqual(visibleStreetTiles({latitude:20,longitude:-103},{lat:40,lon:80},1),[]);
});

test("street layer only activates by explicit button, retains attribution and fallback",async()=>{
  const map=await readFile(new URL("../public/native-map.js",import.meta.url),"utf8");
  assert.match(map,/make\("▧ Calles",\(\)=>toggleStreets\(\)\)/);
  assert.match(map,/let center=.*streetsEnabled=false/);
  assert.match(map,/if\(streetsEnabled\)\{/);
  assert.match(map,/OpenStreetMap contributors/);
  assert.match(map,/strict-origin-when-cross-origin/);
  assert.doesNotMatch(map,/fetch\(/);
});
