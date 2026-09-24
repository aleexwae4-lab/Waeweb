import { parseQuery, rankResults, researchBrief } from "./intelligence.mjs";
import {videoIdentity, verifiedVideoResults, youtubeDataVideos, dedupeVideoResults, peertubeEmbed} from "./video-discovery.mjs";
import {internetArchiveVideos} from "./archive-videos.mjs";
import {discoverOpenWeb,localWebSearch,webIndexStats} from "./web-index.mjs";
import {googleBooks, projectGutenberg, congressBooks, internetArchiveBooks, BOOK_SOURCES} from "./book-providers.mjs";
import {NEWS_WINDOWS,normalizeNewsDate,newsFeedSources,rankNewsResults} from "./news.mjs";
import {rankImageResults} from "./image-intelligence.mjs";
import {flickrPublicImages} from "./flickr-images.mjs";
import {pinterestQuery,verifiedPinterestImages,labelPinterestImages}
  from "./pinterest-discovery.mjs";
import {searxngWeb,searxngImages,technicalWebQuery,stackExchangeWeb,mdnWeb,githubPublicRepositories} from "./web-providers.mjs";
import {registerWebHits} from "./web-preview.mjs";
import {directorySites,wikidataOfficialSites,navigationalName} from "./site-discovery.mjs";
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
  const items=(data.items || []).map(item => {
    const isImage=type==="images";
    const link=isImage&&urlAllowed(item.image?.contextLink)?item.image.contextLink:item.link;
    const thumb=item.image?.thumbnailLink || item.pagemap?.cse_thumbnail?.[0]?.src || null;
    const entry=result(item.title,link,item.snippet,"Google Programmable Search",
      item.pagemap?.metatags?.[0]?.["article:published_time"] || null,
      isImage?(urlAllowed(thumb)?thumb:item.link):thumb);
    if(isImage){
      entry.fullImage=urlAllowed(item.link)?item.link:null;
      entry.width=Number(item.image?.width)||null;
      entry.height=Number(item.image?.height)||null;
      entry.mime=typeof item.mime==="string"?item.mime:null;
      entry.license=null;
    }
    return entry;
  }).filter(item => item.title && urlAllowed(item.url) &&
    (type!=="images"||urlAllowed(item.image)));
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
    const image = category === "images"
      ? item.thumbnail?.src || item.properties?.url || item.properties?.placeholder || null
      : item.thumbnail?.src || null;
    const entry=result(item.title || "", link, item.description || item.snippet || item.source || "",
      "Brave Search", item.page_age || item.page_fetched || null, urlAllowed(image) ? image : null);
    if(category==="images"){
      entry.width=Number(item.properties?.width||item.width)||null;
      entry.height=Number(item.properties?.height||item.height)||null;
      entry.fullImage=urlAllowed(item.properties?.url)?item.properties.url:null;
      entry.mime=null;entry.license=null;
    }
    return entry;
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

// Keyless independent image catalog. Wikimedia Commons also participates in image search.
export async function openverseImages(query){
  const u=new URL("https://api.openverse.org/v1/images/");
  u.search=new URLSearchParams({q:query,page_size:"30",mature:"false"}).toString();
  const data=await json(u);
  return (Array.isArray(data.results)?data.results:[]).flatMap(item=>{
    if(item.source==="wikimedia")return [];
    const link=urlAllowed(item.foreign_landing_url)?item.foreign_landing_url:item.url;
    const image=urlAllowed(item.thumbnail)?item.thumbnail:item.url;
    if(!urlAllowed(link)||!urlAllowed(image))return [];
    const creator=clean(item.creator||""),license=clean(item.license||"");
    const entry=result(item.title||"Imagen",link,
      [creator?"Autoría: "+creator:null,license?"Licencia: "+license:null]
        .filter(Boolean).join(" · ")||"Imagen indexada en Openverse",
      "Openverse · imágenes abiertas",null,image);
    entry.width=Number(item.width)||null;
    entry.height=Number(item.height)||null;
    entry.mime=typeof item.filetype==="string"?"image/"+item.filetype:null;
    entry.license=license||null;
    entry.fullImage=urlAllowed(item.url)?item.url:null;
    return [entry];
  });
}
// PeerTube is not YouTube or TikTok; preserve source and canonical video URL.
export async function peertubeVideos(query){
  const u=new URL("https://sepiasearch.org/api/v1/search/videos");
  u.search=new URLSearchParams({search:query,count:"15",nsfw:"false"}).toString();
  const data=await json(u);
  return (Array.isArray(data.data)?data.data:[]).flatMap(item=>{
    if(!urlAllowed(item.url)||!item.name)return [];
    const video=result(item.name,item.url,
      [item.channel?.displayName||item.channel?.name,item.description]
        .filter(x=>typeof x==="string"&&x.trim()).join(" · ").slice(0,700),
      "PeerTube · vídeo abierto",item.publishedAt||null,
      urlAllowed(item.thumbnailUrl)?item.thumbnailUrl:null);
    video.platform="PeerTube";
    video.embedUrl=peertubeEmbed({url:item.url,uuid:item.uuid});
    video.playback=video.embedUrl?"embed":"external";
    video.duration=Number(item.duration)>0?Number(item.duration):null;
    return [video];
  });
}
export async function wikimediaImages(query) {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  u.search = new URLSearchParams({
    action: "query", generator: "search", gsrsearch: query,
    gsrnamespace: "6", gsrlimit: "48", prop: "imageinfo",
    iiprop: "url|mime|size|extmetadata", iiurlwidth: "720", format: "json"
  }).toString();
  const data = await json(u);
  return Object.values(data.query?.pages || {}).map(page => {
    const image = page.imageinfo?.[0];
    if(!image||!image.mime?.startsWith("image/"))return null;
    const entry=result(page.title.replace(/^File:/, ""), image.descriptionurl || image.url,
      "Imagen de Wikimedia Commons", "Wikimedia Commons", null, image.thumburl || image.url);
    entry.width=Number(image.width)||null;
    entry.height=Number(image.height)||null;
    entry.mime=image.mime;
    entry.fullImage=urlAllowed(image.url)?image.url:null;
    const license=clean(image.extmetadata?.LicenseShortName?.value||"");
    entry.license=license||null;
    return entry;
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
export async function dataCite(query){
  // DataCite's public DOI metadata API; results are records, not a web index.
  const u=new URL("https://api.datacite.org/dois");
  u.search=new URLSearchParams({query,"page[size]":"12",sort:"relevance"}).toString();
  const data=await json(u);
  return (Array.isArray(data.data)?data.data:[]).flatMap(item=>{
    const a=item.attributes||{};
    const doi=typeof a.doi==="string"?a.doi:item.id;
    if(!/^10\.\d{4,9}\/[^\s]{1,180}$/i.test(doi||""))return [];
    const title=Array.isArray(a.titles)?a.titles.find(t=>typeof t.title==="string"&&t.title.trim())?.title:null;
    if(!title)return [];
    const description=Array.isArray(a.descriptions)?a.descriptions.find(d=>typeof d.description==="string")?.description:null;
    const publisher=typeof a.publisher==="string"?a.publisher:"";
    const kind=typeof a.types?.resourceTypeGeneral==="string"?a.types.resourceTypeGeneral:"";
    const snippet=[publisher,kind,description].filter(Boolean).join(" · ").slice(0,950);
    return [result(title,"https://doi.org/"+encodeURIComponent(doi),
      snippet||"Registro DOI de DataCite","DataCite",
      /^\d{4}$/.test(String(a.publicationYear||""))?String(a.publicationYear):null)];
  });
}
export async function libraryOfCongress(query) {
  // Official open search endpoint. Each returned URL belongs to the actual
  // LOC record; never manufacture a document from a missing identifier.
  const u=new URL("https://www.loc.gov/search/");
  u.search=new URLSearchParams({q:query,fo:"json",c:"12",at:"results"}).toString();
  const data=await json(u);
  return (Array.isArray(data.results)?data.results:[]).flatMap(item=>{
    if(typeof item.id!=="string"||!/^https:\/\/(?:www\.)?loc\.gov\//i.test(item.id))return [];
    const title=Array.isArray(item.title)?item.title[0]:item.title;
    if(typeof title!=="string"||!title.trim())return [];
    const description=Array.isArray(item.description)?item.description[0]:item.description;
    const subjects=Array.isArray(item.subject)?item.subject.slice(0,3).join(", "):"";
    const snippet=[description,subjects].filter(x=>typeof x==="string"&&x.trim()).join(" · ").slice(0,950);
    const cover=Array.isArray(item.image_url)?item.image_url[0]:null;
    return [result(title,item.id,snippet||"Ficha documental del catálogo público",
      "Library of Congress",typeof item.date==="string"?item.date:null,
      urlAllowed(cover)?cover:null)];
  });
}
export async function gdeltNews(query,window="7d"){
  const u=new URL("https://api.gdeltproject.org/api/v2/doc/doc");
  u.search=new URLSearchParams({query,mode:"artlist",format:"json",
    maxrecords:"40",timespan:{"24h":"1d","7d":"1week","30d":"1month"}[window]||"1week",
    sort:"datedesc"}).toString();
  const data=await json(u);
  return (data.articles||[]).map(item=>{
    const entry=result(item.title||"",item.url,
      [item.domain,item.language].filter(Boolean).join(" · "),
      "GDELT · prensa",null,
      urlAllowed(item.socialimage)?item.socialimage:null);
    // GDELT seendate indicates discovery, NOT the publication timestamp.
    entry.seenAt=normalizeNewsDate(item.seendate);
    entry.newsDateKind="detected";
    entry.publisher=typeof item.domain==="string"?item.domain:null;
    return entry;
  }).filter(item=>item.title&&urlAllowed(item.url));
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
export async function search(query, type = "all", { fresh = false, page = 1, collection = "web", newsWindow = "7d" } = {}) {
  const spec = parseQuery(normalizeQuery(query));
  const q = spec.query;
  if (spec.errors.length) return { error: spec.errors.join(" ") };
  if (q.length < 2) return { error: "Escribe al menos dos caracteres de búsqueda además de los filtros." };
  const selected = ["all", "images", "news", "videos", "research", "knowledge", "books"].includes(type) ? type : "all";
  if(!Number.isInteger(page)||page<1||page>5)
    return {error:"La página de búsqueda debe estar entre 1 y 5."};
  if(selected==="news" && !Object.hasOwn(NEWS_WINDOWS,newsWindow))
    return {error:"Ventana de noticias no válida. Usa 24h, 7d o 30d."};
  if(page>1 && selected!=="all")
    return {error:"La paginación adicional solo está disponible para la búsqueda web."};
  if(!["web","commons"].includes(collection) ||
    (collection==="commons" && !["images","videos"].includes(selected)))
    return {error:"Colección de búsqueda no válida para esta categoría."};
  // Commons enriches regular media results alongside independent providers.
  // The legacy explicit archive API remains available without a separate UI.
  const archive=collection==="commons" || spec.source==="wikimedia";
  const key = selected + ":" + page + ":" + collection + ":" +
    (selected==="news"?newsWindow+":":"") + spec.input.toLocaleLowerCase("es");
  const cached = cache.get(key);
  if (!fresh && cached && cached.expires > Date.now()) {
    // Registered links expire independently of cached searches. Refresh the
    // right to preview genuine result URLs even when a search hits the cache.
    if(["all","news","knowledge","research"].includes(selected))
      registerWebHits(cached.value.results);
    return cached.value;
  }
  const videoQuery=spec.site?q+" site:"+spec.site:q;
  const pinterestOnly=selected==="images"&&spec.source==="pinterest";
  // A regular image query always includes Pinterest discovery if the
  // existing indexes have credentials. No keyword gate, separate tab, or
  // synthetic thumbnail. Generic search hits are blended into the same grid.
  const pinterestAllowed=selected==="images"&&!archive&&
    (!spec.site||spec.site==="pinterest.com"||spec.site.endsWith(".pinterest.com"))&&
    (!spec.source||spec.source==="pinterest");
  const platformAllowed=host=>!spec.site||
    host===spec.site||host.endsWith("."+spec.site)||
    spec.site.endsWith("."+host);
  const bookSources = [
    ["Open Library", () => openLibrary(q)],
    ["Google Books", () => googleBooks(q)],
    ["Library of Congress", () => congressBooks(q)],
    ["Project Gutenberg", () => projectGutenberg(q)],
    ["Internet Archive", () => internetArchiveBooks(q)]
  ];
  const bookSourceFilter = {openlibrary:"Open Library",googlebooks:"Google Books",
    loc:"Library of Congress",gutenberg:"Project Gutenberg",internetarchive:"Internet Archive"};
  const sources = selected === "books" ? (spec.source
    ? bookSources.filter(([name]) => name === bookSourceFilter[spec.source]) : bookSources)
    : selected === "images"
    ? (archive
       ? [["Wikimedia Commons", () => wikimediaImages(q)]]
       : [...(!pinterestOnly?[
          ["Brave", () => braveSearch(spec.site ? q + " site:" + spec.site : q, "images")],
          ["Google", () => googleSearch(spec.site ? q + " site:" + spec.site : q, "images")],
          ["SearXNG · imágenes",()=>searxngImages(spec.site?q+" site:"+spec.site:q)],
          ...(!spec.site?[["Openverse",()=>openverseImages(q)],
            ["Flickr · fotos públicas",()=>flickrPublicImages(q)]]:[]),
          ...(!spec.site || platformAllowed("commons.wikimedia.org")
            ? [["Wikimedia Commons",()=>wikimediaImages(q)]]:[])
         ]:[]),
         ...(pinterestAllowed?[
           ["Pinterest · Brave",async()=>verifiedPinterestImages(
             await braveSearch(pinterestQuery(q),"images"),"Brave")],
           ["Pinterest · Google",async()=>verifiedPinterestImages(
             await googleSearch(pinterestQuery(q),"images"),"Google")],
           ["Pinterest · SearXNG",async()=>verifiedPinterestImages(
             await searxngImages(pinterestQuery(q)),"SearXNG")]
         ]:[])])
    : selected === "news"
    ? [["GDELT · prensa", () => gdeltNews(q,newsWindow)],
       ...(!spec.site?newsFeedSources(q,newsWindow):[]),
       ["Brave", () => braveSearch(spec.site ? q + " site:" + spec.site : q, "news")],
       ["Google", () => googleSearch(spec.site ? q + " site:" + spec.site : q, "news")]]
    : selected === "videos"
    ? archive
      ? [["Wikimedia Commons · Video", () => wikimediaVideos(q)]]
      : [
      // Commons clips join verified platform clips under their actual
      // Wikimedia identity; never relabel them as YouTube or TikTok.
      ...(platformAllowed("youtube.com")?[["YouTube",()=>youtubeDataVideos(q)]]:[]),
      ["Brave · Vídeos",()=>braveSearch(videoQuery,"videos")],
      ["PeerTube",()=>peertubeVideos(q)],
      ...(!spec.site || platformAllowed("archive.org")
        ? [["Internet Archive · Video",()=>internetArchiveVideos(q)]]:[]),
      ...(!spec.site || platformAllowed("commons.wikimedia.org")
        ? [["Wikimedia Commons · Video",()=>wikimediaVideos(q)]]:[]),
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
    : selected === "knowledge"
    ? [["Wikipedia",()=>wikipedia(q)],["Wikidata",()=>wikidata(q)],
       ["Crossref",()=>crossref(q)],["OpenAlex",()=>openAlex(q)],
       ["Europe PMC",()=>europePMC(q)],["Open Library",()=>openLibrary(q)],
       ["Library of Congress",()=>libraryOfCongress(q)],["DataCite",()=>dataCite(q)]]
    : [
       // Real destinations for a named website: curated exact-match URLs and
       // Wikidata P856. These do not claim broad web-index coverage.
       ...(page===1&&!spec.source&&!spec.site&&navigationalName(q)
         ? (directorySites(q).length
           ? [["WAE WEB · directorio",()=>directorySites(q)]]
           : [["Wikidata · sitios web",()=>wikidataOfficialSites(q)]])
         : []),
       ["Brave", () => braveSearch(spec.site ? q + " site:" + spec.site : q,"web",page)],
       ["Google", () => googleSearch(spec.site ? q + " site:" + spec.site : q,"web",page)],
       ...(!spec.source||spec.source==="searxng"
         ? [["SearXNG",()=>searxngWeb(spec.site?q+" site:"+spec.site:q,page)]]:[]),
       ...(page===1&&technicalWebQuery(q,spec.site,spec.source)?[
         ...((!spec.source||spec.source==="stackoverflow")&&platformAllowed("stackoverflow.com")
           ? [["Stack Overflow",()=>stackExchangeWeb(q,"stackoverflow")]]:[]),
         ...((!spec.source||spec.source==="superuser")&&platformAllowed("superuser.com")
           ? [["Super User",()=>stackExchangeWeb(q,"superuser")]]:[]),
         ...((!spec.source||spec.source==="mdn")&&platformAllowed("developer.mozilla.org")
           ? [["MDN Web Docs",()=>mdnWeb(q)]]:[]),
         ...((!spec.source||spec.source==="github")&&platformAllowed("github.com")
           ? [["GitHub · repositorios públicos",()=>githubPublicRepositories(q)]]:[])
       ]:[]),
       // Discovery is a specialist public-link feed; it is not a general
       // Internet index. Wikipedia and Wikidata enrich, not replace, web hits.
       ...(page===1 && !spec.source && !spec.site
         ? [["WAE Discovery",()=>discoverOpenWeb(q)]]:[]),
       // Add a bounded number of encyclopedia entries on the first page;
       // other real web providers retain their own relevance and provenance.
       ...(page===1 && !spec.site && (!spec.source || spec.source==="wikipedia")
         ? [["Wikipedia",async()=>(await wikipedia(q)).slice(0,3)]]:[]),
       ...(page===1 && !spec.site && (!spec.source || spec.source==="wikidata")
         ? [["Wikidata",async()=>(await wikidata(q)).slice(0,2)]]:[])];
  // The default SERP is a WEB search, not a mixed academic/book feed.
  // Crossref, OpenAlex and Europe PMC belong to Investigación; Open Library
  // belongs to Libros. General web coverage depends on a configured index.
  // The local index is a bounded volatile cache of independently sourced
  // article-link metadata. It does not contain scraped article bodies.
  const previous=selected==="all"&&page===1&&!spec.source&&!spec.site
    ?localWebSearch(q):[];
  const settled = await Promise.allSettled(sources.map(async ([name, fn]) => ({ name, items: await fn() })));
  const errors = [], available = [], results = [];
  let moreFromProviders=false;
  settled.forEach((entry, i) => {
    if (entry.status === "rejected") errors.push(sources[i][0]);
    else if (entry.value.items === null) available.push(sources[i][0] + " no configurado");
    else {
      // An empty named-site lookup must not masquerade as web coverage.
      if(entry.value.items.length ||
        !["WAE WEB · directorio","Wikidata · sitios web"].includes(entry.value.name))
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
  if(selected==="all"&&page===1&&!spec.source&&!spec.site && previous.length){
    results.push(...previous);
    available.push("WAE Index local");
  }
  if(selected==="videos"){
    for(const item of results){
      if(item.platform==="Wikimedia Commons"&&item.mediaUrl)item.playback="native";
      const identity=videoIdentity(item.url);
      if(identity){
        item.platform=identity.platform;
        item.videoId=identity.videoId;
        item.url=identity.canonical;
        item.playback=identity.platform==="YouTube"||identity.platform==="TikTok"?"embed":null;
      }
    }
  }
  const imageRanked=selected==="images"
    ?rankImageResults(rankResults(labelPinterestImages(results),spec,selected),q):null;
  const payload = {
    query: q, originalQuery: spec.input, filters: { site: spec.site, after: spec.after, before: spec.before, source: spec.source, excludes: spec.excludes, phrases: spec.phrases },
    type: selected, page,
    newsWindow:selected==="news"?newsWindow:null,
    bookCoverage:selected==="books"?{
      configuredSources:BOOK_SOURCES,
      retrievedSources:available.filter(name=>!name.endsWith(" no configurado")),
      failedSources:errors, resultCountBySource:Object.fromEntries(
        BOOK_SOURCES.map(name=>[name,results.filter(item=>item.source===name).length]))
    }:null, knowledgeCoverage:selected==="knowledge"?{
      kind:"federated_public_sources", index:"not_general_web",
      configuredSources:sources.map(([name])=>name),
      retrievedSources:available.filter(name=>!name.endsWith(" no configurado")),
      failedSources:errors
    }:null, mediaCollection: ["images","videos"].includes(selected)
      ? (archive?"commons":"web"):null,
    hasMore: selected==="all" && moreFromProviders,
    results: selected==="images"?imageRanked.results
      :selected==="news"
        ?rankNewsResults(rankResults(dedupe(results),spec,selected),q,newsWindow)
        :rankResults(selected==="videos"
          ?dedupeVideoResults(dedupe(results)):dedupe(results), spec, selected),
    sources: available,
    searchCoverage:selected==="all"?{
      generalIndexes:["Brave","Google","SearXNG"].filter(name=>available.includes(name)),
      specialistSources:["WAE WEB · directorio","Wikidata · sitios web","WAE Discovery","WAE Index local","Stack Overflow",
        "Super User","MDN Web Docs","GitHub · repositorios públicos","Wikipedia","Wikidata"]
        .filter(name=>available.includes(name)),
      unconfigured:sources.map(([name])=>name).filter(name=>available.includes(name+" no configurado")),
      failed:errors,inlineExcerpt:true,entireWebIndexed:false,
      navigationalSites:results.filter(item=>item.siteLink===true).length
    }:null,
    newsCoverage:selected==="news"?{
      mode:"on_demand",window:newsWindow,
      configuredSources:sources.map(([name])=>name),
      respondingSources:available.filter(name=>!name.endsWith(" no configurado")),
      unavailableSources:errors,
      noPublicationDate:results.filter(item=>!item.date).length,
      liveGuarantee:false
    }:null,
    imageDiscovery:selected==="images"?{
      intent:imageRanked.intent,duplicatesRemoved:imageRanked.duplicatesRemoved,
      pinterest:{
        mode:"indexed_public_pins",officialApi:false,
        hits:imageRanked.results.filter(item=>item.imagePlatform==="Pinterest").length,
        discoveredVia:["Pinterest · Brave","Pinterest · Google","Pinterest · SearXNG"]
          .filter(name=>available.includes(name)),
        unconfigured:["Pinterest · Brave","Pinterest · Google","Pinterest · SearXNG"]
          .filter(name=>available.includes(name+" no configurado")),
        notGuaranteed:true
      },
      metadataBased:true,visualModelUsed:false,
      availableResults:imageRanked.results.length,
      dimensionsKnown:imageRanked.results.filter(item=>item.width&&item.height).length,
      providers:sources.map(([name])=>name)
    }:null,
    mediaCoverage:["videos","images"].includes(selected)?{
      webIndex:available.some(name=>name==="Brave"||name==="Google"||
        name==="SearXNG · imágenes"||
        /^(Brave|Google) · /.test(name) && !name.endsWith(" no configurado")),
      archive:archive,
      commonsAvailable:available.some(name=>name==="Wikimedia Commons"||name==="Wikimedia Commons · Video"),
      providersUnavailable:errors.length+available.filter(name=>name.endsWith(" no configurado")).length,
      openverseAvailable:available.includes("Openverse"),
      flickrAvailable:available.includes("Flickr · fotos públicas")
    }:null,
    videoCoverage: selected==="videos"?{
      youtubeApi:available.includes("YouTube"),
      peertubeAvailable:available.includes("PeerTube"),
      archiveAvailable:available.includes("Internet Archive · Video"),
      commonsAvailable:available.includes("Wikimedia Commons · Video"),
      webIndex:available.some(name=>/^(Brave|Google) · /.test(name) &&
        !name.endsWith(" no configurado")),
      providersUnavailable:errors.length+available.filter(name=>name.endsWith(" no configurado")).length
    }:null,
    webCoverage: selected === "all"
      ? (available.some(name => ["Brave","Google","SearXNG"].includes(name)) ? "general-index"
         : available.some(name=>["WAE Discovery","WAE Index local",
             "Stack Overflow","Super User","MDN Web Docs",
             "WAE WEB · directorio","Wikidata · sitios web"].includes(name))
           ? "specialized":"limited")
      : null,
    webDiscovery:selected==="all"?{
      scope:"Hacker News linked pages only",index:webIndexStats(),
      provider:available.includes("WAE Discovery")?"available":
        errors.includes("WAE Discovery")?"unavailable":"not_queried",
      independentlyVerifiedContent:false
    }:null,
    failedSources: errors, fetchedAt: new Date().toISOString(),
    message: !available.some(s => !s.includes("no configurado"))
      ? (selected==="all"?"No se pudieron consultar las fuentes web y enciclopédicas disponibles."
        :selected==="videos"?"No se pudieron recuperar vídeos de las plataformas y archivos disponibles."
        :"No hay proveedores disponibles para esta categoría.")
      : null
  };
  // Only URLs that appeared in real public search results can be read.
  // The preview still enforces DNS pinning, robots.txt and rate limits.
  if(["all","news","knowledge","research"].includes(selected))
    registerWebHits(payload.results);
  // Retain the API's extractive brief for clients that need it, but the
  // consumer search UI displays organic links first and hides this panel.
  payload.brief = ["all","research","knowledge"].includes(selected)
    ? researchBrief(payload.results, selected==="knowledge"?7:4) : null;
  // Never freeze a transient outage or an unconfigured search category in
  // the cache. A legitimate zero-hit response from a reachable source may cache.
  if (!errors.length && available.some(name => !name.endsWith(" no configurado"))) {
    if (cache.size > 200) cache.clear();
    cache.set(key, { value: payload, expires: Date.now() + (selected === "news" ? 45000 : 300000) });
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
