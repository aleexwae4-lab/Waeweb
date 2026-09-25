// Shared, deterministic local-search intent: no paid API and no inferred user position.
// Only an explicit nearby phrase plus a supported POI category uses geolocation.
const fold=value=>String(value??"").normalize("NFD")
  .replace(/[\u0300-\u036f]/g,"").toLocaleLowerCase("es")
  .replace(/\s+/g," ").trim();
const NEAR=/\b(?:cerca(?: de mi)?|cercan[oa]s?|near me|a mi alrededor|por aqui|en mi zona|proxim[oa]s?)\b/;
const CATEGORIES=[
  ["oxxo","OXXO",/\boxxos?\b/,"oxxo"],
  ["bank","Bancos",/\b(?:bancos?|sucursales? bancarias?)\b/,"bancos"],
  ["atm","Cajeros automáticos",/\b(?:cajeros?(?: automaticos?)?|atms?)\b/,"cajeros"],
  ["cinema","Cines",/\b(?:cines?|cinemas?)\b/,"cines"],
  ["convenience","Tiendas de conveniencia",/\b(?:tiendas? de conveniencia|minisupers?)\b/,"conveniencia"],
  ["pharmacy","Farmacias",/\b(?:farmacias?|droguerias?)\b/,"farmacias"],
  ["supermarket","Supermercados",/\b(?:supermercados?|autoservicios?)\b/,"supermercados"],
  ["restaurant","Restaurantes",/\b(?:restaurantes?|comida)\b/,"restaurantes"],
  ["fuel","Gasolineras",/\b(?:gasolineras?|estaciones? de servicio)\b/,"gasolineras"],
  ["hospital","Hospitales",/\b(?:hospitales?|clinicas?)\b/,"hospitales"],
  ["telcel","Tiendas Telcel",/\btelcel\b/,"telcel"]
];
export function nearbyIntent(query){
  const q=fold(query);
  if(!q||q.length>180||!NEAR.test(q)||
    /(?:^|\s)(?:site:|source:|after:|before:)/.test(q))return null;
  const found=CATEGORIES.find(([, ,pattern])=>pattern.test(q));
  return found?{kind:"nearby",category:found[0],label:found[1],
    poiCategory:found[3],query:String(query).trim()}:null;
}
