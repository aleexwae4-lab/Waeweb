import { parseQuery, rankResults, researchBrief } from "./intelligence.mjs";
import {videoIdentity, verifiedVideoResults, youtubeDataVideos, dedupeVideoResults} from "./video-discovery.mjs";
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
    action: "query", list: "search", srsearch: query, srlimit: "12",
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
  u.search = new URLSearchParams({ query, rows: "10", select: "DOI,title,abstract,URL,published,container-title" }).toString();
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
  u.search = new URLSearchParams({ search: query, "per-page": "10" }).toString();
  const data = await json(u);
  return (data.results || []).map(item => result(
    item.display_name, item.primary_location?.landing_page_url || item.doi || item.id,
    openAlexAbstract(item.abstract_inverted_index) || item.primary_location?.source?.display_name || "Investigación académica", "OpenAlex", item.publication_date
  )).filter(item => item.title && urlAllowed(item.url));
}
export async function googleSearch(query, type = "web", page = 1) {
  if (!process.env.GOOGLE_SEARCH_API_KEY || !process.env.GOOGLE_SEARCH_ENGINE_ID) return null;
  const u = new URL("https://www.googleapis.com/customsearch/v1");
  const params = { key: process.env.GOOGLE_SEARCH_API_KEY, cx: process.env.GOOGLE_SEARCH_ENGINE_ID, q: query, num: "10" };
  if(type==="web" && page>1)params.start=String((page-1)*10+1);
  if (type === "images") params.searchType = "image";
  if (type === "news") params.q = query + " noticias actualidad";
  if (type === "videos") params.q = query;
  u.search = new URLSearchParams(params).toString();
  const data = await json(u);
  const items=(data.items || []).map(item => result(
    item.title, item.link, item.snippet, "Google Programmable Search",
    item.pagemap?.metatags?.[0]?.["article:published_time"] || null,
    item.image?.thumbnailLink || item.pagemap?.cse_thumbnail?.[0]?.src || null
  )).filter(item => item.title && urlAllowed(item.url));
  if(type==="web" && Array.isArray(data.queries?.nextPage))
    items.hasMorePage=data.queries.nextPage.length>0;
  return items;
}
// Optional independent web index. No API key is ever sent to the browser.
export async function braveSearch(query, type = "web", page = 1) {
  const token = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!token) return null;
  const category = ["web", "images", "news", "videos"].includes(type) ? type : "web";
  const u = new URL("https://api.search.brave.com/res/v1/" + category + "/search");
  const params={
    q: query, count: category === "web" ? "20" : "15", country: "MX",
    search_lang: "es", safesearch: "strict"
  };
  if(category==="web" && page>1)params.offset=String(page-1);
  u.search = new URLSearchParams(params).toString();
  const response = await fetch(u, {
    headers: {accept: "application/json", "x-subscription-token": token},
    signal: AbortSignal.timeout(SOURCE_TIMEOUT)
  });
  if (!response.ok) throw new Error("brave_status_" + response.status);
  const raw = await response.text();
  if (raw.length > 2500000) throw new Error("brave_too_large");
  const data = JSON.parse(raw);
  const items = category === "web" ? data.web?.results : data.results;
  const found=(Array.isArray(items) ? items : []).map(item => {
    const link = item.url;
    const image = category === "images" || category === "videos"
      ? item.thumbnail?.src : item.thumbnail?.src || null;
    return result(item.title || "", link, item.description || item.snippet || item.source || "",
      "Brave Search", item.page_age || item.page_fetched || null, urlAllowed(image) ? image : null);
  }).filter(item => item.title && urlAllowed(item.url) &&
    (category !== "images" || urlAllowed(item.image)));
  if(category==="web" && typeof data.query?.more_results_available==="boolean")
    found.hasMorePage=data.query.more_results_available;
  return found;
}
export async function openLibrary(query) {
  const u = new URL("https://openlibrary.org/search.json");
  u.search = new URLSearchParams({
    q: query, limit: "20", fields: "key,title,author_name,first_publish_year,cover_i"
  }).toString();
  const data = await json(u);
  return (data.docs || []).filter(item => /^\/works\/OL\d+W$/.test(item.key || "")).map(item => {
    const cover = Number.isInteger(item.cover_i) && item.cover_i > 0
      ? "https://covers.openlibrary.org/b/id/" + item.cover_i + "-M.jpg" : null;
    const snippet = [
      item.author_name?.length ? "Autoría: " + item.author_name.slice(0, 3).join(", ") : null,
      item.first_publish_year ? "Primera publicación: " + item.first_publish_year : null
    ].filter(Boolean).join(" · ") || "Ficha bibliográfica";
    return result(item.title, "https://openlibrary.org" + item.key, snippet,
      "Open Library", item.first_publish_year ? String(item.first_publish_year) : null, cover);
  }).filter(item => item.title && urlAllowed(item.url));
}

export async function wikimediaImages(query) {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  u.search = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: query,
    gsrnamespace: "6", gsrlimit: "28", prop: "imageinfo",
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
// Public, source-backed additions: no fabricated hits when Google is absent.
export async function wikidata(query){
  const u=new URL("https://www.wikidata.org/w/api.php");
  u.search=new URLSearchParams({action:"wbsearchentities",search:query,
    language:"es",uselang:"es",limit:"12",format:"json"}).toString();
  const data=await json(u);
  return (data.search||[]).filter(item=>/^Q[1-9]\d*$/.test(item.id||""))
    .map(item=>result(item.label||item.id,
      "https://www.wikidata.org/wiki/"+item.id,
      item.description||"Ficha de entidad en Wikidata","Wikidata"));
}
export async function europePMC(query){
  const u=new URL("https://www.ebi.ac.uk/europepmc/webservices/rest/search");
  u.search=new URLSearchParams({query,format:"json",pageSize:"10",
    resultType:"core"}).toString();
  const data=await json(u);
  return (data.resultList?.result||[]).map(item=>{
    const id=/^\d+$/.test(String(item.id||""))?item.id:null;
    const doi=typeof item.doi==="string"&&/^10\.\d{4,9}\//.test(item.doi)?item.doi:null;
    const link=doi?"https://doi.org/"+encodeURIComponent(doi):
      id?"https://europepmc.org/article/"+encodeURIComponent(item.source||"MED")+"/"+id:null;
    return link?result(item.title||"Publicación académica",link,
      [item.authorString,item.journalTitle,item.pubYear].filter(Boolean).join(" · "),
      "Europe PMC",item.firstPublicationDate||null):null;
  }).filter(item=>item&&urlAllowed(item.url));
}
export async function wikimediaVideos(query){
  const u=new URL("https://commons.wikimedia.org/w/api.php");
  u.search=new URLSearchParams({action:"query",generator:"search",
    gsrsearch:"filetype:video "+query,gsrnamespace:"6",gsrlimit:"20",
    prop:"imageinfo",iiprop:"url|mime",iiurlwidth:"520",format:"json"}).toString();
  const data=await json(u);
  return Object.values(data.query?.pages||{}).map(page=>{
    const video=page.imageinfo?.[0];
    if(!video||!/^video\/(webm|ogg|mp4|quicktime)$/.test(video.mime||""))return null;
    const url=video.descriptionurl||video.url;
    const item=result(page.title?.replace(/^File:/,"")||"Video",
      url,"Video de archivo multimedia abierto · "+video.mime,
      "Wikimedia Commons · Video",null,
      urlAllowed(video.thumburl)?video.thumburl:null);
    item.platform="Wikimedia Commons";
    // Only an actual video URL furnished by Commons may be played in-app.
    // No guessed YouTube embeds or fabricated stream URLs.
    if(/^https:\/\/upload\.wikimedia\.org\//.test(video.url||""))
      item.mediaUrl=video.url;
    return item;
  }).filter(item=>item&&urlAllowed(item.url));
}
export async function gdeltNews(query){
  const u=new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  u.search=new URLSearchParams({query,mode:"artlist",format:"json",
    maxrecords:"15",timespan:"1week"}).toString();
  const data=await json(u);
  return (data.articles||[]).map(item=>
    result(item.title||"",item.url,
      [item.domain,item.language].filter(Boolean).join(" · "),
      "GDELT · prensa",typeof item.seendate==="string"?item.seendate:null,
      urlAllowed(item.socialimage)?item.socialimage:null)
  ).filter(item=>item.title&&urlAllowed(item.url));
}
export function dedupe(items) {
  const seen = new Set();
  return items.filter(item => {
    if(!item.title || !urlAllowed(item.url))return false;
    const url=new URL(item.url);
    // Preserve case-sensitive paths and meaningful query parameters. Only
    // discard tracking identifiers, fragments and an optional path slash.
    for(const key of [...url.searchParams.keys()])
      if(/^utm_/i.test(key)||/^(fbclid|gclid|msclkid)$/i.test(key))url.searchParams.delete(key);
    const key=url.origin.toLowerCase()+url.pathname.replace(/\/$/,"")+url.search;
    if(seen.has(key))return false;
    seen.add(key);
    return true;
  });
}
const cache = new Map();
export async function search(query, type = "all", { fresh = false, page = 1, collection = "web" } = {}) {
  const spec = parseQuery(normalizeQuery(query));
  const q = spec.query;
  if (spec.errors.length) return { error: spec.errors.join(" ") };
  if (q.length < 2) return { error: "Escribe al menos dos caracteres de búsqueda además de los filtros." };
  const selected = ["all", "images", "news", "videos", "research", "books"].includes(type) ? type : "all";
  if(!Number.isInteger(page)||page<1||page>5)
    return {error:"La página de búsqueda debe estar entre 1 y 5."};
  if(page>1 && selected!=="all")
    return {error:"La paginación adicional solo está disponible para la búsqueda web."};
  if(!["web","commons"].includes(collection) ||
    (collection==="commons" && !["images","videos"].includes(selected)))
    return {error:"Colección de búsqueda no válida para esta categoría."};
  // Commons is an opt-in OPEN ARCHIVE, never a surrogate for the web, YouTube
  // or TikTok. Cache entries for the two collections must remain isolated.
  const archive=collection==="commons" || spec.source==="wikimedia";
  const key = selected + ":" + page + ":" + collection + ":" + spec.input.toLocaleLowerCase("es");
  const cached = cache.get(key);
  if (!fresh && cached && cached.expires > Date.now()) return cached.value;
  const videoQuery=spec.site?q+" site:"+spec.site:q;
  const platformAllowed=host=>!spec.site||
    host===spec.site||host.endsWith("."+spec.site)||
    spec.site.endsWith("."+host);
  const sources = selected === "books" ? [["Open Library", () => openLibrary(q)]]
    : selected === "images"
    ? (archive
       ? [["Wikimedia Commons", () => wikimediaImages(q)]]
       : [["Brave", () => braveSearch(spec.site ? q + " site:" + spec.site : q, "images")],
          ["Google", () => googleSearch(spec.site ? q + " site:" + spec.site : q, "images")]])
    : selected === "news"
    ? [["GDELT · prensa", () => gdeltNews(q)], ["Brave", () => braveSearch(spec.site ? q + " site:" + spec.site : q, "news")], ["Google", () => googleSearch(spec.site ? q + " site:" + spec.site : q, "news")]]
    : selected === "videos"
    ? archive
      ? [["Wikimedia Commons · Video", () => wikimediaVideos(q)]]
      : [
      // WEB video mode must never silently fall back to Wikimedia Commons.
      // It returns real web/video-platform providers only, or an honest empty
      // result with direct platform continuation actions in the client.
      ...(platformAllowed("youtube.com")?[["YouTube",()=>youtubeDataVideos(q)]]:[]),
      ["Brave · Vídeos",()=>braveSearch(videoQuery,"videos")],
      ...(platformAllowed("youtube.com")?[
        ["Brave · YouTube",async()=>verifiedVideoResults(
          await braveSearch(q+" site:youtube.com","web"),"YouTube")],
        ["Google · YouTube",async()=>verifiedVideoResults(
          await googleSearch(q+" site:youtube.com","web"),"YouTube")]
      ]:[]),
      ...(platformAllowed("tiktok.com")?[
        ["Brave · TikTok",async()=>verifiedVideoResults(
          await braveSearch(q+" site:tiktok.com","web"),"TikTok")],
        ["Google · TikTok",async()=>verifiedVideoResults(
          await googleSearch(q+" site:tiktok.com","web"),"TikTok")]
      ]:[])
    ]
    : selected === "research"
    ? [["Crossref", () => crossref(q)], ["OpenAlex", () => openAlex(q)], ["Europe PMC", () => europePMC(q)], ["Wikipedia", () => wikipedia(q)]]
    : [["Brave", () => braveSearch(spec.site ? q + " site:" + spec.site : q,"web",page)],
       ["Google", () => googleSearch(spec.site ? q + " site:" + spec.site : q,"web",page)],
       // User-specified source operators still allow an explicit encyclopedia
       // lookup; an ordinary web search never silently becomes Wikipedia.
       ...(page===1 && spec.source==="wikipedia"?[["Wikipedia", () => wikipedia(q)]]:[]),
       ...(page===1 && spec.source==="wikidata"?[["Wikidata", () => wikidata(q)]]:[])];
  // The default SERP is a WEB search, not a mixed academic/book feed.
  // Crossref, OpenAlex and Europe PMC belong to Investigación; Open Library
  // belongs to Libros. General web coverage depends on a configured index.
  const settled = await Promise.allSettled(sources.map(async ([name, fn]) => ({ name, items: await fn() })));
  const errors = [], available = [], results = [];
  let moreFromProviders=false;
  settled.forEach((entry, i) => {
    if (entry.status === "rejected") errors.push(sources[i][0]);
    else if (entry.value.items === null) available.push(sources[i][0] + " no configurado");
    else {
      available.push(entry.value.name);
      results.push(...entry.value.items);
      if(selected==="all" && page<5 && (
        (entry.value.items.hasMorePage ?? (
          (entry.value.name==="Brave" && entry.value.items.length>=20) ||
          (entry.value.name==="Google" && entry.value.items.length>=10)
        ))
      ))moreFromProviders=true;
    }
  });
  if(selected==="videos"){
    for(const item of results){
      const identity=videoIdentity(item.url);
      if(identity){
        item.platform=identity.platform;
        item.videoId=identity.videoId;
        item.url=identity.canonical;
      }
    }
  }
  const payload = {
    query: q, originalQuery: spec.input, filters: { site: spec.site, after: spec.after, before: spec.before, source: spec.source, excludes: spec.excludes, phrases: spec.phrases },
    type: selected, page, mediaCollection: ["images","videos"].includes(selected)
      ? (archive?"commons":"web"):null,
    hasMore: selected==="all" && moreFromProviders,
    results: rankResults(selected==="videos"
      ?dedupeVideoResults(dedupe(results)):dedupe(results), spec, selected),
    sources: available,
    mediaCoverage:["videos","images"].includes(selected)?{
      webIndex:available.some(name=>name==="Brave"||name==="Google"||
        /^(Brave|Google) · /.test(name) && !name.endsWith(" no configurado")),
      archive:archive,
      providersUnavailable:errors.length+available.filter(name=>name.endsWith(" no configurado")).length
    }:null,
    videoCoverage: selected==="videos"?{
      youtubeApi:available.includes("YouTube"),
      webIndex:available.some(name=>/^(Brave|Google) · /.test(name) &&
        !name.endsWith(" no configurado")),
      providersUnavailable:errors.length+available.filter(name=>name.endsWith(" no configurado")).length
    }:null,
    webCoverage: selected === "all"
      ? (available.some(name => name === "Brave" || name === "Google") ? "general-index" : "limited")
      : null,
    failedSources: errors, fetchedAt: new Date().toISOString(),
    message: !available.some(s => !s.includes("no configurado"))
      ? (selected==="all"?"No hay un índice web general conectado. WAEWEB no sustituirá Internet con Wikipedia ni Wikimedia."
        :selected==="videos"?"No hay un índice de vídeo web conectado. WAEWEB no sustituirá YouTube o TikTok con Wikimedia."
        :"No hay proveedores disponibles para esta categoría.")
      : null
  };
  // Retain the API's extractive brief for clients that need it, but the
  // consumer search UI displays organic links first and hides this panel.
  payload.brief = selected === "all" || selected === "research" ? researchBrief(payload.results) : null;
  // Never freeze a transient outage or an unconfigured search category in
  // the cache. A legitimate zero-hit response from a reachable source may cache.
  if (!errors.length && available.some(name => !name.endsWith(" no configurado"))) {
    if (cache.size > 200) cache.clear();
    cache.set(key, { value: payload, expires: Date.now() + (selected === "news" ? 60000 : 300000) });
  }
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
