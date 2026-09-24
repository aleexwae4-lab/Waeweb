// WAEWEB P0 shared address/POI geocoder.
// Both /api/places and /api/maps use one Nominatim cache + in-flight request.
import {mapCoordinates,findPlaces,MapsError} from "./maps.mjs";
export class GeocodeError extends Error{constructor(message,status=400,code="geocode_invalid"){super(message);this.status=status;this.code=code;}}
const clean=x=>String(x??"").replace(/[\u0000-\u001F\u007F]/g," ").replace(/\s+/g," ").trim();
export function addressCapabilities(){return {enabled:true,provider:"OpenStreetMap · Nominatim",manualSearchOnly:false,maxQueryChars:180,requiresSelection:true,
 note:"Busca direcciones, lugares y comercios indexados en OpenStreetMap. Para alto volumen se requiere una instancia propia o compatible."};}
export async function searchAddress(query,transport=fetch){
 if(typeof query!=="string"||query.length>180||query.trim().length<2)
   throw new GeocodeError("Escribe al menos dos caracteres para buscar una dirección o lugar.");
 const q=clean(query);
 try{
   const pair=mapCoordinates(q);
   if(pair)return {query:q,source:"Coordenadas proporcionadas",results:[{id:"manual-coordinate",name:"Ubicación por coordenadas",
     detail:"Punto indicado por el usuario · dirección no verificada",...pair,precision:"coordinate",layer:"coordinate"}]};
   const data=await findPlaces(q,{transport});
   return {query:q,source:data.source,results:data.results.map(place=>({
      ...place,layer:place.category||place.osmType||"place",
      approximate:!["address_point","place_point"].includes(place.precision)
   })),message:data.results.length?null:"No hay coincidencias. Añade colonia, ciudad, estado o país.",
      notice:"Las coincidencias proceden de OpenStreetMap; no prueban titularidad, horarios ni accesibilidad del establecimiento."};
 }catch(error){
   if(error instanceof GeocodeError)throw error;
   if(error instanceof MapsError)throw new GeocodeError(error.message,error.status,
      error.code==="map_rate_limited"?"geocode_quota":
      error.code==="map_invalid_response"?"geocode_invalid_response":
      error.code==="map_source_unavailable"?"geocode_source_unavailable":error.code);
   throw error;
 }
}
