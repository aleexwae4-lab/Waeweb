import {routeDiagram,durationLabel,distanceLabel} from "/directions-core.js";

// A first-class directions panel inside the existing WAEWEB Maps tab.
// Explicit submit only: no live tracking, no implicit geolocation or reroutes.
export function createDirections({getJSON,element,button,external,copyText}){
  const root=element("section","directions-panel");
  root.setAttribute("aria-label","Cómo llegar e indicaciones de ruta");
  root.append(element("span","tag","WAEWEB · CÓMO LLEGAR"),
    element("h3","","Traza tu recorrido"),
    element("p","directions-note",
      "Elige origen, destino y cómo viajas. Las ciudades representan centros aproximados; para puntos precisos utiliza latitud y longitud."));
  const form=element("form","directions-form");
  const fromLabel=element("label","directions-field","Origen");
  const from=element("input","directions-input");from.name="origin";from.placeholder="Ciudad o 20.6767,-103.3475";
  from.maxLength=180;from.required=true;from.autocomplete="off";from.setAttribute("aria-label","Origen");
  fromLabel.append(from);
  const toLabel=element("label","directions-field","Destino");
  const to=element("input","directions-input");to.name="destination";to.placeholder="Ciudad o latitud,longitud";
  to.maxLength=180;to.required=true;to.autocomplete="off";to.setAttribute("aria-label","Destino");
  toLabel.append(to);
  const modeLabel=element("label","directions-field","Medio de transporte");
  const mode=element("select","directions-input");
  for(const [value,label] of [["driving","🚗 Automóvil"],["walking","🚶 Caminando"],["cycling","🚲 Bicicleta"]]){
    const option=new Option(label,value);mode.append(option);
  }
  modeLabel.append(mode);
  const calculate=element("button","directions-primary","Calcular ruta →");
  calculate.type="submit";calculate.disabled=true;
  form.append(fromLabel,toLabel,modeLabel,calculate);
  root.append(form);
  const actions=element("div","directions-actions");
  const gps=button("⌖ Usar mi ubicación",requestPosition,"directions-action");
  gps.title="Pide permiso una sola vez. No activa seguimiento GPS.";
  const flip=button("⇄ Intercambiar",()=>{
    const original=from.value;from.value=to.value;to.value=original;resetResult();
  },"directions-action");
  const reset=button("✕ Limpiar ruta",()=>{
    active?.abort();sequence++;active=null;
    from.value="";resetResult();from.focus();
  },"directions-action");
  actions.append(gps,flip,reset);root.append(actions);
  const state=element("p","directions-state","Comprobando el motor de rutas.");
  state.setAttribute("role","status");state.setAttribute("aria-live","polite");root.append(state);
  const outcome=element("div","directions-result");root.append(outcome);
  const detail=element("p","directions-disclaimer",
    "Las rutas son estimadas; no se ofrece navegación GPS en vivo, tráfico en tiempo real ni indicaciones de seguridad vial.");
  root.append(detail);

  let enabled=false,active=null,sequence=0,lastResult=null,selectedPlace=null,disposed=false;
  async function loadCapability(){
    try{
      const caps=await getJSON("/api/directions/capabilities");
      if(disposed||!root.isConnected)return;
      enabled=caps.enabled===true;
      calculate.disabled=!enabled;
      state.textContent=caps.note||"Proveedor de rutas no configurado.";
    }catch(err){
      if(disposed||!root.isConnected)return;
      enabled=false;calculate.disabled=true;
      state.textContent="La API de rutas no respondió: "+(err.message||"servicio no disponible.");
    }
  }
  function setDestination(place){
    if(!place||!Number.isFinite(place.latitude)||!Number.isFinite(place.longitude))return;
    selectedPlace=place;
    to.value=place.latitude.toFixed(6)+","+place.longitude.toFixed(6);
    active?.abort();sequence++;active=null;resetResult();
    state.textContent=enabled?
      "Destino: "+place.name+" · "+(place.precision==="coordinate"?
        "coordenadas proporcionadas":"centro aproximado de localidad"):
      "Destino preparado. Configura el motor de rutas para calcular el trayecto.";
  }
  function resetResult(){
    lastResult=null;outcome.replaceChildren();
  }
  function renderDiagram(result){
    const sketch=routeDiagram(result.geometry);
    const stage=element("div","directions-sketch");
    stage.setAttribute("role","img");
    stage.setAttribute("aria-label","Esquema del trayecto real calculado. No contiene calles de fondo ni ubicación en vivo.");
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.setAttribute("viewBox","0 0 "+sketch.width+" "+sketch.height);
    svg.setAttribute("class","directions-route-svg");
    svg.setAttribute("preserveAspectRatio","xMidYMid meet");
    const ns="http://www.w3.org/2000/svg";
    const path=document.createElementNS(ns,"path");
    path.setAttribute("d",sketch.path);
    path.setAttribute("fill","none");path.setAttribute("stroke","#87baff");
    path.setAttribute("stroke-width","5");path.setAttribute("stroke-linejoin","round");
    path.setAttribute("stroke-linecap","round");
    svg.append(path);
    for(const [point,type] of [[sketch.points[0],"A"],[sketch.points.at(-1),"B"]]){
      const circle=document.createElementNS(ns,"circle");
      circle.setAttribute("cx",String(point.x));circle.setAttribute("cy",String(point.y));
      circle.setAttribute("r","12");circle.setAttribute("fill",type==="A"?"#68dfba":"#c9a7ff");
      circle.setAttribute("stroke","#0b1326");circle.setAttribute("stroke-width","3");
      const label=document.createElementNS(ns,"text");
      label.setAttribute("x",String(point.x));label.setAttribute("y",String(point.y+4));
      label.setAttribute("text-anchor","middle");label.setAttribute("fill","#081223");
      label.setAttribute("font-size","11");label.setAttribute("font-weight","bold");
      label.textContent=type;svg.append(circle,label);
    }
    stage.append(svg,element("p","directions-sketch-caption",
      "Esquema con geometría devuelta por el motor de rutas · sin calles de fondo ni seguimiento GPS."));
    return stage;
  }
  function showRoute(result){
    outcome.replaceChildren();lastResult=result;
    const header=element("div","directions-result-header");
    header.append(element("strong","","Ruta "+mode.options[mode.selectedIndex].text),
      element("span","directions-metric",distanceLabel(result.distanceMeters)+" · "+
        durationLabel(result.durationSeconds)));
    outcome.append(header,element("p","directions-place","A · "+result.origin.name+
      (result.origin.detail?" · "+result.origin.detail:"")),
      element("p","directions-place","B · "+result.destination.name+
        (result.destination.detail?" · "+result.destination.detail:"")));
    if(result.origin.precision!=="coordinate"||result.destination.precision!=="coordinate")
      outcome.append(element("p","directions-warning",
        "Al menos un punto es un centro aproximado de localidad. Para llegar a una dirección exacta, introduce sus coordenadas verificadas."));
    outcome.append(renderDiagram(result));
    const copy=button("⧉ Copiar indicaciones",()=>copyText([
      "WAEWEB · Cómo llegar","Origen: "+result.origin.name,
      "Destino: "+result.destination.name,
      distanceLabel(result.distanceMeters)+" · "+durationLabel(result.durationSeconds),
      ...result.steps.map(step=>step.number+". "+step.instruction+
        " ("+distanceLabel(step.distanceMeters)+")")
    ].join("\n")),"directions-action");
    outcome.append(copy,element("h4","","Indicaciones paso a paso"));
    const list=element("ol","directions-steps");
    for(const step of result.steps){
      const li=element("li","directions-step");
      li.append(element("p","",step.instruction),
        element("small","",distanceLabel(step.distanceMeters)+
          " · "+durationLabel(step.durationSeconds)));
      list.append(li);
    }
    outcome.append(list,element("p","directions-credit",
      result.attribution+" · "+result.caveat));
    outcome.append(external("https://www.openstreetmap.org/copyright",
      "© OpenStreetMap contributors · licencia","map-credit-link"));
  }
  async function calculateRoute(event){
    event.preventDefault();
    if(!enabled){state.textContent="Motor de rutas no configurado; no se crean recorridos ficticios.";return;}
    if(!from.value.trim()||!to.value.trim()){
      state.textContent="Completa el origen y el destino.";return;
    }
    active?.abort();const id=++sequence;active=new AbortController();
    calculate.disabled=true;resetResult();
    state.textContent="Consultando vías reales e indicaciones…";
    try{
      const result=await getJSON("/api/directions",active.signal,{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify({origin:from.value.trim(),destination:to.value.trim(),mode:mode.value})
      });
      if(disposed||id!==sequence||!root.isConnected)return;
      if(!Array.isArray(result.geometry)||!Array.isArray(result.steps)||!result.steps.length)
        throw new Error("El motor de rutas no entregó un recorrido e indicaciones válidos.");
      showRoute(result);
      state.textContent="Ruta calculada · "+result.source+" · tiempos estimados.";
    }catch(error){
      if(disposed||id!==sequence||error.name==="AbortError")return;
      outcome.replaceChildren();
      state.textContent=error.message||"No se pudo calcular la ruta.";
    }finally{if(id===sequence){calculate.disabled=!enabled;active=null;}}
  }
  form.addEventListener("submit",calculateRoute);
  async function requestPosition(){
    if(!("geolocation" in navigator)){
      state.textContent="Este navegador no ofrece ubicación GPS.";return;
    }
    if(!window.isSecureContext){
      state.textContent="La ubicación necesita HTTPS y permiso del navegador.";return;
    }
    gps.disabled=true;
    state.textContent="El navegador solicitará tu permiso para obtener una ubicación puntual.";
    navigator.geolocation.getCurrentPosition(position=>{
      gps.disabled=false;if(disposed||!root.isConnected)return;
      from.value=position.coords.latitude.toFixed(6)+","+position.coords.longitude.toFixed(6);
      resetResult();
      state.textContent="Ubicación introducida como origen. No hay seguimiento continuo; pulsa Calcular ruta para compartir los puntos.";
    },()=>{
      gps.disabled=false;if(disposed||!root.isConnected)return;
      state.textContent="No se pudo obtener permiso o señal GPS. Escribe el origen manualmente.";
    },{enableHighAccuracy:false,timeout:11000,maximumAge:0});
  }
  from.addEventListener("input",resetResult);
  to.addEventListener("input",resetResult);
  mode.addEventListener("change",resetResult);
  function dispose(){disposed=true;active?.abort();sequence++;active=null;}
  void loadCapability();
  return {root,setDestination,dispose};
}
