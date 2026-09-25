import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {routingCapabilities,planDirections,DirectionsError} from "../server/directions.mjs";
import {routeDiagram,durationLabel,distanceLabel} from "../public/directions-core.js";
import api from "../api/directions.js";
import capabilityApi from "../api/directions/capabilities.js";
const keys=["WAE_ROUTING_PROVIDER","WAE_ROUTING_API_KEY","WAE_OSRM_URL","WAE_OSRM_DRIVING_URL","WAE_OSRM_WALKING_URL","WAE_OSRM_CYCLING_URL","WAE_ROUTING_ALLOW_LOCAL","WAE_PREVIEW_MODE","VERCEL_ENV"];
const save=()=>Object.fromEntries(keys.map(k=>[k,process.env[k]]));
function restore(s){for(const[k,v]of Object.entries(s))if(v===undefined)delete process.env[k];else process.env[k]=v;}
const origin="20.676700,-103.347500";
const destination="20.680000,-103.340000";
const payload={origin,destination,mode:"driving"};
const geo=()=>({
  type:"FeatureCollection",
  features:[{
    type:"Feature",
    geometry:{type:"LineString",coordinates:[
      [-103.3475,20.6767],[-103.3452,20.6778],[-103.342,20.679],[-103.34,20.68]
    ]},
    properties:{summary:{distance:1523.4,duration:333},
      segments:[{steps:[
        {instruction:"Dirígete al este por la calle",distance:450,duration:112,name:"Calle A"},
        {instruction:"Gira a la derecha",distance:1073.4,duration:221,name:"Calle B"}
      ]}]
    }
  }]
});
test("route provider fail-closes when not configured, never uses demo routes",async()=>{
  const old=save();try{
    delete process.env.WAE_ROUTING_API_KEY;
    process.env.WAE_ROUTING_PROVIDER="off";
    assert.equal(routingCapabilities().enabled,false);
    await assert.rejects(planDirections(payload),e=>e instanceof DirectionsError&&e.status===503&&e.code==="routing_unavailable");
    process.env.WAE_ROUTING_PROVIDER="ors";
    assert.equal(routingCapabilities().enabled,false);
  }finally{restore(old);}
});
test("ORS route uses exact endpoints, mode and returned real geometry/instructions",async()=>{
  const old=save(),before=globalThis.fetch;let calls=0;
  try{
    process.env.WAE_ROUTING_PROVIDER="ors";
    process.env.WAE_ROUTING_API_KEY="test-only-fake-key-value";
    globalThis.fetch=async(url,options)=>{
      calls++;
      assert.equal(String(url),"https://api.openrouteservice.org/v2/directions/driving-car/geojson");
      assert.equal(options.method,"POST");
      assert.equal(options.redirect,"error");
      assert.equal(options.headers.authorization,"test-only-fake-key-value");
      assert.deepEqual(JSON.parse(options.body).coordinates,[
        [-103.3475,20.6767],[-103.34,20.68]
      ]);
      return new Response(JSON.stringify(geo()),{status:200});
    };
    const route=await planDirections(payload);
    assert.equal(calls,1);
    assert.equal(route.mode,"driving");
    assert.equal(route.source,"openrouteservice");
    assert.equal(route.distanceMeters,1523.4);
    assert.equal(route.durationSeconds,333);
    assert.deepEqual(route.geometry,geo().features[0].geometry.coordinates);
    assert.equal(route.steps.length,2);
    assert.match(route.steps[1].instruction,/derecha/);
    assert.equal(JSON.stringify(route).includes("test-only-fake-key-value"),false);
    assert.equal(route.origin.precision,"coordinate");
    assert.equal(route.destination.precision,"coordinate");
  }finally{globalThis.fetch=before;restore(old);}
});
test("ORS supports walking/cycling without falsely relabelling car routes",async()=>{
  const old=save(),before=globalThis.fetch;try{
    process.env.WAE_ROUTING_PROVIDER="ors";
    process.env.WAE_ROUTING_API_KEY="test-only-fake-key-value";
    for(const [mode,profile] of [["walking","foot-walking"],["cycling","cycling-regular"]]){
      globalThis.fetch=async url=>{
        assert.match(String(url),new RegExp("/"+profile+"/geojson$"));
        return new Response(JSON.stringify(geo()),{status:200});
      };
      assert.equal((await planDirections({...payload,mode})).mode,mode);
    }
    await assert.rejects(planDirections({...payload,mode:"teleport"}),e=>e.code==="directions_invalid");
  }finally{globalThis.fetch=before;restore(old);}
});
test("self-hosted OSRM is keyless, mode-safe and uses returned road geometry",async()=>{
  const old=save(),before=globalThis.fetch;
  try{
    process.env.WAE_ROUTING_PROVIDER="osrm";
    process.env.WAE_OSRM_URL="https://osrm.example.test";
    delete process.env.WAE_ROUTING_API_KEY;
    const caps=routingCapabilities();
    assert.equal(caps.enabled,true);assert.equal(caps.provider,"osrm");
    assert.equal(caps.keyRequired,false);assert.deepEqual(caps.modes,["driving"]);
    let calls=0;
    globalThis.fetch=async url=>{
      calls++;const u=new URL(url);
      assert.equal(u.origin,"https://osrm.example.test");
      assert.match(u.pathname,/^\/route\/v1\/driving\/-103\.347500,20\.676700;-103\.340000,20\.680000$/);
      assert.equal(u.searchParams.get("steps"),"true");
      assert.equal(u.searchParams.get("geometries"),"geojson");
      return new Response(JSON.stringify({code:"Ok",routes:[{
        distance:1523.4,duration:333,
        geometry:{type:"LineString",coordinates:[[-103.3475,20.6767],[-103.3452,20.6778],[-103.34,20.68]]},
        legs:[{steps:[
          {distance:450,duration:112,name:"Calle A",maneuver:{type:"depart"}},
          {distance:900,duration:180,name:"Calle B",maneuver:{type:"turn",modifier:"right"}},
          {distance:173.4,duration:41,name:"",maneuver:{type:"arrive"}}
        ]}]
      }]}),{status:200});
    };
    const route=await planDirections(payload);
    assert.equal(calls,1);assert.equal(route.source,"OSRM");
    assert.equal(route.distanceMeters,1523.4);assert.equal(route.steps.length,3);
    assert.match(route.steps[1].instruction,/derecha/);
    assert.deepEqual(route.geometry,[[-103.3475,20.6767],[-103.3452,20.6778],[-103.34,20.68]]);
    await assert.rejects(planDirections({...payload,mode:"walking"}),e=>e.code==="routing_mode_unavailable");
  }finally{globalThis.fetch=before;restore(old);}
});

test("bad route geometry, no steps and quota fail without generated directions",async()=>{
  const old=save(),before=globalThis.fetch;try{
    process.env.WAE_ROUTING_PROVIDER="ors";
    process.env.WAE_ROUTING_API_KEY="test-only-fake-key-value";
    globalThis.fetch=async()=>new Response("{}",{status:429});
    await assert.rejects(planDirections(payload),e=>e.status===429&&e.code==="routing_quota");
    const invalid=geo();invalid.features[0].geometry.coordinates=[[-103.34,20.68],[99,100]];
    globalThis.fetch=async()=>new Response(JSON.stringify(invalid),{status:200});
    await assert.rejects(planDirections(payload),e=>e.code==="invalid_route");
    const noSteps=geo();noSteps.features[0].properties.segments=[{steps:[]}];
    globalThis.fetch=async()=>new Response(JSON.stringify(noSteps),{status:200});
    await assert.rejects(planDirections(payload),e=>e.code==="steps_missing");
    await assert.rejects(planDirections({...payload,destination:origin}),e=>e.code==="directions_invalid");
  }finally{globalThis.fetch=before;restore(old);}
});
test("route diagram uses actual road vertices, never A-to-B shortcut",()=>{
  const geometry=geo().features[0].geometry.coordinates;
  const sketch=routeDiagram(geometry);
  assert.equal(sketch.points.length,4);
  assert.equal((sketch.path.match(/L/g)||[]).length,3);
  assert.match(distanceLabel(1523.4),/km/);
  assert.equal(durationLabel(333),"6 min");
  assert.throws(()=>routeDiagram([[181,91],[0,0]]),TypeError);
});
test("preview permits public route planning only and blocks account mutations",async()=>{
  const old=save(),before=globalThis.fetch;const server=http.createServer(api);
  try{
    process.env.WAE_ROUTING_PROVIDER="ors";
    process.env.WAE_ROUTING_API_KEY="test-only-fake-key-value";
    process.env.WAE_PREVIEW_MODE="true";
    globalThis.fetch=async(url,options)=>{
      if(String(url).startsWith("https://api.openrouteservice.org"))return new Response(JSON.stringify(geo()),{status:200});
      return before(url,options);
    };
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+server.address().port;
    const caps=await fetch(base+"/api/directions/capabilities");
    assert.equal(caps.status,200);assert.equal((await caps.json()).enabled,true);
    const response=await fetch(base+"/api/directions",{
      method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload)
    });
    assert.equal(response.status,200);
    assert.equal(response.headers.get("x-waeweb-api"),"1");
    assert.equal((await response.json()).steps.length,2);
    assert.equal((await fetch(base+"/api/directions")).status,405);
    assert.equal((await fetch(base+"/api/account/register",{method:"POST"})).status,503);
    assert.equal((await fetch(base+"/api/read",{method:"POST"})).status,503);
    const named=http.createServer(capabilityApi);
    try{
      await new Promise(resolve=>named.listen(0,"127.0.0.1",resolve));
      const namedRes=await fetch("http://127.0.0.1:"+named.address().port+"/api/directions/capabilities");
      assert.equal(namedRes.status,200);
    }finally{await new Promise(resolve=>named.close(resolve));}
  }finally{
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    globalThis.fetch=before;restore(old);
  }
});
test("maps page keeps attribution and wires real route UX; GPS is opt in",async()=>{
  const {readFile}=await import("node:fs/promises");
  const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  const ui=await readFile(new URL("../public/directions.js",import.meta.url),"utf8");
  const backend=await readFile(new URL("../server/directions.mjs",import.meta.url),"utf8");
  assert.match(app,/createDirections/);
  assert.match(app,/directions\.setDestination/);
  assert.match(ui,/\/api\/directions\/capabilities/);
  assert.match(ui,/\/api\/directions"/);
  assert.match(ui,/navigator\.geolocation\.getCurrentPosition/);
  assert.doesNotMatch(ui,/watchPosition/);
  assert.match(ui,/Esquema con geometría devuelta/);
  assert.match(backend,/api\.openrouteservice\.org/);
  assert.doesNotMatch(backend,/router\.project-osrm\.org/);
});
