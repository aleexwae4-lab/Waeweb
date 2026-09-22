// WAEWEB RC33 · owned SVG geographic viewport. No third-party iframe,
// tiles, network requests or invented roads. Points and ORS geometry only.
import {validMapPlace,osmPlaceUrl} from "/maps-core.js";

const svgNS="http://www.w3.org/2000/svg";
const el=(tag)=>document.createElementNS(svgNS,tag);
const finite=n=>typeof n==="number"&&Number.isFinite(n);
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const normLon=x=>((x+180)%360+360)%360-180;
export function createNativeMap(){
  const root=document.createElement("section");
  root.className="wae-native-map";
  root.setAttribute("aria-label","Mapa geográfico interactivo WAEWEB");
  const toolbar=document.createElement("div");toolbar.className="wae-native-map-toolbar";
  const title=document.createElement("strong");title.textContent="WAEWEB · MAPA";
  const tag=document.createElement("span");tag.className="wae-native-map-badge";tag.textContent="Vista geográfica nativa";
  toolbar.append(title,tag);
  const area=document.createElement("div");area.className="wae-native-map-area";
  const svg=el("svg");svg.setAttribute("viewBox","0 0 900 460");
  svg.setAttribute("role","img");svg.setAttribute("aria-label","Coordenadas geográficas, puntos seleccionados y ruta cuando está disponible. No muestra calles.");
  svg.setAttribute("preserveAspectRatio","xMidYMid meet");
  svg.setAttribute("tabindex","0");
  area.append(svg);
  const controls=document.createElement("div");controls.className="wae-native-map-controls";
  const make=(label,fn)=>{
    const b=document.createElement("button");b.type="button";b.textContent=label;
    b.addEventListener("click",fn);controls.append(b);return b;
  };
  const plus=make("+",()=>changeZoom(1)),minus=make("−",()=>changeZoom(-1));
  make("⌖ Centrar",()=>{if(point)setView(point);else setWorld();});
  area.append(controls);
  const footer=document.createElement("p");footer.className="wae-native-map-note";
  footer.textContent="Vista de coordenadas propia. No hay calles ni imágenes de satélite; las rutas se trazan solo cuando el proveedor devuelve geometría real.";
  const details=document.createElement("p");details.className="wae-native-map-detail";details.setAttribute("aria-live","polite");
  root.append(toolbar,area,details,footer);
  let center={latitude:23.6,longitude:-102.5},level=0,point=null,geometry=null,label="",disposed=false;
  const spans=[{lat:40,lon:78},{lat:14,lon:28},{lat:4.5,lon:9},{lat:1.4,lon:2.8},{lat:.4,lon:.8},{lat:.1,lon:.2},{lat:.025,lon:.05}];
  function project(lon,lat){
    const span=spans[level];
    const dx=normLon(lon-center.longitude);
    return {x:450+dx/span.lon*900,y:230-(lat-center.latitude)/span.lat*460};
  }
  function line(parent,x1,y1,x2,y2,cls){
    const l=el("line");
    for(const[k,v]of Object.entries({x1,y1,x2,y2}))l.setAttribute(k,String(v));
    l.setAttribute("class",cls);parent.append(l);
  }
  function text(parent,x,y,value,cls){
    const t=el("text");t.setAttribute("x",String(x));t.setAttribute("y",String(y));
    t.setAttribute("class",cls);t.textContent=value;parent.append(t);
  }
  function draw(){
    if(disposed)return;
    svg.replaceChildren();
    const defs=el("defs"),gradient=el("linearGradient");gradient.id="wae-map-gradient";
    gradient.setAttribute("x1","0");gradient.setAttribute("x2","1");
    gradient.setAttribute("y1","0");gradient.setAttribute("y2","1");
    for(const [offset,color]of [["0%","#071727"],["100%","#142c42"]]){
      const stop=el("stop");stop.setAttribute("offset",offset);stop.setAttribute("stop-color",color);gradient.append(stop);
    }
    defs.append(gradient);svg.append(defs);
    const bg=el("rect");bg.setAttribute("width","900");bg.setAttribute("height","460");
    bg.setAttribute("fill","url(#wae-map-gradient)");svg.append(bg);
    const s=spans[level],latStep=s.lat/4,lonStep=s.lon/6;
    // Geographic graticule is exact latitude/longitude, not fictional roads.
    const firstLat=Math.ceil((center.latitude-s.lat/2)/latStep)*latStep;
    for(let lat=firstLat;lat<center.latitude+s.lat/2;lat+=latStep){
      const p=project(center.longitude,lat);
      if(p.y<12||p.y>455)continue;
      line(svg,0,p.y,900,p.y,"wae-map-grid");
      text(svg,12,p.y-7,lat.toFixed(level<2?1:3)+"°","wae-map-axis");
    }
    const firstLon=Math.ceil((center.longitude-s.lon/2)/lonStep)*lonStep;
    for(let lon=firstLon;lon<center.longitude+s.lon/2;lon+=lonStep){
      const p=project(lon,center.latitude);
      if(p.x<30||p.x>890)continue;
      line(svg,p.x,0,p.x,460,"wae-map-grid");
      text(svg,p.x+5,445,normLon(lon).toFixed(level<2?1:3)+"°","wae-map-axis");
    }
    line(svg,450,0,450,460,"wae-map-cross");
    line(svg,0,230,900,230,"wae-map-cross");
    if(geometry&&geometry.length>=2){
      const path=el("path");
      const data=geometry.filter(p=>Array.isArray(p)&&p.length>=2&&finite(p[0])&&finite(p[1])&&
        Math.abs(p[0])<=180&&Math.abs(p[1])<=90);
      if(data.length>=2){
        path.setAttribute("d",data.map(([lon,lat],i)=>{
          const p=project(lon,lat);return (i?"L":"M")+p.x.toFixed(2)+" "+p.y.toFixed(2);
        }).join(" "));
        path.setAttribute("class","wae-map-real-route");svg.append(path);
      }
    }
    if(point&&validMapPlace(point)){
      const p=project(point.longitude,point.latitude);
      if(p.x>=0&&p.x<=900&&p.y>=0&&p.y<=460){
        const halo=el("circle");halo.setAttribute("cx",p.x);halo.setAttribute("cy",p.y);
        halo.setAttribute("r","21");halo.setAttribute("class","wae-map-marker-halo");svg.append(halo);
        const marker=el("circle");marker.setAttribute("cx",p.x);marker.setAttribute("cy",p.y);
        marker.setAttribute("r","9");marker.setAttribute("class","wae-map-marker");svg.append(marker);
        const title=el("title");title.textContent=label||"Ubicación marcada";marker.append(title);
      }
    }
    text(svg,18,32,"N ↑","wae-map-compass");
    text(svg,18,423,"WAEWEB · DATOS GEOGRÁFICOS","wae-map-watermark");
    details.textContent=(point?label+" · "+point.latitude.toFixed(6)+", "+point.longitude.toFixed(6):
      "Vista general · centro aproximado de México")+" · Acercamiento "+(level+1)+"/7";
    plus.disabled=level>=spans.length-1;minus.disabled=level<=0;
  }
  function setView(place,zoom=3){
    if(!validMapPlace(place))return;
    point=place;center={latitude:clamp(place.latitude,-90,90),longitude:normLon(place.longitude)};
    label=String(place.detail||place.name||"Punto geográfico");
    level=clamp(Math.trunc(zoom)+1,0,spans.length-1);
    geometry=null;draw();
  }
  function setWorld(){point=null;geometry=null;level=0;center={latitude:23.6,longitude:-102.5};label="";draw();}
  function changeZoom(amount){level=clamp(level+amount,0,spans.length-1);draw();}
  function setRoute(coords){
    if(!Array.isArray(coords)||coords.length<2||coords.length>6000)return;
    geometry=coords;
    const lon=coords.map(p=>p[0]),lat=coords.map(p=>p[1]);
    if([...lon,...lat].some(x=>!finite(x)))return;
    const minLat=Math.min(...lat),maxLat=Math.max(...lat),
      minLon=Math.min(...lon),maxLon=Math.max(...lon);
    if(maxLon-minLon<180){
      center={latitude:(minLat+maxLat)/2,longitude:(minLon+maxLon)/2};
      level=Math.max(0,spans.findIndex(s=>s.lon>=(maxLon-minLon)*1.3&&s.lat>=(maxLat-minLat)*1.3));
    }
    draw();
  }
  let drag=null;
  svg.addEventListener("pointerdown",e=>{
    if(e.button!==0)return;
    drag={x:e.clientX,y:e.clientY,center:{...center}};
    svg.setPointerCapture?.(e.pointerId);
  });
  svg.addEventListener("pointermove",e=>{
    if(!drag)return;
    const rect=svg.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    center={
      longitude:normLon(drag.center.longitude-(e.clientX-drag.x)/rect.width*spans[level].lon),
      latitude:clamp(drag.center.latitude+(e.clientY-drag.y)/rect.height*spans[level].lat,-89,89)
    };
    draw();
  });
  for(const name of ["pointerup","pointercancel"])svg.addEventListener(name,()=>{drag=null;});
  svg.addEventListener("wheel",e=>{if(!e.ctrlKey)return;e.preventDefault();changeZoom(e.deltaY<0?1:-1);},{passive:false});
  svg.addEventListener("keydown",e=>{
    const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]}[e.key];
    if(delta){
      e.preventDefault();
      center.longitude=normLon(center.longitude+delta[0]*spans[level].lon/6);
      center.latitude=clamp(center.latitude+delta[1]*spans[level].lat/6,-89,89);draw();
    }else if(e.key==="+"){changeZoom(1);}else if(e.key==="-"){changeZoom(-1);}
  });
  draw();
  return {root,setView,setWorld,setRoute,changeZoom,dispose(){disposed=true;drag=null;}};
}
