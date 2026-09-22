// Public read-only diagnostics: no private tokens, no cookies, no uploads.
const byId=id=>document.getElementById(id);
const checks=[
  {label:"Backend WAEWEB",path:"/api/health"},
  {label:"Capacidades públicas",path:"/api/capabilities"},
  {label:"Mapas · coordenadas",path:"/api/maps?q=20.6767%2C-103.3475"},
  {label:"Motor de rutas",path:"/api/directions/capabilities"},
  {label:"Traductor",path:"/api/translate/capabilities"}
];
const append=(parent,tag,text,className="")=>{
  const el=document.createElement(tag);
  if(className)el.className=className;
  el.textContent=String(text??"");
  parent.append(el);return el;
};
async function probe({label,path}){
  try{
    const response=await fetch(path,{
      method:"GET",credentials:"omit",cache:"no-store",
      headers:{accept:"application/json"},signal:AbortSignal.timeout(9000)
    });
    const official=response.headers.get("x-waeweb-api")==="1";
    const mime=response.headers.get("content-type")||"";
    let body=null;
    if(mime.includes("application/json")){
      try{body=await response.json();}catch{}
    }
    let verdict;
    if(response.status===401&&!official)verdict="401 antes del backend; posible protección del despliegue o enrutamiento.";
    else if(response.status===401)verdict="401 devuelto por la API de WAEWEB; revisar middleware de esa ruta.";
    else if(response.status===403&&!official)verdict="403 antes del backend; probable restricción de acceso al despliegue.";
    else if(response.status===404&&!official)verdict="404 sin marca WAEWEB: puede faltar la función o apuntar a una versión anterior.";
    else if(!official)verdict="La respuesta no tiene la marca WAEWEB; comprueba enrutamiento y versión.";
    else if(!response.ok)verdict="Error explícito del backend: "+(body?.error||"HTTP "+response.status);
    else verdict="API pública accesible.";
    let detail="";
    if(path==="/api/health"&&official&&body?.version)
      detail="Versión publicada: "+String(body.version).slice(0,60)+" · preview: "+String(body.previewMode===true);
    if(path==="/api/capabilities"&&official){
      detail="Mapas: "+(body?.mapsEnabled===true?"habilitado":"no confirmado")+
        " · Rutas: "+(body?.directions?.enabled===true?"configuradas":"sin proveedor activo")+
        " · Cuentas: "+(body?.accountsEnabled===true?"habilitadas":"desactivadas");
    }
    if(path==="/api/directions/capabilities"&&official)
      detail="Rutas: "+(body?.enabled===true?"proveedor configurado":"proveedor no configurado")+
        " · direcciones precisas: "+(body?.addressSearch?.enabled===true?"disponibles":"sin configurar");
    return {label,path,status:response.status,official,verdict,detail};
  }catch(error){
    return {label,path,status:null,official:false,
      verdict:"No se pudo conectar: "+(error.name==="TimeoutError"?"tiempo de espera agotado":"fallo de red"),
      detail:"Verifica conexión, DNS o restricciones del navegador."};
  }
}
async function run(){
  const button=byId("run-diagnostics"),results=byId("diag-results"),status=byId("diag-status");
  button.disabled=true;results.replaceChildren();
  status.textContent="Consultando cinco rutas públicas, sin credenciales…";
  const outcomes=[];
  try{
    // Small number of sequential probes: avoids a burst of requests.
    for(const check of checks){
      const answer=await probe(check);outcomes.push(answer);
      const row=append(results,"article","","diag-row");
      append(row,"strong",answer.label);
      append(row,"span",answer.status===null?"SIN CONEXIÓN":"HTTP "+answer.status,
        answer.status===200&&answer.official?"diag-ok":"diag-warn");
      append(row,"p",answer.verdict);
      if(answer.detail)append(row,"small",answer.detail);
      append(row,"code",answer.path);
    }
    const upstream=outcomes.filter(x=>[401,403].includes(x.status)&&!x.official);
    const absent=outcomes.filter(x=>x.status===404&&!x.official);
    if(upstream.length){
      status.textContent="Diagnóstico: "+upstream.length+
        " ruta(s) bloqueadas antes de WAEWEB. Revisa Deployment Protection y dominio de producción en Vercel; no es un error de tu bóveda.";
    }else if(absent.length){
      status.textContent="Diagnóstico: faltan rutas API en el despliegue. Comprueba la rama y la configuración de funciones.";
    }else if(outcomes.every(x=>x.status===200&&x.official)){
      status.textContent="Las cinco API públicas responden. Si el mapa aparece en blanco, revisa por separado el iframe de OpenStreetMap.";
    }else{
      status.textContent="Hay incidencias específicas de red o módulos. Comprueba cada resultado sin confundirlo con un problema de credenciales privadas.";
    }
  }finally{button.disabled=false;}
}
byId("run-diagnostics").addEventListener("click",()=>void run());
