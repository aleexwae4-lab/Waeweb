import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import http from "node:http";
import {handler} from "../server/index.mjs";

test("translator is a native WAEWEB panel, usable before server capabilities resolve",async()=>{
  const ui=await readFile(new URL("../public/translator.js",import.meta.url),"utf8");
  assert.match(ui,/root\.insertBefore\(engineRow,columns\)/);
  assert.match(ui,/globalThis\.Translator\.create/);
  assert.match(ui,/globalThis\.Translator\.availability/);
  assert.match(ui,/engine==="local"/);
  assert.match(ui,/↻ Reconectar/);
  assert.match(ui,/translate\.disabled=false/);
  assert.match(ui,/getJSON\("\/api\/translate"/);
  assert.doesNotMatch(ui,/No se pudo conectar con la API del traductor:/);
  assert.doesNotMatch(ui,/No introduzcas datos confidenciales\. El texto se comparte con un proveedor externo solo al pulsar Traducir/);
  assert.match(ui,/Servicio sin conexión/);
  assert.match(ui,/lastTranslation=result\.translatedText/);
  assert.match(ui,/window\.speechSynthesis/);
});

test("Mapas is a first-party SVG geographic interaction, not an iframe or fake road map",async()=>{
  const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  const map=await readFile(new URL("../public/native-map.js",import.meta.url),"utf8");
  const directions=await readFile(new URL("../public/directions.js",import.meta.url),"utf8");
  assert.match(app,/import \{createNativeMap\} from "\/native-map\.js"/);
  assert.match(app,/map\.setView\(place,zoom\)/);
  assert.match(app,/onRoute:route=>map\.setRoute\(route\.geometry\)/);
  assert.match(app,/const map=createNativeMap\(\)/);
  assert.doesNotMatch(app,/element\("iframe","map-iframe"\)/);
  assert.match(map,/createElementNS\(svgNS,tag\)/);
  assert.match(map,/pointermove/);
  assert.match(map,/ArrowLeft/);
  assert.match(map,/function setRoute\(coords\)/);
  assert.match(map,/setPointerCapture/);
  assert.match(map,/visibleStreetTiles/);
  assert.match(map,/toggleStreets/);
  assert.match(map,/OpenStreetMap contributors/);
  assert.doesNotMatch(map,/fetch\(|<iframe/i);
  assert.match(app,/\/api\/maps\?q=/);
  assert.match(app,/state\.mapUserLocation/);
  assert.match(app,/\/api\/places\?q=/);
  assert.match(app,/\/api\/poi\?/);
  assert.match(directions,/onRoute\(result\)/);
});

test("server routes the native assets; preview retains read-only protections",async()=>{
  const old=process.env.WAE_PREVIEW_MODE;process.env.WAE_PREVIEW_MODE="true";
  const server=http.createServer((req,res)=>handler(req,res));
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+server.address().port;
    const assets=[["/native-map.js","createNativeMap"],["/translator.js","↻ Reconectar"]];
    for(const [path,fragment]of assets){
      const response=await fetch(base+path);
      assert.equal(response.status,200,path);
      assert.match(await response.text(),new RegExp(fragment));
    }
    const caps=await fetch(base+"/api/translate/capabilities");
    assert.equal(caps.status,200);
    assert.equal(caps.headers.get("x-waeweb-api"),"1");
    assert.equal((await fetch(base+"/api/account/register",{method:"POST"})).status,503);
  }finally{
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    if(old===undefined)delete process.env.WAE_PREVIEW_MODE;else process.env.WAE_PREVIEW_MODE=old;
  }
});
