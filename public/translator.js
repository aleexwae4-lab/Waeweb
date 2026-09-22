// Dedicated text translator: mounted as a WAEWEB search tab, never a vault.
// Transmits text only on an explicit click, with on-screen provider disclosure.
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
  const desc=$("p","translate-description","Traduce texto entre idiomas desde WAEWEB. No requiere Índice WAE ni bóveda.");
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
  const clear=button("✕ Limpiar",()=>{
    active?.abort();sequence++;input.value="";lastTranslation="";
    output.textContent="Tu traducción aparecerá aquí.";detected.textContent="";
    status.textContent="";translate.disabled=!config?.available;
    copy.disabled=true;speak.disabled=true;counter.textContent="0 bytes";
    input.focus();
  });
  copy.disabled=true;speak.disabled=true;translate.disabled=true;
  actions.append(translate,swap,copy,speak,clear);
  root.append(actions);
  const status=$("p","translate-status","");status.setAttribute("role","status");status.setAttribute("aria-live","polite");
  const privacy=$("p","translate-privacy",
    "No introduzcas datos confidenciales. El texto se comparte con un proveedor externo solo al pulsar Traducir; WAEWEB no lo guarda en la bóveda.");
  root.append(status,privacy);
  let config=null,configRequest=null,active=null,sequence=0,lastTranslation="";
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
  async function loadConfig() {
    if(config)return;
    if(configRequest)return configRequest;
    status.textContent="Comprobando disponibilidad del traductor…";
    configRequest=(async()=>{
      try{
        const info=await getJSON("/api/translate/capabilities");
        config=info;
        languageOptions(info.languages||[],info.autoDetect===true);
        translate.disabled=!info.available;
        privacy.textContent=(info.privacy||"No introduzcas datos confidenciales.")+" "+
          (info.provider==="mymemory"?
            "MyMemory admite textos breves; límites gratuitos y privacidad dependen del proveedor.":
            "Los idiomas admitidos dependen del servidor de traducción configurado.");
        status.textContent=info.available?
          labelProvider(info)+" · Máximo "+info.maxBytes+" bytes por solicitud.":
          "Traductor no disponible: configura un motor autorizado en el servidor.";
      }catch(error){
        translate.disabled=true;
        status.textContent="No se pudo conectar con la API del traductor: "+error.message;
      }finally{configRequest=null;}
    })();
    return configRequest;
  }
  function updateCounter(){
    const bytes=new TextEncoder().encode(input.value).length;
    counter.textContent=bytes+" byte"+(bytes===1?"":"s")+
      (config?.maxBytes?" / "+config.maxBytes:"");
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
    if(!config?.available)return;
    const text=input.value;
    if(!text.trim()){status.textContent="Escribe un texto para traducir.";input.focus();return;}
    if(from.value===to.value){status.textContent="Selecciona dos idiomas distintos.";return;}
    if(new TextEncoder().encode(text).length>config.maxBytes){
      status.textContent="Texto demasiado largo para "+labelProvider(config)+". Reduce el contenido.";return;
    }
    active?.abort();
    const id=++sequence;
    active=new AbortController();
    translate.disabled=true;copy.disabled=true;speak.disabled=true;
    lastTranslation="";output.textContent="Traduciendo…";detected.textContent="";
    status.textContent="Enviando únicamente este texto a "+labelProvider(config)+".";
    try{
      const result=await getJSON("/api/translate",active.signal,{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({text,source:from.value,target:to.value})
      });
      if(id!==sequence||!root.isConnected)return;
      if(typeof result.translatedText!=="string"||!result.translatedText.trim())
        throw new Error("El servicio no entregó una traducción válida.");
      lastTranslation=result.translatedText;
      output.textContent=lastTranslation;
      detected.textContent=result.detectedLanguage?
        "Idioma detectado: "+(result.detectedLanguage||""):"";
      status.textContent="Traducción recibida de "+result.provider+". Verifica expresiones técnicas antes de utilizarlas.";
      copy.disabled=false;speak.disabled=!("speechSynthesis" in window);
    }catch(error){
      if(id!==sequence||error.name==="AbortError")return;
      output.textContent="No se obtuvo una traducción.";
      status.textContent=error.message||"Proveedor de traducción no disponible.";
    }finally{if(id===sequence){translate.disabled=!config?.available;active=null;}}
  }
  function show(){
    answer.replaceChildren();weatherSlot.replaceChildren();panel.replaceChildren();
    sourceFilter.replaceChildren(new Option("Todas las fuentes",""));
    resultsContainer.replaceChildren(root);
    stats.textContent="Traductor WAEWEB · texto enviado solo al pulsar Traducir";
    if(!ready){ready=true;languageOptions([
      {code:"es",name:"Español"},{code:"en",name:"Inglés"}
    ],false);}
    void loadConfig();
    input.focus({preventScroll:true});
  }
  function hide(){active?.abort();sequence++;active=null;if("speechSynthesis" in window)window.speechSynthesis.cancel();}
  return {show,hide};
}
