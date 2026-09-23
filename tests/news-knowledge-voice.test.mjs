import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFileSync} from "node:fs";
import {createVoiceReader,speechChunks} from "../public/voice-reader.js";
import {handler} from "../server/index.mjs";
test("speech chunking preserves source text in short browser-safe segments",()=>{
  const original=("Titular muy importante. Una descripción verificable de la fuente. ").repeat(25);
  const pieces=speechChunks(original,210);
  assert.ok(pieces.length>2);
  assert.ok(pieces.every(x=>x.length<=210));
  assert.equal(pieces.join(" ").replace(/\s+/g," ").trim(),original.trim());
  assert.deepEqual(speechChunks(""),[]);
  assert.ok(speechChunks("A".repeat(16000)).join("").length<=15000);
});
test("native reader is user-initiated, single-queue, pauses/resumes and stops stale speech",()=>{
  const spoken=[],cancelled=[],paused=[],resumed=[],updates=[];
  const synth={
    speak:u=>spoken.push(u),cancel:()=>cancelled.push(true),
    pause:()=>paused.push(true),resume:()=>resumed.push(true),
    getVoices:()=>[{voiceURI:"mx-voice",name:"México",lang:"es-MX"}]
  };
  class Utterance{constructor(text){this.text=text;}}
  const reader=createVoiceReader({win:{speechSynthesis:synth,SpeechSynthesisUtterance:Utterance},
    onChange:state=>updates.push(state.phase)});
  assert.equal(reader.snapshot().phase,"idle");
  reader.setVoice("mx-voice");
  reader.setRate(1.15);
  assert.equal(reader.play({title:"Boletín",text:"Esta noticia tiene origen.".repeat(20)}),true);
  assert.equal(reader.snapshot().phase,"playing");
  assert.ok(spoken.length>0);
  assert.equal(spoken[0].lang,"es-MX");
  assert.equal(spoken[0].rate,1.15);
  assert.equal(spoken[0].voice.voiceURI,"mx-voice");
  reader.pause();assert.equal(reader.snapshot().phase,"paused");
  reader.resume();assert.equal(reader.snapshot().phase,"playing");
  assert.equal(paused.length,1);assert.equal(resumed.length,1);
  const stale=spoken[0];
  reader.play({title:"Otra fuente",text:"Otra descripción."});
  assert.equal(reader.snapshot().label,"Otra fuente");
  const count=spoken.length;
  stale.onend();assert.equal(spoken.length,count);
  spoken.at(-1).onend();assert.equal(reader.snapshot().phase,"idle");
  reader.play({title:"Cerrar",text:"Cierre final"});
  reader.stop();assert.equal(reader.snapshot().phase,"idle");
  assert.ok(cancelled.length>=3);
  assert.ok(updates.includes("paused"));
});
test("unsupported browser is explicit and does not simulate audio",()=>{
  const reader=createVoiceReader({win:{}});
  assert.equal(reader.snapshot().available,false);
  assert.equal(reader.play({title:"Sin voz",text:"Texto"}),false);
  reader.pause();reader.resume();reader.stop();
  assert.equal(reader.snapshot().phase,"idle");
});
test("News and Information speak real headlines, extracts and citations with a single dock",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
  assert.match(app,/import \{ createVoiceReader \} from "\/voice-reader\.js"/);
  assert.match(app,/function renderInformationCard\(item,index\)/);
  assert.match(app,/if\(\["news","knowledge","research"\]\.includes\(state\.type\)\)/);
  assert.match(app,/voiceReader\.play\(\{title,text,lang:"es-MX"\}\)/);
  assert.match(app,/news-bulletin/);
  assert.match(app,/news-reading-note/);
  assert.match(app,/▶ Escuchar este extracto/);
  assert.match(app,/▶ Escuchar resultados/);
  assert.match(app,/wae-voice-toggle/);
  assert.match(app,/voiceReader\.pause\(\)/);
  assert.match(app,/voiceReader\.resume\(\)/);
  assert.match(app,/voiceReader\.stop\(\)/);
  assert.match(app,/window\.speechSynthesis\?\.addEventListener\?/);
  assert.match(app,/escuchar.*?/i);
  assert.match(css,/\.wae-reading-grid\{display:grid/);
  assert.match(css,/\.wae-voice-dock\[hidden\]/);
  assert.match(css,/@media\(max-width:600px\).*?wae-reading-grid/s);
  assert.doesNotMatch(app,/Esta noticia fue verificada por WAE WEB/);
});
test("new voice script is publicly served with JS content type",async()=>{
  const server=http.createServer((req,res)=>handler(req,res).catch(error=>{
    res.statusCode=500;res.end(error.message);
  }));
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const response=await fetch("http://127.0.0.1:"+server.address().port+"/voice-reader.js");
    assert.equal(response.status,200);
    assert.match(response.headers.get("content-type"),/javascript/);
    assert.match(await response.text(),/export function createVoiceReader/);
  }finally{if(server.listening)await new Promise(resolve=>server.close(resolve));}
});
