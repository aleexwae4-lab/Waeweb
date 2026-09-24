import test from "node:test";
import assert from "node:assert/strict";
import {nearbyIntent} from "../public/local-intent.js";
import {searchNearby,NearbyError} from "../server/nearby.mjs";

test("local POI intent is only triggered by explicit nearby wording",()=>{
  for(const [q,category] of [
    ["Oxxo cerca","oxxo"],["Banco cerca","bank"],
    ["cajeros cerca de mí","atm"],["cines cercanos","cinema"],
    ["farmacias próximas","pharmacy"],["Telcel cerca","telcel"]]){
    assert.equal(nearbyIntent(q)?.category,category,q);
  }
  for(const q of ["Facebook","Telcel","Banco de México","historia del Oxxo",
    "Banco cerca source:wikipedia","Mercado Libre",""])
    assert.equal(nearbyIntent(q),null,q);
});

test("nearby uses opt-in coordinates, a fixed OSM category and real returned locations",async()=>{
  let called=0;
  const fetchMock=async(url,options)=>{
    called++;
    assert.equal(new URL(url).hostname,"overpass-api.de");
    assert.equal(options.method,"POST");
    const statement=new URLSearchParams(options.body).get("data");
    assert.match(statement,/\[amenity=bank\]/);
    assert.match(statement,/around:3500,20.67,-103.35/);
    assert.doesNotMatch(statement,/Wikipedia/i);
    return new Response(JSON.stringify({elements:[
      {type:"node",id:1,lat:20.671,lon:-103.35,tags:{name:"Banco documentado"}},
      {type:"node",id:2,lat:20.69,lon:-103.35,tags:{name:"Banco lejano"}},
      {type:"node",id:3,lat:20.671,lon:-103.35,tags:{}}
    ]}),{status:200});
  };
  const args={query:"Banco cerca",latitude:20.67,longitude:-103.35};
  const answer=await searchNearby(args,fetchMock);
  assert.equal(answer.source,"OpenStreetMap · Overpass");
  assert.equal(answer.results.length,2);
  assert.equal(answer.results[0].name,"Banco documentado");
  assert.ok(answer.results[0].distanceMeters<answer.results[1].distanceMeters);
  await searchNearby(args,fetchMock);
  assert.equal(called,1,"short-lived cache avoids repeat pressure on public Overpass");
});

test("nearby never invents locations on denied coordinates or provider outage",async()=>{
  await assert.rejects(searchNearby({query:"Oxxo cerca",latitude:null,longitude:null}),
    e=>e instanceof NearbyError&&e.status===400);
  await assert.rejects(searchNearby({query:"Oxxo cerca",latitude:91,longitude:20}),
    e=>e instanceof NearbyError&&e.status===400);
  await assert.rejects(searchNearby({query:"Oxxo cerca",latitude:20.5,longitude:-103.4},
    async()=>new Response("",{status:429})),
    e=>e instanceof NearbyError&&e.status===503);
  const empty=await searchNearby({query:"Oxxo cerca",latitude:20.5,longitude:-103.45},
    async()=>new Response(JSON.stringify({elements:[]}),{status:200}));
  assert.deepEqual(empty.results,[]);
  assert.match(empty.message,/Sin negocios registrados/);
});
