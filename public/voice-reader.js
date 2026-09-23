// Browser-native speech, initiated by the user: no provider key, audio upload,
// network request or claim to have the full text of an external article.
export function speechChunks(value,max=210){
  const text=String(value??"").replace(/\s+/g," ").trim().slice(0,15000);
  if(!text)return [];
  const chunks=[];
  let rest=text;
  while(rest.length){
    if(rest.length<=max){chunks.push(rest);break;}
    const sample=rest.slice(0,max+1);
    const stops=[sample.lastIndexOf(". "),sample.lastIndexOf("! "),
      sample.lastIndexOf("? "),sample.lastIndexOf("; "),sample.lastIndexOf(", "),
      sample.lastIndexOf(" ")];
    const boundary=stops.find(n=>n>=Math.floor(max*.48));
    const cut=boundary===undefined?max:boundary+1;
    chunks.push(rest.slice(0,cut).trim());
    rest=rest.slice(cut).trim();
  }
  return chunks;
}
export function createVoiceReader({win=globalThis,onChange=()=>{}}={}){
  const synth=win.speechSynthesis;
  const available=Boolean(synth&&win.SpeechSynthesisUtterance);
  let phase="idle",label="",segments=[],index=0,generation=0,rate=1,voiceURI="";
  let language="es-MX",utterance=null;
  const voices=()=>available?synth.getVoices().filter(v=>v.lang).slice(0,80):[];
  function snapshot(){return {available,phase,label,index,total:segments.length,
    rate,voiceURI,voices:voices().map(v=>({name:v.name,lang:v.lang,uri:v.voiceURI}))};}
  function emit(){onChange(snapshot());}
  function stop(){
    generation++;segments=[];index=0;phase="idle";utterance=null;label="";
    if(available)synth.cancel();
    emit();
  }
  function enqueue(turn){
    if(turn!==generation||phase==="idle"||index>=segments.length)return;
    utterance=new win.SpeechSynthesisUtterance(segments[index]);
    utterance.lang=language;utterance.rate=rate;
    const voice=voices().find(v=>v.voiceURI===voiceURI)||
      voices().find(v=>v.lang.toLowerCase()===language.toLowerCase())||
      voices().find(v=>v.lang.toLowerCase().startsWith(language.slice(0,2).toLowerCase()));
    if(voice){utterance.voice=voice;utterance.lang=voice.lang;}
    utterance.onend=()=>{
      if(turn!==generation||phase==="idle")return;
      index++;utterance=null;
      if(index>=segments.length){
        phase="idle";segments=[];index=0;label="";emit();
      }else{emit();enqueue(turn);}
    };
    utterance.onerror=()=>{
      if(turn!==generation)return;
      generation++;phase="idle";segments=[];index=0;label="";utterance=null;emit();
    };
    synth.speak(utterance);
    emit();
  }
  function play({title="",text="",lang="es-MX"}={}){
    stop();
    if(!available)return false;
    const parts=speechChunks([title,text].filter(Boolean).join(". "));
    if(!parts.length)return false;
    segments=parts;language=lang;label=String(title||"Lectura de fuentes").slice(0,100);
    phase="playing";index=0;generation++;enqueue(generation);return true;
  }
  function pause(){
    if(!available||phase!=="playing")return;
    synth.pause();phase="paused";emit();
  }
  function resume(){
    if(!available||phase!=="paused")return;
    phase="playing";synth.resume();emit();
  }
  function setRate(value){
    const next=Number(value);
    if(!Number.isFinite(next)||next<.75||next>1.5)return;
    rate=next;emit();
  }
  function setVoice(uri){voiceURI=String(uri||"");emit();}
  function refresh(){emit();}
  return {play,pause,resume,stop,setRate,setVoice,refresh,snapshot,voices};
}
