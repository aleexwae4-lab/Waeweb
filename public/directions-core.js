// Draw only verified provider vertices. This is a route diagram, not a slippy
// street basemap and never a straight-line estimate.
export function routeDiagram(geometry,width=900,height=450){
  if(!Array.isArray(geometry)||geometry.length<2||geometry.length>6000)
    throw new TypeError("Ruta sin geometría comprobable.");
  if(!geometry.every(p=>Array.isArray(p)&&p.length===2&&
      p.every(Number.isFinite)&&p[0]>=-180&&p[0]<=180&&p[1]>=-90&&p[1]<=90))
    throw new TypeError("Geometría de ruta inválida.");
  const mercator=([lon,lat])=>{
    const safe=Math.max(-85.0511,Math.min(85.0511,lat));
    return [lon,(180/Math.PI)*Math.log(Math.tan(Math.PI/4+safe*Math.PI/360))];
  };
  const data=geometry.map(mercator);
  const xs=data.map(p=>p[0]),ys=data.map(p=>p[1]);
  const minX=Math.min(...xs),maxX=Math.max(...xs),minY=Math.min(...ys),maxY=Math.max(...ys);
  const pad=32,rangeX=Math.max(0.00001,maxX-minX),rangeY=Math.max(0.00001,maxY-minY);
  const scale=Math.min((width-2*pad)/rangeX,(height-2*pad)/rangeY);
  const centerX=(minX+maxX)/2,centerY=(minY+maxY)/2;
  const points=data.map(([x,y])=>({
    x:Math.round((width/2+(x-centerX)*scale)*100)/100,
    y:Math.round((height/2-(y-centerY)*scale)*100)/100
  }));
  return {width,height,points,
    path:points.map((p,i)=>(i?"L":"M")+p.x+" "+p.y).join(" ")};
}
export function durationLabel(seconds){
  if(!Number.isFinite(seconds)||seconds<0)throw new TypeError("Duración inválida");
  const mins=Math.max(1,Math.round(seconds/60));
  const hours=Math.floor(mins/60);
  return hours?hours+" h "+(mins%60?mins%60+" min":""):mins+" min";
}
export function distanceLabel(meters){
  if(!Number.isFinite(meters)||meters<0)throw new TypeError("Distancia inválida");
  return meters<1000?Math.round(meters)+" m":(meters/1000).toLocaleString("es-MX",{maximumFractionDigits:1})+" km";
}
