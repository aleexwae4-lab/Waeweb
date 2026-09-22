import {routeDiagram,durationLabel,distanceLabel} from "/directions-core.js";

// A first-class directions panel inside the existing WAEWEB Maps tab.
// Explicit submit only: no live tracking, no implicit geolocation or reroutes.
export function createDirections({getJSON,element,button,external,copyText,onDestinationSelect=()=>{}}){
  const root=element("section","directions-panel");
  root.setAttribute("aria-label","Cómo llegar e indicaciones de ruta");
  root.append(element("span","tag","WAEWEB · CÓMO LLEGAR"),
    element("h3","","Traza tu recorrido"),
    element("p","directions-note",
      "Busca direcciones o lugares y selecciona una coincidencia antes de calcular. También puedes escribir coordenadas (latitud,longitud)."));
  const form=element("form","directions-form");
  const fromLabel=element("div","directions-field");
  const fromCaption=element("label","","Origen");fromCaption.htmlFor="directions-origin";
  fromLabel.append(fromCaption);
  const from=element("input","directions-input");from.name="origin";from.placeholder="Ciudad o 20.6767,-103.3475";
  from.maxLength=180;from.required=true;from.autocomplete="off";from.id="directions-origin";from.setAttribute("aria-label","Origen");
  const fromLookup=button("⌕ Buscar origen",()=>searchCandidates("origin"),"directions-find");
  const fromMatches=element("div","directions-matches");
  fromMatches.setAttribute("aria-label","Coincidencias de origen");
  fromLabel.append(from,fromLookup,fromMatches);
  const toLabel=element("div","directions-field");
  const toCaption=element("label","","Destino");toCaption.htmlFor="directions-destination";
  toLabel.append(toCaption);
  const to=element("input","directions-input");to.name="destination";to.placeholder="Ciudad o latitud,longitud";
  to.maxLength=180;to.required=true;to.autocomplete="off";to.id="directions-destination";to.setAttribute("aria-label","Destino");
  const toLookup=button("⌕ Buscar destino",()=>searchCandidates("destination"),"directions-find");
  const toMatches=element("div","directions-matches");
  toMatches.setAttribute("aria-label","Coincidencias de destino");
  toLabel.append(to,toLookup,toMatches);
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
    const original=from.value;from.value=to.value;to.value=original;
    const selected=chosen.origin;chosen.origin=chosen.destination;chosen.destination=selected;
    cancelLookups();fromMatches.replaceChildren();toMatches.replaceChildren();
    resetResult();
  },"directions-action");
  const reset=button("✕ Limpiar ruta",()=>{
    active?.abort();sequence++;active=null;
    from.value="";chosen.origin=null;cancelLookups();
    fromMatches.replaceChildren();toMatches.replaceChildren();resetResult();from.focus();
  },"directions-action");
  actions.append(gps,flip,reset);root.append(actions);
  const state=element("p","directions-state","Comprobando el motor de rutas.");
  state.setAttribute("role","status");state.setAttribute("aria-live","polite");root.append(state);
  const outcome=element("div","directions-result");root.append(outcome);
  const detail=element("p","directions-disclaimer",
    "Las rutas son estimadas; no se ofrece navegación GPS en vivo, tráfico en tiempo real ni indicaciones de seguridad vial.");
  root.append(detail);

  let enabled=false,active=null,sequence=0,lastResult=null,disposed=false;
  const chosen={origin:null,destination:null};
  const lookups={origin:null,destination:null},lookupVersion={origin:0,destination:0};
  let addressReady=false;
  const asCoordinate=place=>place.latitude.toFixed(6)+","+place.longitude.toFixed(6);
  const quality=level=>({
    address_point:"Dirección localizada (punto del proveedor; no verificación postal)",
    place_point:"Lugar localizado (punto del proveedor; no verificación de acceso)",
    approximate_address:"Dirección aproximada",
    street_centroid:"Centro aproximado de calle",
    locality_centroid:"Centro aproximado de localidad",
    coordinate:"Coordenadas proporcionadas"
  })[level]||"Ubicación aproximada";
  function cancelLookups(){
    for(const side of ["origin","destination"]){
      lookups[side]?.abort();lookups[side]=null;lookupVersion[side]++;
    }
    fromLookup.disabled=!addressReady;toLookup.disabled=!addressReady;
  }
  function choose(side,place){
    if(disposed||!Number.isFinite(place.latitude)||!Number.isFinite(place.longitude))return;
    const field=side==="origin"?from:to;
    const matches=side==="origin"?fromMatches:toMatches;
    lookups[side]?.abort();lookups[side]=null;lookupVersion[side]++;
    field.value=asCoordinate(place);
    chosen[side]={...place,coordinate:field.value};
    if(side==="destination")onDestinationSelect(place);
    matches.replaceChildren(element("p","directions-selection",
      "✓ "+(place.detail||place.name)+" · "+quality(place.precision)));
    resetResult();
    state.textContent="Punto seleccionado. Comprueba el marcador y pulsa Calcular ruta.";
  }
  async function searchCandidates(side){
    const input=side==="origin"?from:to;
    const matches=side==="origin"?fromMatches:toMatches;
    const searchButton=side==="origin"?fromLookup:toLookup;
    const query=input.value.trim();
    if(!addressReady){
      state.textContent="Configura el proveedor de direcciones o escribe coordenadas manualmente.";return;
    }
    if(query.length<3){
      state.textContent="Escribe al menos tres caracteres para buscar.";input.focus();return;
    }
    lookups[side]?.abort();
    const request=new AbortController();lookups[side]=request;
    const id=++lookupVersion[side];
    chosen[side]=null;matches.replaceChildren();
    searchButton.disabled=true;
    matches.append(element("p","directions-match-status","Buscando coincidencias del proveedor…"));
    try{
      const data=await getJSON("/api/places?q="+encodeURIComponent(query),request.signal);
      if(disposed||id!==lookupVersion[side]||!root.isConnected)return;
      matches.replaceChildren();
      if(!Array.isArray(data.results)||!data.results.length){
        matches.append(element("p","directions-match-status",
          data.message||"No se encontraron direcciones. Prueba añadiendo ciudad o país."));
        return;
      }
      matches.append(element("p","directions-match-status",
        "Elige una coincidencia; no se selecciona automáticamente la primera."));
      for(const place of data.results){
        if(!Number.isFinite(place.latitude)||!Number.isFinite(place.longitude))continue;
        const caption=(place.detail||place.name)+" · "+quality(place.precision);
        const item=button(caption,()=>choose(side,place),"directions-candidate");
        item.setAttribute("aria-label","Seleccionar "+(side==="origin"?"origen: ":"destino: ")+caption);
        matches.append(item);
      }
    }catch(error){
      if(disposed||id!==lookupVersion[side]||error.name==="AbortError")return;
      matches.replaceChildren(element("p","directions-match-status",
        error.message||"La búsqueda de lugares no está disponible."));
    }finally{
      if(id===lookupVersion[side]){
        lookups[side]=null;searchButton.disabled=!addressReady;
      }
    }
  }
  async function loadCapability(){
    try{
      const caps=await getJSON("/api/directions/capabilities");
      if(disposed||!root.isConnected)return;
      enabled=caps.enabled===true;
      addressReady=caps.addressSearch?.enabled===true;
      fromLookup.disabled=!addressReady;toLookup.disabled=!addressReady;
      calculate.disabled=!enabled;
      state.textContent=caps.note||"Proveedor de rutas no configurado.";
    }catch(err){
      if(disposed||!root.isConnected)return;
      enabled=false;addressReady=false;
      fromLookup.disabled=true;toLookup.disabled=true;calculate.disabled=true;
      state.textContent="La API de rutas no respondió: "+(err.message||"servicio no disponible.");
    }
  }
  function setDestination(place){
    if(!place||!Number.isFinite(place.latitude)||!Number.isFinite(place.longitude))return;
    active?.abort();sequence++;active=null;
    choose("destination",place);
    state.textContent=enabled?
      "Destino: "+place.name+" · "+quality(place.precision)+". Selecciona el origen.":
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
    const originLabel=chosen.origin?.coordinate===from.value?
      chosen.origin.detail||chosen.origin.name:result.origin.name;
    const destinationLabel=chosen.destination?.coordinate===to.value?
      chosen.destination.detail||chosen.destination.name:result.destination.name;
    outcome.append(header,element("p","directions-place","A · "+originLabel),
      element("p","directions-place","B · "+destinationLabel));
    if([chosen.origin,chosen.destination].some(place=>place?.approximate||
      ["approximate_address","street_centroid","locality_centroid"].includes(place?.precision)))
      outcome.append(element("p","directions-warning",
        "Hay puntos aproximados de geocodificación. Confirma el acceso y la ubicación real antes de viajar."));
    outcome.append(renderDiagram(result));
    const copy=button("⧉ Copiar indicaciones",()=>copyText([
      "WAEWEB · Cómo llegar","Origen: "+originLabel,
      "Destino: "+destinationLabel,
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
      chosen.origin=null;lookups.origin?.abort();lookupVersion.origin++;
      fromMatches.replaceChildren();resetResult();
      state.textContent="Ubicación introducida como origen. No hay seguimiento continuo; pulsa Calcular ruta para compartir los puntos.";
    },()=>{
      gps.disabled=false;if(disposed||!root.isConnected)return;
      state.textContent="No se pudo obtener permiso o señal GPS. Escribe el origen manualmente.";
    },{enableHighAccuracy:false,timeout:11000,maximumAge:0});
  }
  from.addEventListener("input",()=>{
    chosen.origin=null;lookups.origin?.abort();lookupVersion.origin++;
    fromMatches.replaceChildren();resetResult();
  });
  to.addEventListener("input",()=>{
    chosen.destination=null;lookups.destination?.abort();lookupVersion.destination++;
    toMatches.replaceChildren();resetResult();
  });
  mode.addEventListener("change",resetResult);
  function dispose(){
    disposed=true;active?.abort();sequence++;active=null;cancelLookups();
  }
  void loadCapability();
  return {root,setDestination,dispose};
}
