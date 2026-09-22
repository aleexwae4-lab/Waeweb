// Visible-only OSM raster tiles. No bulk download, prefetch, background crawling or proxy.
// Do not invoke until the person requests the street layer.
const clamp = (n,min,max) => Math.max(min,Math.min(max,n));
const mercator = lat => {
  const radians=clamp(lat,-85.05112878,85.05112878)*Math.PI/180;
  return (1-Math.log(Math.tan(radians)+1/Math.cos(radians))/Math.PI)/2;
};
export function visibleStreetTiles(center,span,maximum=24) {
  if(!center||!span||![center.latitude,center.longitude,span.lat,span.lon].every(Number.isFinite)||
      span.lat<=0||span.lon<=0)return [];
  // Match the geographic SVG extent without silently downloading another zoom level.
  const zoom=clamp(Math.floor(Math.log2(360*900/(256*span.lon))),1,18);
  const count=2**zoom;
  const firstX=Math.floor((center.longitude-span.lon/2+180)/360*count);
  const lastX=Math.floor((center.longitude+span.lon/2+180)/360*count);
  const top=clamp(center.latitude+span.lat/2,-85.05112878,85.05112878);
  const bottom=clamp(center.latitude-span.lat/2,-85.05112878,85.05112878);
  const firstY=clamp(Math.floor(mercator(top)*count),0,count-1);
  const lastY=clamp(Math.floor(mercator(bottom)*count),0,count-1);
  // A narrow viewport must never flood community tile servers.
  if((lastX-firstX+1)*(lastY-firstY+1)>maximum)return [];
  const tiles=[];
  for(let x=firstX;x<=lastX;x++)for(let y=firstY;y<=lastY;y++){
    const wrap=((x%count)+count)%count;
    const left=(x/count*360-180-center.longitude)/span.lon*900+450;
    const right=((x+1)/count*360-180-center.longitude)/span.lon*900+450;
    const latNorth=Math.atan(Math.sinh(Math.PI*(1-2*y/count)))*180/Math.PI;
    const latSouth=Math.atan(Math.sinh(Math.PI*(1-2*(y+1)/count)))*180/Math.PI;
    const sy=230-(latNorth-center.latitude)/span.lat*460;
    const ey=230-(latSouth-center.latitude)/span.lat*460;
    tiles.push({url:"https://tile.openstreetmap.org/"+zoom+"/"+wrap+"/"+y+".png",
      x:left,y:sy,width:right-left,height:ey-sy});
  }
  return tiles;
}
