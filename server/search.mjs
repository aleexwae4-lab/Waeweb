import { parseQuery, rankResults, researchBrief } from "./intelligence.mjs";
const HEADERS = { "accept": "application/json", "user-agent": "WAE-Web/0.1 (https://github.com/aleexwae4-lab/Waeweb)" };
const SOURCE_TIMEOUT = 6500;
const clean = value => String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
export const normalizeQuery = value => clean(value).slice(0, 180);
export const urlAllowed = value => {
  try {
    const u = new URL(value);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch { return false; }
};
async function json(url, timeout = SOURCE_TIMEOUT) {
  const response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error("source_status_" + response.status);
  const body = await response.text();
  if (body.length > 2500000) throw new Error("source_too_large");
  return JSON.parse(body);
}
const result = (title, link, snippet, source, date = null, image = null) => ({
  title: clean(title), url: link, snippet: clean(snippet), source, date, image
});
export async function wikipedia(query) {
  const u = new URL("https://es.wikipedia.org/w/api.php");
  u.search = new URLSearchParams({
    action: "query", list: "search", srsearch: query, srlimit: "8",
    format: "json", utf8: "1", origin: "*"
  }).toString();
  const data = await json(u);
  return (data.query?.search || []).map(item => result(
    item.title,
    "https://es.wikipedia.org/?curid=" + encodeURIComponent(item.pageid),
    item.snippet, "Wikipedia"
  ));
}
export async function crossref(query) {
  const u = new URL("https://api.crossref.org/works");
  u.search = new URLSearchParams({ query, rows: "6", select: "DOI,title,abstract,URL,published,container-title" }).toString();
  const data = await json(u);
  return (data.message?.items || []).filter(item => item.DOI).map(item => {
    const dateParts = item.published?.["date-parts"]?.[0];
    const date = Array.isArray(dateParts) && dateParts.length ? String(dateParts[0]) : null;
    const title = item.title?.[0] || item.DOI;
    return result(title, "https://doi.org/" + encodeURIComponent(item.DOI), item.abstract || item["container-title"]?.[0] || "Publicación académica", "Crossref", date);
  }).filter(item => item.title && urlAllowed(item.url));
}
export function openAlexAbstract(index) {
  if (!index || typeof index !== "object") return "";
  const entries = [];
  for (const [word, positions] of Object.entries(index)) {
    if (!Array.isArray(positions)) continue;
    for (const position of positions) {
      if (Number.isInteger(position) && position >= 0 && position < 1500) entries.push([position, word]);
    }
  }
  return entries.sort((a, b) => a[0] - b[0]).slice(0, 250).map(([, word]) => word).join(" ").slice(0, 1400);
}
export async function openAlex(query) {
  const u = new URL("https://api.openalex.org/works");
  u.search = new URLSearchParams({ search: query, "per-page": "6" }).toString();
  const data = await json(u);
  return (data.results || []).map(item => result(
    item.display_name, item.primary_location?.landing_page_url || item.doi || item.id,
    openAlexAbstract(item.abstract_inverted_index) || item.primary_location?.source?.display_name || "Investigación académica", "OpenAlex", item.publication_date
  )).filter(item => item.title && urlAllowed(item.url));
}
export async function googleSearch(query, type = "web") {
  if (!process.env.GOOGLE_SEARCH_API_KEY || !process.env.GOOGLE_SEARCH_ENGINE_ID) return null;
  const u = new URL("https://www.googleapis.com/customsearch/v1");
  const params = { key: process.env.GOOGLE_SEARCH_API_KEY, cx: process.env.GOOGLE_SEARCH_ENGINE_ID, q: query, num: "10" };
  if (type === "images") params.searchType = "image";
  if (type === "news") params.q = query + " noticias actualidad";
  if (type === "videos") params.q = query + " site:youtube.com/watch";
  u.search = new URLSearchParams(params).toString();
  const data = await json(u);
  return (data.items || []).map(item => result(
    item.title, item.link, item.snippet, item.displayLink || "Google Programmable Search",
    item.pagemap?.metatags?.[0]?.["article:published_time"] || null,
    item.image?.thumbnailLink || item.pagemap?.cse_thumbnail?.[0]?.src || null
  )).filter(item => item.title && urlAllowed(item.url));
}
export async function wikimediaImages(query) {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  u.search = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: query,
    gsrnamespace: "6", gsrlimit: "18", prop: "imageinfo",
    iiprop: "url|mime", iiurlwidth: "520", format: "json"
  }).toString();
  const data = await json(u);
  return Object.values(data.query?.pages || {}).map(page => {
    const image = page.imageinfo?.[0];
    return image && image.mime?.startsWith("image/") ? result(
      page.title.replace(/^File:/, ""), image.descriptionurl || image.url,
      "Imagen de Wikimedia Commons", "Wikimedia Commons", null, image.thumburl || image.url
    ) : null;
  }).filter(item => item && urlAllowed(item.image) && urlAllowed(item.url));
}
export function dedupe(items) {
  const seen = new Set();
  return items.filter(item => {
    const key = item.url.toLowerCase().replace(/\/$/, "");
    if (!item.title || !urlAllowed(item.url) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
const cache = new Map();
export async function search(query, type = "all") {
  const spec = parseQuery(normalizeQuery(query));
  const q = spec.query;
  if (spec.errors.length) return { error: spec.errors.join(" ") };
  if (q.length < 2) return { error: "Escribe al menos dos caracteres de búsqueda además de los filtros." };
  const selected = ["all", "images", "news", "videos", "research"].includes(type) ? type : "all";
  const key = selected + ":" + spec.input.toLocaleLowerCase("es");
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;
  const sources = selected === "images"
    ? [["Wikimedia Commons", () => wikimediaImages(q)], ["Google", () => googleSearch(spec.site ? q + " site:" + spec.site : q, "images")]]
    : selected === "news" || selected === "videos"
    ? [["Google", () => googleSearch(spec.site ? q + " site:" + spec.site : q, selected)]]
    : selected === "research"
    ? [["Crossref", () => crossref(q)], ["OpenAlex", () => openAlex(q)]]
    : [["Google", () => googleSearch(spec.site ? q + " site:" + spec.site : q)], ["Wikipedia", () => wikipedia(q)], ["Crossref", () => crossref(q)], ["OpenAlex", () => openAlex(q)]];
  const settled = await Promise.allSettled(sources.map(async ([name, fn]) => ({ name, items: await fn() })));
  const errors = [], available = [], results = [];
  settled.forEach((entry, i) => {
    if (entry.status === "rejected") errors.push(sources[i][0]);
    else if (entry.value.items === null) available.push(sources[i][0] + " no configurado");
    else { available.push(entry.value.name); results.push(...entry.value.items); }
  });
  const payload = {
    query: q, originalQuery: spec.input, filters: { site: spec.site, after: spec.after, before: spec.before, source: spec.source, excludes: spec.excludes, phrases: spec.phrases },
    type: selected, results: rankResults(dedupe(results), spec, selected), sources: available,
    failedSources: errors, fetchedAt: new Date().toISOString(),
    message: !available.some(s => !s.includes("no configurado")) ? "No hay proveedores disponibles para esta categoría." : null
  };
  payload.brief = selected === "all" || selected === "research" ? researchBrief(payload.results) : null;
  if (cache.size > 200) cache.clear();
  cache.set(key, { value: payload, expires: Date.now() + (selected === "news" ? 60000 : 300000) });
  return payload;
}
export async function weather(place) {
  const q = normalizeQuery(place).replace(/^(clima|tiempo|temperatura|pron[oó]stico)\s+(en|de|para)?\s*/i, "");
  if (q.length < 2) return { error: "Indica una localidad para consultar el clima." };
  const geo = new URL("https://geocoding-api.open-meteo.com/v1/search");
  geo.search = new URLSearchParams({ name: q, count: "1", language: "es", format: "json" }).toString();
  const locations = await json(geo);
  const loc = locations.results?.[0];
  if (!loc) return { error: "No se encontró la localidad." };
  const u = new URL("https://api.open-meteo.com/v1/forecast");
  u.search = new URLSearchParams({
    latitude: String(loc.latitude), longitude: String(loc.longitude),
    current: "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min",
    forecast_days: "3", timezone: "auto"
  }).toString();
  const forecast = await json(u);
  return {
    place: [loc.name, loc.admin1, loc.country].filter(Boolean).join(", "),
    temperature: forecast.current?.temperature_2m, humidity: forecast.current?.relative_humidity_2m,
    wind: forecast.current?.wind_speed_10m, code: forecast.current?.weather_code,
    observedAt: forecast.current?.time, timezone: forecast.timezone,
    days: forecast.daily?.time?.map((date, i) => ({
      date, max: forecast.daily.temperature_2m_max?.[i], min: forecast.daily.temperature_2m_min?.[i]
    })) || [], source: "Open-Meteo", url: "https://open-meteo.com/"
  };
}
