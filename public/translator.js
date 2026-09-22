// RC33: WAEWEB-owned translator interface. Local browser translator is used
// when supported; remote provider is an explicit-click fallback, never a vault.
export function createTranslator({getJSON,resultsContainer,stats,sourceFilter,answer,weatherSlot,panel}) {
  const $=(tag,className,text)=>{
    const el=document.createElement(tag);
    if(className)el.className=className;
    if(text!==undefined)el.textContent=text;
    return el;
  };
  const button=(label,fn,className="translate-action")=>{
    const el=$("button",className,label);el.type="button";el.addEventListener("click",fn);return el;
  };
  const root=$("section","translator-panel");
  root.setAttribute("aria-label","Traductor WAEWEB");
  const header=$("div","translate-heading");
  const title=$("div");
  title.append($("span","tag","WAEWEB · IDIOMAS"),$("h2","","Traductor"));
  const desc=$("p","translate-description","Escribe, elige idiomas y traduce aquí. Si tu navegador admite traducción local, el texto se procesa en el dispositivo.");
  header.append(title);
  root.append(header,desc);
  const languagesRow=$("div","translate-languages");
  const fromGroup=$("label","translate-language");
  fromGroup.append($("span","","Idioma de origen"));
  const from=$("select","translate-select");from.name="source";fromGroup.append(from);
  const toGroup=$("label","translate-language");
  toGroup.append($("span","","Traducir a"));
  const to=$("select","translate-select");to.name="target";toGroup.append(to);
  const swap=button("⇄",()=>{}, "translate-swap"); // handler registered after state initialization
  swap.setAttribute("aria-label","Intercambiar idiomas");
  languagesRow.append(fromGroup,swap,toGroup);
  root.append(languagesRow);
  const columns=$("div","translate-columns");
  const sourceSide=$("div","translate-box");
  const inputLabel=$("label","translate-box-heading","Texto original");
  const input=$("textarea","translate-input");
  input.rows=8;input.maxLength=2600;input.placeholder="Escribe o pega el texto aquí…";
  input.setAttribute("aria-label","Texto que quieres traducir");
  const counter=$("p","translate-counter","0 bytes");
  sourceSide.append(inputLabel,input,counter);
  const targetSide=$("div","translate-box");
  targetSide.append($("p","translate-box-heading","Traducción"));
  const output=$("div","translate-output","Tu traducción aparecerá aquí.");
  output.setAttribute("role","status");output.setAttribute("aria-live","polite");
  output.setAttribute("aria-label","Resultado de traducción");
  const detected=$("p","translate-detected","");
  targetSide.append(output,detected);
  columns.append(sourceSide,targetSide);root.append(columns);
  const actions=$("div","translate-actions");
  const translate=button("Traducir →",runTranslation,"translate-primary");
  const copy=button("⧉ Copiar",async()=>{
    if(!lastTranslation)return;
    try{await navigator.clipboard.writeText(lastTranslation);status.textContent="Traducción copiada.";}
    catch{status.textContent="No se pudo copiar; selecciona el texto de la traducción.";}
  });
  const speak=button("▶ Escuchar",()=>{
    if(!lastTranslation||!("speechSynthesis" in window))return;
    window.speechSynthesis.cancel();
    const msg=new SpeechSynthesisUtterance(lastTranslation);
    msg.lang=to.value==="zh"?"zh-CN":to.value==="pt"?"pt-BR":to.value;
    window.speechSynthesis.speak(msg);
  });
  const retry=button("↻ Reconectar",()=>{
    config=null;void loadConfig(true);
  });
  const clear=button("✕ Limpiar",()=>{
    active?.abort();sequence++;input.value="";lastTranslation="";
    output.textContent="Tu traducción aparecerá aquí.";detected.textContent="";
    status.textContent="";translate.disabled=false;
    copy.disabled=true;speak.disabled=true;counter.textContent="0 bytes";
    input.focus();
  });
  copy.disabled=true;speak.disabled=true;translate.disabled=false;
  actions.append(translate,swap,copy,speak,clear,retry);
  root.append(actions);
  const status=$("p","translate-status","");status.setAttribute("role","status");status.setAttribute("aria-live","polite");
  const privacy=$("p","translate-privacy",
    "Motor local cuando sea compatible. Si usas el servicio conectado, el texto se envía al proveedor solo al pulsar Traducir.");
  root.append(status,privacy);
  let config=null,configRequest=null,active=null,sequence=0,lastTranslation="";
  const fallbackLanguages=[
    {code:"es",name:"Español"},{code:"en",name:"Inglés"},
    {code:"fr",name:"Francés"},{code:"de",name:"Alemán"},
    {code:"it",name:"Italiano"},{code:"pt",name:"Portugués"},
    {code:"ja",name:"Japonés"},{code:"ko",name:"Coreano"},
    {code:"zh",name:"Chino"},{code:"ar",name:"Árabe"},
    {code:"ru",name:"Ruso"},{code:"hi",name:"Hindi"},
    {code:"nl",name:"Neerlandés"},{code:"tr",name:"Turco"}
  ];
  const localAvailable=()=>typeof globalThis.Translator?.create==="function";
  let engine="auto";
  const engineRow=$("div","translate-engine-row");
  const engineLabel=$("label","translate-engine-label","Motor");
  const engineSelect=$("select","translate-select");
  for(const [value,label]of [["auto","Automático · priorizar dispositivo"],["local","En este dispositivo"],["remote","Servicio conectado"]])
    engineSelect.add(new Option(label,value));
  engineSelect.addEventListener("change",()=>{engine=engineSelect.value;status.textContent="";});
  engineLabel.append(engineSelect);
  engineRow.append(engineLabel);
  root.insertBefore(engineRow,columns);
  let ready=false;
  function languageOptions(options,auto) {
    const oldFrom=from.value||"es",oldTo=to.value||"en";
    from.replaceChildren();to.replaceChildren();
    if(auto)from.add(new Option("Detectar idioma","auto"));
    for(const item of options){
      from.add(new Option(item.name,item.code));
      to.add(new Option(item.name,item.code));
    }
    from.value=Array.from(from.options).some(o=>o.value===oldFrom)?oldFrom:"es";
    to.value=Array.from(to.options).some(o=>o.value===oldTo)?oldTo:"en";
  }
  function labelProvider(info){
    if(info.provider==="mymemory")return "MyMemory · traducción externa gratuita limitada";
    if(info.provider==="libretranslate")return "LibreTranslate · servicio externo configurado";
    return "Sin proveedor configurado";
  }
  async function loadConfig(force=false) {
    if(config&&!force)return;
    if(configRequest)return configRequest;
    retry.disabled=true;
    status.textContent="Comprobando motores de traducción…";
    configRequest=(async()=>{
      try{
        const info=await getJSON("/api/translate/capabilities");
        config=info;
        languageOptions(info.languages?.length?info.languages:fallbackLanguages,info.autoDetect===true);
        translate.disabled=false;
        status.textContent=localAvailable()?
          "Traducción local disponible en este navegador · servicio "+(info.available?"conectado.":"sin configurar."):
          info.available?labelProvider(info)+" · Selecciona el motor y traduce.":
            "Servicio no configurado. Puedes volver a comprobar la conexión.";
      }catch{
        config=null;
        translate.disabled=false;
        status.textContent=localAvailable()?
          "Servidor sin conexión; puedes traducir en el dispositivo o reintentar.":
          "Servicio sin conexión. Pulsa ↻ Reconectar; el texto permanece en el editor.";
      }finally{retry.disabled=false;configRequest=null;}
    })();
    return configRequest;
  }
  function updateCounter(){
    const bytes=new TextEncoder().encode(input.value).length;
    counter.textContent=bytes+" byte"+(bytes===1?"":"s")+
      (engine==="remote"&&config?.maxBytes?" / "+config.maxBytes:"");
    if(lastTranslation){lastTranslation="";output.textContent="Pulsa Traducir para actualizar el resultado.";detected.textContent="";}
    copy.disabled=true;speak.disabled=true;
  }
  input.addEventListener("input",updateCounter);
  from.addEventListener("change",updateCounter);
  to.addEventListener("change",updateCounter);
  swap.addEventListener("click",()=>{
    if(!from.value||!to.value)return;
    const original=from.value,goal=to.value;
    from.value=goal;to.value=original==="auto"?"es":original;
    if(lastTranslation){const text=input.value;input.value=lastTranslation;output.textContent=text;lastTranslation=text;copy.disabled=false;speak.disabled=false;}
    else updateCounter();
    status.textContent="Idiomas intercambiados. Pulsa Traducir para obtener una nueva respuesta.";
  });
  async function runTranslation(){
    const text=input.value;
    if(!text.trim()){status.textContent="Escribe un texto para traducir.";input.focus();return;}
    if(from.value===to.value){status.textContent="Selecciona dos idiomas distintos.";return;}
    if(engine==="remote"&&config?.available&&new TextEncoder().encode(text).length>config.maxBytes){
      status.textContent="Texto demasiado largo para "+labelProvider(config)+". Reduce el contenido.";return;
    }
    active?.abort();
    const id=++sequence;
    active=new AbortController();
    translate.disabled=true;copy.disabled=true;speak.disabled=true;
    lastTranslation="";output.textContent="Traduciendo…";detected.textContent="";
    status.textContent="Preparando traducción…";
    try{
      let result=null,localError=null;
      if(engine!=="remote"&&localAvailable()&&from.value!=="auto"){
        try{
          status.textContent="Procesando en este dispositivo; el navegador podría descargar su modelo de idioma.";
          const available=typeof globalThis.Translator.availability==="function"?
            await globalThis.Translator.availability({sourceLanguage:from.value,targetLanguage:to.value}):
            "available";
          if(available==="unavailable")throw new Error("Este par de idiomas no está disponible localmente.");
          if(id!==sequence)return;
          const translator=await globalThis.Translator.create({
            sourceLanguage:from.value,targetLanguage:to.value
          });
          try{
            const translatedText=await translator.translate(text);
            result={translatedText,provider:"motor local del navegador",detectedLanguage:null};
          }finally{translator.destroy?.();}
        }catch(error){localError=error;}
      }
      if(!result&&engine==="local")
        throw new Error(localAvailable()?
          "El motor local no admite este par o no pudo instalarlo. Prueba el servicio conectado.":
          "Tu navegador todavía no ofrece traducción local. Selecciona Servicio conectado.");
      if(!result){
        if(!config?.available)
          throw new Error(localError?
            "No se pudo traducir localmente y el servicio conectado no está disponible. Pulsa ↻ Reconectar.":
            "El servicio no está conectado. Pulsa ↻ Reconectar.");
        const bytes=new TextEncoder().encode(text).length;
        if(bytes>config.maxBytes)throw new Error("El servicio admite "+config.maxBytes+
          " bytes; reduce el texto o utiliza el motor local.");
        status.textContent="Traduciendo mediante "+labelProvider(config)+"…";
        result=await getJSON("/api/translate",active.signal,{
          method:"POST",headers:{"content-type":"application/json"},
          body:JSON.stringify({text,source:from.value,target:to.value})
        });
      }
      if(id!==sequence||!root.isConnected)return;
      if(typeof result.translatedText!=="string"||!result.translatedText.trim())
        throw new Error("El servicio no entregó una traducción válida.");
      lastTranslation=result.translatedText;
      output.textContent=lastTranslation;
      detected.textContent=result.detectedLanguage?
        "Idioma detectado: "+(result.detectedLanguage||""):"";
      status.textContent="Traducción de "+result.provider+" · revisa términos técnicos antes de usarla.";
      copy.disabled=false;speak.disabled=!("speechSynthesis" in window);
    }catch(error){
      if(id!==sequence||error.name==="AbortError")return;
      output.textContent="Sin traducción por ahora. Tu texto sigue en el editor.";
      status.textContent=/HTTP 401|bóveda|deployment|API pública/i.test(error.message||"")?
        "Servicio temporalmente inaccesible. Reintenta o cambia a motor local.": 
        error.message||"No se pudo traducir. Puedes reintentar.";
    }finally{if(id===sequence){translate.disabled=false;active=null;}}
  }
  function show(){
    answer.replaceChildren();weatherSlot.replaceChildren();panel.replaceChildren();
    sourceFilter.replaceChildren(new Option("Todas las fuentes",""));
    resultsContainer.replaceChildren(root);
    stats.textContent="Traductor WAEWEB · dispositivo o servicio conectado";
    if(!ready){ready=true;languageOptions(fallbackLanguages,false);}
    void loadConfig();
    input.focus({preventScroll:true});
  }
  function hide(){active?.abort();sequence++;active=null;if("speechSynthesis" in window)window.speechSynthesis.cancel();}
  return {show,hide};
}
