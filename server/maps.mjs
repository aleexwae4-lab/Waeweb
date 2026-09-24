import {lookupPOI,POIError} from "./poi.mjs";
// Public, opt-in geographical lookup. Open-Meteo resolves populated places,
// not street-level addresses or verified business listings.
const cache = new Map();
const TTL_MS = 15 * 60_000;
const COORDS = /^\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*[,;]\s*([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*$/;
export class MapsError extends Error {
  constructor(message, status = 400, code = "map_query_invalid") {
    super(message); this.status = status; this.code = code;
  }
}
export function mapCoordinates(value) {
  const match = String(value ?? "").match(COORDS);
  if (!match) return null;
  const latitude = Number(match[1]), longitude = Number(match[2]);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) ||
      latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180)
    throw new MapsError("Coordenadas fuera de rango: latitud -90 a 90 y longitud -180 a 180.");
  return { latitude, longitude };
}
function usablePosition(latitude, longitude) {
  return typeof latitude === "number" && Number.isFinite(latitude) && latitude >= -90 &&
    latitude <= 90 && typeof longitude === "number" && Number.isFinite(longitude) &&
    longitude >= -180 && longitude <= 180;
}
export async function findPlaces(input, { fresh = false, latitude, longitude } = {}) {
  if (typeof input !== "string" || input.length > 180)
    throw new MapsError("La consulta geográfica supera 180 caracteres.");
  const query = input.replace(/<[^>]*>/g," ").replace(/[\u0000-\u001F]/g," ").replace(/\s+/g," ").trim();
  if (query.length < 2) throw new MapsError("Escribe una ciudad o dos coordenadas separadas por coma.");
  const pair = mapCoordinates(query);
  if (pair) return {
    query, source: "Coordenadas proporcionadas", precision: "coordinate",
    results: [{ id: "coordinates", name: "Ubicación por coordenadas",
      detail: "Punto indicado por el usuario · sin dirección verificada",
      ...pair, precision: "coordinate" }]
  };
  try {
    const poi=await lookupPOI(query,{lat:latitude,lon:longitude});
    if(poi)return poi;
  } catch(error) {
    if(error instanceof POIError)throw new MapsError(error.message,error.status,error.code);
    throw error;
  }
  const key = query.toLocaleLowerCase("es");
  const old = cache.get(key);
  if (!fresh && old && old.expires > Date.now()) return old.value;
  const endpoint = new URL("https://geocoding-api.open-meteo.com/v1/search");
  endpoint.search = new URLSearchParams({ name: query, count: "8", language: "es", format: "json" }).toString();
  let data;
  try {
    const response = await fetch(endpoint, {
      headers: { accept: "application/json", "user-agent": "WAEWEB/1.0 (https://github.com/aleexwae4-lab/Waeweb)" },
      signal: AbortSignal.timeout(6500)
    });
    if (!response.ok) throw new Error("HTTP " + response.status);
    const raw = await response.text();
    if (raw.length > 1000000) throw new Error("Respuesta demasiado grande");
    data = JSON.parse(raw);
    if (!data || typeof data !== "object") throw new Error("Respuesta vacía");
  } catch {
    throw new MapsError("No se pudo consultar el proveedor geográfico. Puedes abrir la búsqueda en OpenStreetMap.", 502, "map_source_unavailable");
  }
  const seen = new Set();
  const results = (Array.isArray(data.results) ? data.results : []).filter(item =>
    usablePosition(item.latitude, item.longitude) && typeof item.name === "string"
  ).map(item => {
    const name = item.name.trim().slice(0, 140);
    const detail = [item.admin2, item.admin1, item.country].filter(x => typeof x === "string" && x.trim())
      .filter((part, i, arr) => arr.indexOf(part) === i).join(", ").slice(0, 260);
    return {
      id: String(item.id ?? name + ":" + item.latitude + ":" + item.longitude),
      name, detail, latitude: item.latitude, longitude: item.longitude,
      precision: "locality_centroid"
    };
  }).filter(item => {
    const id = item.latitude + "," + item.longitude + ":" + item.name;
    if (!item.name || seen.has(id)) return false;
    seen.add(id); return true;
  });
  const result = {
    query, source: "Open-Meteo Geocoding", precision: "locality_centroid",
    attribution: "Localidades de Open-Meteo; cartografía © colaboradores de OpenStreetMap.",
    results,
    message: results.length ? null :
      "No se encontraron localidades coincidentes. Para una dirección específica, usa la búsqueda original de OpenStreetMap."
  };
  if (cache.size > 250) cache.clear();
  cache.set(key, { value: result, expires: Date.now() + (results.length ? TTL_MS : 60_000) });
  return result;
}
