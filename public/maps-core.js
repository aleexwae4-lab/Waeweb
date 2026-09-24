// Build fixed-origin map URLs only from numeric geocoder output.
export function validMapPlace(place) {
  return place && Number.isFinite(place.latitude) && Number.isFinite(place.longitude) &&
    place.latitude >= -90 && place.latitude <= 90 && place.longitude >= -180 && place.longitude <= 180;
}
export function osmPlaceUrl(place) {
  if (!validMapPlace(place)) throw new TypeError("Coordenadas inválidas.");
  const lat = place.latitude.toFixed(6), lon = place.longitude.toFixed(6);
  return "https://www.openstreetmap.org/?mlat=" + lat + "&mlon=" + lon +
    "#map=13/" + lat + "/" + lon;
}
export function osmEmbedUrl(place, level = 2) {
  if (!validMapPlace(place)) throw new TypeError("Coordenadas inválidas.");
  const zoom = Math.max(0,Math.min(4,Math.trunc(level) || 0));
  // Half-height of viewport in degrees; longitude compensates for latitude.
  const half = [0.19,0.065,0.023,0.008,0.0028][zoom];
  const lat = Math.max(-85,Math.min(85,place.latitude));
  const lon = place.longitude;
  const longHalf = Math.min(26,half / Math.max(0.22,Math.cos(lat * Math.PI / 180)));
  const minLon = Math.max(-180,lon - longHalf), maxLon = Math.min(180,lon + longHalf);
  const minLat = Math.max(-85.0511,lat - half), maxLat = Math.min(85.0511,lat + half);
  const q = new URLSearchParams({
    bbox: [minLon,minLat,maxLon,maxLat].join(","),
    layer: "mapnik", marker: lat + "," + lon
  });
  return "https://www.openstreetmap.org/export/embed.html?" + q.toString();
}


// Client-only exact coordinates, used when the public Maps API is inaccessible.
// A named address MUST NOT be guessed, auto-geocoded, or silently replaced.
export function localMapCoordinates(input) {
  if(typeof input!=="string"||input.length>180)return null;
  const match=input.match(/^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*[,;]\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*$/);
  if(!match)return null;
  const latitude=Number(match[1]),longitude=Number(match[2]);
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||
     latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)return null;
  return {latitude,longitude};
}

// SVG uses a fixed geographic projection with its center at 450,230.
// Crop that projection to the actual device aspect ratio instead of showing
// a thin letterboxed map on portrait phones.
export function mapViewport(width,height){
  if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)
    return {width:900,x:0,viewBox:"0 0 900 460"};
  const visibleWidth=Math.max(140,Math.min(900,460*width/height));
  const x=(900-visibleWidth)/2;
  return {width:visibleWidth,x,viewBox:x+" 0 "+visibleWidth+" 460"};
}

export function osmSearchUrl(query){
  const name=String(query??"").trim().slice(0,180);
  if(!name)throw new TypeError("Escribe un lugar para buscar.");
  return "https://www.openstreetmap.org/search?query="+encodeURIComponent(name);
}


// Only map queries that clearly request businesses are routed to OSM POIs.
// Ordinary place names and coordinates still use the locality/address path.
export function isPoiMapQuery(input){
  const raw=String(input??"").normalize("NFD")
    .replace(/[\u0300-\u036f]/g,"").trim().toLowerCase();
  const term=raw.split(/\s+(?:en|cerca de|por|alrededor de)\s+/)[0];
  return /^(?:oxxos?|7.?eleven|seven eleven|walmart|soriana|bodega aurrera|coppel|cinepolis|cinemex|starbucks|bbva|banorte|santander|hsbc|banco azteca|farmacias? guadalajara|farmacias? del ahorro|bancos?|cajeros?|cines?|cinemas|supermercados?|farmacias?|restaurantes?|cafeterias?|gasolineras?|comercios|tiendas|negocios)$/.test(term)||
    /^(?:negocio|comercio|sucursal|tienda de)\s+[\p{L}\p{N}]/u.test(term);
}
