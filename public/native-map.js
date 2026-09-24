// WAEWEB RC33 · owned SVG geographic viewport. No third-party iframe,
// tiles, network requests or invented roads. Points and ORS geometry only.
import {validMapPlace,mapViewport} from "/maps-core.js";
import {visibleStreetTiles} from "/map-tiles.js";

const svgNS="http://www.w3.org/2000/svg";
const el=(tag)=>document.createElementNS(svgNS,tag);
const finite=n=>typeof n==="number"&&Number.isFinite(n);
const clamp=(x,lo,hi)=>Math.max(lo,Math.min(hi,x));
const normLon=x=>((x+180)%360+360)%360-180;
export function createNativeMap({onSelectPlace=()=>{}}={}){
  const root=document.createElement("section");
  root.className="wae-native-map";
  root.setAttribute("aria-label","Mapa geográfico interactivo WAEWEB");
  const toolbar=document.createElement("div");toolbar.className="wae-native-map-toolbar";
  const title=document.createElement("strong");title.textContent="WAEWEB · MAPA";
  const tag=document.createElement("span");tag.className="wae-native-map-badge";tag.textContent="Calles · OpenStreetMap";
  toolbar.append(title,tag);
  const area=document.createElement("div");area.className="wae-native-map-area";
  const svg=el("svg");svg.setAttribute("viewBox","0 0 900 460");
  svg.setAttribute("role","group");svg.setAttribute("aria-label","Mapa interactivo de calles, ubicaciones geocodificadas y rutas verificadas.");
  svg.setAttribute("preserveAspectRatio","xMidYMid meet");
  let viewport=mapViewport(900,460);
  svg.setAttribute("tabindex","0");
  area.append(svg);
  const controls=document.createElement("div");controls.className="wae-native-map-controls";
  const make=(label,fn)=>{
    const b=document.createElement("button");b.type="button";b.textContent=label;b.setAttribute("aria-label",label==="+"?"Acercar mapa":label==="−"?"Alejar mapa":label);
    b.addEventListener("click",fn);controls.append(b);return b;
  };
  const plus=make("+",()=>changeZoom(1)),minus=make("−",()=>changeZoom(-1));
  const centerButton=make("⌖",()=>{if(point)setView(point);else setWorld();});
  centerButton.title="Centrar mapa";centerButton.setAttribute("aria-label","Centrar mapa");
  const streets=make("▧",()=>toggleStreets());
  streets.title="Mostrar u ocultar calles";
  streets.setAttribute("aria-label","Activar o desactivar cartografía de calles");
  streets.setAttribute("aria-pressed","true");
  area.append(controls);
  const footer=document.createElement("p");footer.className="wae-native-map-note";
  footer.textContent="© OpenStreetMap contributors · cartografía visible cargada por defecto. Las rutas aparecen solo si el proveedor devuelve geometría real.";
  const details=document.createElement("p");details.className="wae-native-map-detail";details.setAttribute("aria-live","polite");
  root.append(toolbar,area,details,footer);
  let center={latitude:23.6,longitude:-102.5},level=0,point=null,geometry=null,label="",disposed=false,streetsEnabled=true;
  let places=[],selectedIndex=-1;
  // Keep raster elements alive across drag and zoom; recreating every SVG image
  // on each pointer move causes flashes and repeated requests on mobile.
  const rasterCache=new Map();
  let drawFrame=0;
  function scheduleDraw(){
    if(drawFrame||disposed)return;
    drawFrame=requestAnimationFrame(()=>{drawFrame=0;draw();});
  }
  const spans=[{lat:40,lon:78},{lat:14,lon:28},{lat:4.5,lon:9},{lat:1.4,lon:2.8},{lat:.4,lon:.8},{lat:.1,lon:.2},{lat:.025,lon:.05},{lat:.006,lon:.012},{lat:.0015,lon:.003}];
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
    viewport=mapViewport(svg.getBoundingClientRect().width,svg.getBoundingClientRect().height);
    svg.setAttribute("viewBox",viewport.viewBox);
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
    if(streetsEnabled){
      for(const tile of visibleStreetTiles(center,spans[level])){
        let image=rasterCache.get(tile.url);
        if(!image){
          image=el("image");
          image.setAttribute("href",tile.url);
          image.setAttribute("preserveAspectRatio","none");
          image.setAttribute("referrerpolicy","strict-origin-when-cross-origin");
          rasterCache.set(tile.url,image);
        }
        for(const prop of ["x","y","width","height"])image.setAttribute(prop,String(tile[prop]));
        svg.append(image);
      }
      // A bounded cache avoids new downloads when the user pans back.
      if(rasterCache.size>96){
        const keep=new Set(visibleStreetTiles(center,spans[level]).map(tile=>tile.url));
        for(const key of rasterCache.keys()){
          if(rasterCache.size<=72)break;
          if(!keep.has(key))rasterCache.delete(key);
        }
      }
      svg.setAttribute("aria-label","Mapa con cartografía de OpenStreetMap, marcador y ruta cuando está disponible.");
    }else svg.setAttribute("aria-label","Coordenadas geográficas, puntos seleccionados y ruta cuando está disponible. Pulsa Calles para ver calles reales.");
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
    // Pins represent geocoder matches or explicit coordinates, never invented POIs.
    places.forEach((place,index)=>{
      if(index===selectedIndex||!validMapPlace(place))return;
      const p=project(place.longitude,place.latitude);
      if(p.x<0||p.x>900||p.y<0||p.y>460)return;
      const pin=el("circle");
      pin.setAttribute("cx",String(p.x));pin.setAttribute("cy",String(p.y));
      pin.setAttribute("r",places.length>15?"9":"12");pin.setAttribute("class","wae-map-candidate");
      pin.setAttribute("data-map-place",String(index));
      pin.setAttribute("tabindex","0");pin.setAttribute("role","button");
      pin.setAttribute("aria-label","Seleccionar "+(place.detail||place.name||"ubicación"));
      const caption=el("title");caption.textContent=place.detail||place.name||"Ubicación";
      pin.append(caption);svg.append(pin);
    });
    if(point&&validMapPlace(point)){
      const p=project(point.longitude,point.latitude);
      if(p.x>=0&&p.x<=900&&p.y>=0&&p.y<=460){
        const halo=el("circle");halo.setAttribute("cx",p.x);halo.setAttribute("cy",p.y);
        halo.setAttribute("r","21");halo.setAttribute("class","wae-map-marker-halo");svg.append(halo);
        const marker=el("circle");marker.setAttribute("cx",p.x);marker.setAttribute("cy",p.y);
        marker.setAttribute("r","13");marker.setAttribute("class","wae-map-marker");
        if(selectedIndex>=0){
          marker.setAttribute("data-map-place",String(selectedIndex));
          marker.setAttribute("tabindex","0");marker.setAttribute("role","button");
          marker.setAttribute("aria-label","Ubicación seleccionada: "+(label||"Marcador"));
        }
        svg.append(marker);
        const title=el("title");title.textContent=label||"Ubicación marcada";marker.append(title);
      }
    }
    text(svg,18,32,"N ↑","wae-map-compass");
    text(svg,18,423,"WAEWEB · DATOS GEOGRÁFICOS","wae-map-watermark");
    details.textContent=(point?label+" · "+point.latitude.toFixed(6)+", "+point.longitude.toFixed(6):
      "Vista general · centro aproximado de México")+" · Acercamiento "+(level+1)+"/"+spans.length;
    plus.disabled=level>=spans.length-1;minus.disabled=level<=0;
    streets.setAttribute("aria-pressed",String(streetsEnabled));
    tag.textContent=streetsEnabled?"Calles · OpenStreetMap":"Vista geográfica nativa";
    footer.textContent=streetsEnabled
      ?"© OpenStreetMap contributors · Open Database License. Solo se solicitan teselas visibles; sin tráfico ni satélite. Si el proveedor bloquea imágenes, el visor conserva las coordenadas."
      :"Vista geográfica propia. Pulsa «Calles» para cargar únicamente la cartografía visible de OpenStreetMap. Las rutas aparecen solo si el proveedor devuelve geometría real.";
  }
  function toggleStreets(){streetsEnabled=!streetsEnabled;draw();}
  function setPlaces(items,activeIndex=0){
    places=(Array.isArray(items)?items:[]).filter(validMapPlace).slice(0,35);
    selectedIndex=places.length&&activeIndex!==-1?clamp(Math.trunc(activeIndex)||0,0,places.length-1):-1;
    draw();
  }
  function setView(place,zoom=3){
    if(!validMapPlace(place))return;
    point=place;center={latitude:clamp(place.latitude,-90,90),longitude:normLon(place.longitude)};
    label=String(place.detail||place.name||"Punto geográfico");
    level=clamp(Math.trunc(zoom)+1,0,spans.length-1);
    geometry=null;draw();
  }
  function fitPlaces(items){
    const valid=(Array.isArray(items)?items:[]).filter(validMapPlace);
    if(valid.length<2)return;
    const lat=valid.map(p=>p.latitude),lon=valid.map(p=>p.longitude);
    const minLat=Math.min(...lat),maxLat=Math.max(...lat),
      minLon=Math.min(...lon),maxLon=Math.max(...lon);
    if(maxLon-minLon>=180)return;
    viewport=mapViewport(svg.getBoundingClientRect().width,
      svg.getBoundingClientRect().height);
    center={latitude:(minLat+maxLat)/2,longitude:(minLon+maxLon)/2};
    const latRange=Math.max(.004,maxLat-minLat)*1.25;
    const lonRange=Math.max(.006,maxLon-minLon)*1.25;
    for(let i=spans.length-1;i>=0;i--){
      if(spans[i].lat>=latRange &&
        spans[i].lon*viewport.width/900>=lonRange){level=i;break;}
    }
    draw();
  }
  function setWorld(){point=null;geometry=null;level=0;center={latitude:23.6,longitude:-102.5};label="";places=[];selectedIndex=-1;draw();}
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
  let drag=null,gesture=null,dragged=false;
  const pointers=new Map();
  const distance=()=>{
    const [a,b]=[...pointers.values()];
    return a&&b?Math.hypot(a.x-b.x,a.y-b.y):0;
  };
  function activatePin(target){
    const pin=target?.closest?.("[data-map-place]");
    if(!pin||dragged)return false;
    const index=Number(pin.getAttribute("data-map-place"));
    if(!Number.isInteger(index)||index<0||index>=places.length)return false;
    onSelectPlace(index);
    return true;
  }
  svg.addEventListener("click",e=>{activatePin(e.target);});
  svg.addEventListener("pointerdown",e=>{
    if(e.pointerType==="touch"){
      pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
      if(pointers.size===2){drag=null;gesture={distance:distance(),level};svg.setPointerCapture?.(e.pointerId);return;}
    }
    if(e.target?.closest?.("[data-map-place]")){dragged=false;return;}
    if(e.button!==0)return;
    drag={x:e.clientX,y:e.clientY,center:{...center}};dragged=false;
    svg.setPointerCapture?.(e.pointerId);
  });
  svg.addEventListener("pointermove",e=>{
    if(pointers.has(e.pointerId))pointers.set(e.pointerId,{x:e.clientX,y:e.clientY});
    if(gesture&&pointers.size>=2){
      const factor=distance()/Math.max(1,gesture.distance);
      const next=clamp(gesture.level+(factor>1.35?1:factor<0.74?-1:0),0,spans.length-1);
      if(level!==next){level=next;draw();}
      return;
    }
    if(!drag)return;
    if(Math.hypot(e.clientX-drag.x,e.clientY-drag.y)>5)dragged=true;
    const rect=svg.getBoundingClientRect();
    if(!rect.width||!rect.height)return;
    center={
      longitude:normLon(drag.center.longitude-(e.clientX-drag.x)/rect.width*spans[level].lon*viewport.width/900),
      latitude:clamp(drag.center.latitude+(e.clientY-drag.y)/rect.height*spans[level].lat,-89,89)
    };
    scheduleDraw();
  });
  for(const name of ["pointerup","pointercancel"])svg.addEventListener(name,e=>{
    pointers.delete(e.pointerId);drag=null;
    if(drawFrame){cancelAnimationFrame(drawFrame);drawFrame=0;draw();}
    if(pointers.size<2)gesture=null;
  });
  svg.addEventListener("keydown",e=>{
    if(e.key!=="Enter"&&e.key!==" ")return;
    if(activatePin(e.target))e.preventDefault();
  });
  svg.addEventListener("dblclick",e=>{if(e.target?.closest?.("[data-map-place]"))return;e.preventDefault();changeZoom(1);});
  svg.addEventListener("wheel",e=>{e.preventDefault();changeZoom(e.deltaY<0?1:-1);},{passive:false});
  svg.addEventListener("keydown",e=>{
    const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,1],ArrowDown:[0,-1]}[e.key];
    if(delta){
      e.preventDefault();
      center.longitude=normLon(center.longitude+delta[0]*spans[level].lon/6);
      center.latitude=clamp(center.latitude+delta[1]*spans[level].lat/6,-89,89);draw();
    }else if(e.key==="+"){changeZoom(1);}else if(e.key==="-"){changeZoom(-1);}
  });
  draw();
  // A portrait map must recalculate its crop after mounting, rotation and
  // browser UI resizing. No network requests or new map panel are created.
  const resizeObserver=typeof ResizeObserver==="function"
    ?new ResizeObserver(()=>scheduleDraw()):null;
  resizeObserver?.observe(svg);
  return {root,setView,setPlaces,fitPlaces,setWorld,setRoute,changeZoom,toggleStreets,dispose(){resizeObserver?.disconnect();disposed=true;drag=null;gesture=null;pointers.clear();if(drawFrame)cancelAnimationFrame(drawFrame);rasterCache.clear();}};
}
