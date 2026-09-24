import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {importPois,extractPoi} from "../scripts/import-pois.mjs";
import {searchNativeNearby,nativePoiStatus} from "../server/native-poi.mjs";
import {searchNearby,NearbyError} from "../server/nearby.mjs";
import {directorySites} from "../server/site-discovery.mjs";
const fixture=(id,lat,lon,name,fields={})=>({
  type:"Feature",geometry:{type:"Point",coordinates:[lon,lat]},
  properties:{"@id":"node/"+id,name,...fields}
});
test("owned OSM import filters unsupported POIs and preserves provenance",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"wae-native-poi-"));
  const input=join(dir,"test.geojsonseq"),index=join(dir,"pois.ndjson");
  const rows=[
    fixture(1,20.675,-103.35,"Banco Local",{amenity:"bank"}),
    fixture(2,20.677,-103.353,"OXXO Centro",{shop:"convenience",brand:"OXXO"}),
    fixture(3,20.678,-103.355,"Telcel Oficina",{shop:"mobile_phone"}),
    fixture(4,20.671,-103.352,"Domicilio particular",{building:"house"}),
    fixture(5,20.673,-103.356,"",{amenity:"bank"}),
    fixture(2,20.677,-103.353,"OXXO duplicado",{shop:"convenience"})
  ];
  try{
    await writeFile(input,rows.map(row=>JSON.stringify(row)).join("\n")+"\n");
    const imported=await importPois(input,index,{
      snapshot:"2026-09-24",coverage:"fixture-test-Zapopan"});
    assert.equal(imported.records,3);
    const persisted=await readFile(index,"utf8");
    assert.match(persisted,/ODbL-1.0/);
    assert.doesNotMatch(persisted,/Domicilio particular/);
    assert.equal(nativePoiStatus({filePath:index}).documents,3);
    const bank=searchNativeNearby({query:"Banco cerca",latitude:20.675,
      longitude:-103.35,filePath:index});
    assert.equal(bank.engine,"native");
    assert.equal(bank.results.length,1);
    assert.equal(bank.results[0].name,"Banco Local");
    const oxxo=searchNativeNearby({query:"Oxxo cerca",latitude:20.675,
      longitude:-103.35,filePath:index});
    assert.equal(oxxo.results[0].name,"OXXO Centro");
    assert.equal(searchNativeNearby({query:"Banco cerca",latitude:40,
      longitude:-74,filePath:index}),null,"do not assert nationwide coverage");
    assert.equal(searchNativeNearby({query:"Banco cerca",latitude:20.675,
      longitude:-103.35,filePath:join(dir,"absent")}),null);
    assert.equal(extractPoi(fixture(9,95,-103,"Invalid",{amenity:"bank"})),null);
    const prior=process.env.WAE_POI_INDEX_PATH;
    process.env.WAE_POI_INDEX_PATH=index;
    try{
      let remoteCalled=0;
      const native=await searchNearby({query:"Oxxo cerca",latitude:20.675,
        longitude:-103.35},async()=>{remoteCalled++;throw Error("external API must not run");});
      assert.equal(native.engine,"native");
      assert.equal(remoteCalled,0);
    }finally{
      if(prior===undefined)delete process.env.WAE_POI_INDEX_PATH;
      else process.env.WAE_POI_INDEX_PATH=prior;
    }
  }finally{await rm(dir,{recursive:true,force:true});}
});
test("native-only mode refuses external lookups rather than inventing stores",async()=>{
  const before=process.env.WAE_NEARBY_EXTERNAL_FALLBACK;
  const path=process.env.WAE_POI_INDEX_PATH;
  process.env.WAE_NEARBY_EXTERNAL_FALLBACK="false";
  process.env.WAE_POI_INDEX_PATH="/file-does-not-exist-wae-pois.ndjson";
  try{
    let called=0;
    await assert.rejects(searchNearby({query:"Oxxo cerca",latitude:20,
      longitude:-103},async()=>{called++;throw Error("unexpected fetch");}),
      error=>error instanceof NearbyError&&error.status===503);
    assert.equal(called,0);
  }finally{
    if(before===undefined)delete process.env.WAE_NEARBY_EXTERNAL_FALLBACK;
    else process.env.WAE_NEARBY_EXTERNAL_FALLBACK=before;
    if(path===undefined)delete process.env.WAE_POI_INDEX_PATH;
    else process.env.WAE_POI_INDEX_PATH=path;
  }
});
test("Telcel direct navigation resolves natively to an actual URL",()=>{
  const [hit]=directorySites("telcel");
  assert.equal(hit.url,"https://www.telcel.com/");
  assert.equal(hit.siteLink,true);
  assert.deepEqual(directorySites("historia de telcel"),[]);
});
