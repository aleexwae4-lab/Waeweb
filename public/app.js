import { createWorkspace, asMarkdown } from "/workspace.js";
import { openBrowser, hideBrowser } from "/browser.js";
import { classifyOmnibox } from "/omnibox.js";
import { osmEmbedUrl, osmPlaceUrl, validMapPlace, localMapCoordinates } from "/maps-core.js";
import {createDirections} from "/directions.js";
import {createNativeMap} from "/native-map.js";
import { createTranslator } from "/translator.js";
"use strict";
const byId = id => document.getElementById(id);
const hero = byId("hero");
const resultsView = byId("results-view");
const heroInput = byId("hero-input");
const resultsInput = byId("results-input");
const resultsContainer = byId("results-container");
const stats = byId("result-stats");
const sourceFilter = byId("source-filter");
const workspace = createWorkspace();
const readerPanel = byId("reader-panel");
const readerStatus = byId("reader-status");
const readerOutput = byId("reader-output");
let readerEnabled = false;
let businessSearchEnabled = false;
let readerBusy = false;
let vaultToken = null;
const vaultDialog = byId("vault-dialog");
const heroStatus = byId("hero-status");
const panel = byId("knowledge-panel");
const answer = byId("answer-slot");
const weatherSlot = byId("weather-slot");
let state = { query: "", type: "all", results: [], data: null, selectedSource: "", controller: null, sequence: 0, summary: "" };
let activeDirections=null;
function stopDirections(){activeDirections?.dispose();activeDirections=null;}
const translator = createTranslator({getJSON,resultsContainer,stats,sourceFilter,answer,weatherSlot,panel});
function renderTranslator(push=true){
  stopDirections();
  state.controller?.abort();state.sequence++;
  speechSynthesisSafeCancel();hideBrowser();
  state.type="translate";state.query="";state.data=null;state.results=[];
  hero.hidden=true;resultsView.hidden=false;resultsInput.value="";setTab("translate");
  sourceFilter.hidden=true;
  if(push)history.pushState({type:"translate"},"",location.pathname+"?type=translate");
  translator.show();
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = String(text);
  return node;
}
function append(parent, ...children) { for (const child of children) if (child) parent.append(child); return parent; }
function button(text, fn, css = "") {
  const b = element("button", css, text); b.type = "button"; b.addEventListener("click", fn); return b;
}
function external(url, title, css = "") {
  const a = element("a", css, title);
  a.href = url; a.target = "_blank"; a.rel = "noopener noreferrer";
  return a;
}
function safeUrl(value) {
  try { const u = new URL(value); return ["https:", "http:"].includes(u.protocol) ? u.href : null; }
  catch { return null; }
}
function shortHost(value) {
  try { return new URL(value).hostname.replace(/^www\./, ""); } catch { return ""; }
}
function stateCard(title, message, loading = false) {
  const card = element("div", "state-card");
  if (loading) card.append(element("span", "spinner"));
  append(card, element("h2", "", title), element("p", "", message));
  return card;
}
function setTab(type) {
  document.querySelectorAll("[data-type]").forEach(tab => {
    const selected = tab.dataset.type === type;
    tab.classList.toggle("active", selected);
    tab.setAttribute("aria-selected", String(selected));
  });
}
function goHome() {
  stopDirections();
  translator.hide();sourceFilter.hidden=false;
  hideBrowser();
  state.controller?.abort();
  state.sequence++;
  speechSynthesisSafeCancel();
  hero.hidden = false; resultsView.hidden = true;
  heroInput.value = ""; resultsInput.value = ""; heroInput.focus();
  history.pushState({}, "", location.pathname);
  scrollTo({ top: 0, behavior: "smooth" });
}
function updateAddress(query, type) {
  const u = new URL(location.href);
  u.search = new URLSearchParams({ q: query, type }).toString();
  history.pushState({ query, type }, "", u);
}
async function getJSON(path, signal, request = {}) {
  const headers = { accept: "application/json", ...request.headers };
  if (path.startsWith("/api/index/") || path === "/api/read") {
    if (!vaultToken) throw new Error("Conecta una bóveda autorizada antes de consultar el índice.");
    headers.authorization = "Bearer " + vaultToken;
  }
  const response = await fetch(path, {
    method: request.method || "GET", body: request.body,
    signal, headers, cache: "no-store", credentials: "omit"
  });
  const isPrivate = path.startsWith("/api/index/") || path === "/api/read";
  // WAEWEB sends this marker on every JSON response. If a reverse proxy,
  // deployment protection or wrong route replies first, do not blame a vault.
  const fromWaeApi = response.headers.get("x-waeweb-api") === "1";
  let data;
  try { data = await response.json(); }
  catch {
    if (!isPrivate && response.status === 401 && !fromWaeApi)
      throw new Error("HTTP 401 antes de llegar a la API pública WAEWEB. Comprueba la protección de acceso del deployment y que /api/* llegue al backend; ninguna bóveda es necesaria.");
    throw new Error("La API devolvió una respuesta no válida (HTTP " + response.status +
      "). Comprueba que /api/* esté dirigido al backend de WAEWEB.");
  }
  if (response.status === 401) {
    if (isPrivate) {
      vaultToken = null;
      updateVaultUI();
      throw new Error("La credencial de tu índice privado caducó o fue revocada.");
    }
    throw new Error(fromWaeApi
      ? "La API pública WAEWEB devolvió HTTP 401, algo inesperado en esta ruta. Comprueba el middleware de autenticación y los logs."
      : "La búsqueda pública devolvió HTTP 401 antes del backend WAEWEB. Revisa la protección de acceso del deployment y el enrutamiento /api/*; no conectes una bóveda.");
  }
  if (!response.ok) throw new Error(data.error || "La API no respondió (HTTP " + response.status + ").");
  return data;
}
function updateVaultUI() {
  byId("vault-connect").hidden = Boolean(vaultToken);
  byId("vault-disconnect").hidden = !vaultToken;
  if (readerEnabled) readerStatus.textContent = vaultToken
    ? "Bóveda conectada en esta pestaña. El índice se guarda en el disco del servidor."
    : "Conecta tu bóveda para habilitar lectura e índice privado.";
}
function openVaultDialog() {
  if (!readerEnabled) { readerStatus.textContent = "Lector desactivado o sin bóvedas configuradas."; return; }
  byId("vault-status").textContent = "";
  vaultDialog.showModal();
}
byId("vault-connect").addEventListener("click", openVaultDialog);
byId("vault-disconnect").addEventListener("click", () => {
  vaultToken = null; byId("vault-token").value = "";
  readerOutput.replaceChildren();
  state.data = null;
  state.results = [];
  sourceFilter.replaceChildren(new Option("Todas las fuentes", ""));
  resultsContainer.replaceChildren();
  answer.replaceChildren();
  panel.replaceChildren();
  stats.textContent = "Bóveda desconectada. Las consultas privadas necesitan nueva autorización.";
  updateVaultUI();
});
byId("vault-close").addEventListener("click", () => vaultDialog.close());
byId("vault-form").addEventListener("submit", async event => {
  event.preventDefault();
  const candidate = byId("vault-token").value;
  if (candidate.length < 32) { byId("vault-status").textContent = "Se requiere un token de al menos 32 caracteres."; return; }
  vaultToken = candidate;
  byId("vault-token").value = "";
  try {
    await getJSON("/api/index/search?q=wae");
    updateVaultUI();
    vaultDialog.close();
    if (state.type === "index" && state.query) performSearch(state.query, "index", false);
  } catch (error) {
    vaultToken = null;
    updateVaultUI();
    byId("vault-status").textContent = error.message;
  }
});
function formatDate(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString("es-MX", { day: "numeric", month: "short", year: "numeric" });
}
function renderResult(item, index) {
  const url = safeUrl(item.url);
  if (!url) return null;
  const card = element("article", "result-card");
  card.style.animationDelay = Math.min(index * .035, .5) + "s";
  const row = element("div", "source-row");
  const avatar = element("span", "source-avatar", (item.source || "?").slice(0, 1).toUpperCase());
  const labels = element("div");
  append(labels, element("div", "source-label", item.source || "Fuente"), element("div", "source-url", shortHost(url)));
  row.append(avatar, labels);
  const title = button(item.title, () => openBrowser(url), "result-title browser-result-title");
  title.title = "Navegar en WAEWEB: " + shortHost(url);
  if ((item.source === "Open Library" || state.type === "videos") && safeUrl(item.image)) {
    const cover = element("img", "book-cover");
    cover.src = safeUrl(item.image);
    cover.alt = (state.type === "videos" ? "Vista previa de " : "Portada de ") + item.title;
    cover.loading = "lazy";
    cover.referrerPolicy = "no-referrer";
    card.append(cover);
  }
  append(card, row, title);
  if (item.snippet) card.append(element("p", "snippet", item.snippet));
  const meta = element("div", "meta-line");
  if (item.date) meta.append(element("span", "tag", formatDate(item.date)));
  meta.append(element("span", "", "↗ Consultar documento original"));
  const save = button(workspace.has(url) ? "◆ Guardado" : "◇ Guardar fuente", () => {
    const outcome = workspace.add(item);
    if (outcome.ok) {
      save.textContent = "◆ Guardado";
      save.disabled = true;
      stats.textContent = outcome.persisted === false ? "Fuente guardada temporalmente; almacenamiento local bloqueado." : "Fuente guardada en la biblioteca local.";
      refreshLibraryCount();
    } else stats.textContent = outcome.reason;
  }, "save-button");
  save.disabled = workspace.has(url);
  meta.append(save, external(url, "↗ Abrir sitio original", "save-button"));
  if (readerEnabled && url.startsWith("https://")) {
    meta.append(button("⌕ Leer e indexar", () => requestRead(url), "save-button"));
  }
  card.append(meta);
  return card;
}
function renderImages(items) {
  const grid = element("div", "image-grid");
  items.forEach(item => {
    const link = safeUrl(item.url), image = safeUrl(item.image);
    if (!link || !image) return;
    const tile = external(link, "", "image-tile");
    const img = element("img");
    img.src = image; img.alt = item.title || "Imagen de búsqueda"; img.loading = "lazy";
    img.referrerPolicy = "no-referrer";
    append(tile, img, element("span", "", item.title || item.source));
    grid.append(tile);
  });
  return grid;
}
function speechSynthesisSafeCancel() {
  if ("speechSynthesis" in window) window.speechSynthesis.cancel();
}
function readAloud(text) {
  if (!("speechSynthesis" in window)) { stats.textContent = "La lectura por voz no está disponible en este navegador."; return; }
  if (window.speechSynthesis.speaking) { window.speechSynthesis.cancel(); return; }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "es-MX"; utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); stats.textContent = "Copiado al portapapeles."; }
  catch { stats.textContent = "No se pudo copiar. Comprueba los permisos del navegador."; }
}
function briefMarkdown(data) {
  const brief = data?.brief;
  if (!brief?.notes?.length) return "";
  return [
    "# WAE WEB · Panorama documental",
    "Consulta: " + (data.originalQuery || data.query),
    "",
    ...brief.notes.flatMap((note, i) => [
      "## " + (i + 1) + ". " + note.title,
      note.statement,
      "Fuente: " + note.source + " · " + note.url,
      note.date ? "Fecha indicada: " + note.date : "Fecha no informada",
      ""
    ]),
    brief.disclaimer
  ].join("\n");
}
function renderSummary(data) {
  answer.replaceChildren();
  if (!data.brief?.notes?.length) return;
  const notes = data.brief.notes;
  const card = element("section", "answer-card");
  append(card, element("p", "eyebrow", "◈ WAE Research Core · Evidencias rastreables"),
    element("h2", "", "Panorama de fuentes para esta búsqueda"),
    element("p", "research-disclaimer", data.brief.disclaimer));
  const noteList = element("ol", "brief-notes");
  notes.forEach((note, i) => {
    const url = safeUrl(note.url);
    if (!url) return;
    const li = element("li", "brief-note");
    const head = element("div", "brief-title");
    append(head, element("span", "tag", String(i + 1) + " · " + note.source), external(url, note.title, "brief-link"));
    append(li, head, element("p", "", note.statement));
    if (note.date) li.append(element("span", "tag", formatDate(note.date)));
    noteList.append(li);
  });
  card.append(noteList);
  const actions = element("div", "answer-actions");
  const markdown = briefMarkdown(data);
  append(actions,
    button("⧉ Copiar panorama y fuentes", () => copyText(markdown)),
    button("◖ Leer / detener", () => readAloud(notes.map(n => n.statement).join(". "))),
    button("◇ Guardar fuentes", () => {
      let saved = 0;
      for (const note of notes) {
        const response = workspace.add(note);
        if (response.ok && !response.duplicate) saved++;
      }
      refreshLibraryCount();
      stats.textContent = saved + " fuente(s) añadidas a la biblioteca local.";
    })
  );
  card.append(actions);
  answer.append(card);
}
function refreshLibraryCount() {
  byId("library-count").textContent = String(workspace.count());
}
function drawLibrary() {
  refreshLibraryCount();
  const list = byId("library-items");
  list.replaceChildren();
  const entries = workspace.list();
  if (!entries.length) {
    list.append(stateCard("Tu biblioteca está vacía", "Guarda fuentes de resultados o del panorama de investigación."));
    return;
  }
  entries.forEach(item => {
    const card = element("article", "library-entry");
    append(card, external(item.url, item.title, "result-title"),
      element("p", "", item.source + (item.date ? " · " + formatDate(item.date) : "")));
    if (item.snippet) card.append(element("p", "snippet", item.snippet));
    card.append(button("Eliminar de biblioteca", () => { workspace.remove(item.url); drawLibrary(); }, "small-action"));
    list.append(card);
  });
}
function downloadLibrary() {
  const entries = workspace.list();
  const status = byId("library-status");
  if (!entries.length) { status.textContent = "Guarda una fuente antes de exportar."; return; }
  const blob = new Blob([asMarkdown(entries)], { type: "text/markdown;charset=utf-8" });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = "WAE-WEB-investigacion.md";
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1500);
  status.textContent = entries.length + " fuente(s) preparadas para exportar.";
}
function renderPanel(data) {
  panel.replaceChildren();
  const card = element("section", "panel");
  card.append(element("h2", "", "◈ Transparencia de búsqueda"));
  card.append(element("p", "", data.type === "businesses"
    ? "Fichas publicadas voluntariamente por sus propietarios. WAE WEB todavía no verifica identidad, titularidad ni información comercial."
    : "Resultados devueltos por proveedores externos; WAE WEB no asigna una cifra global ficticia."));
  const heading = element("strong", "", "Proveedores consultados");
  card.append(heading);
  const list = element("ul");
  (data.sources || []).forEach(source => list.append(element("li", "", "✓ " + source)));
  (data.failedSources || []).forEach(source => list.append(element("li", "", "⚠ " + source + " no respondió")));
  card.append(list);
  if (data.filters) {
    const active = Object.entries(data.filters).filter(([, value]) => value && (!Array.isArray(value) || value.length));
    if (active.length) card.append(element("p", "legend", "Filtros aplicados: " + active.map(([name, value]) => name + ": " + (Array.isArray(value) ? value.join(", ") : value)).join(" · ")));
  }
  if (data.fetchedAt) card.append(element("p", "legend", "Consulta: " + formatDate(data.fetchedAt)));
  card.append(element("p", "legend", "Contrasta los resultados con sus fuentes originales. Los extractos no sustituyen una verificación independiente."));
  panel.append(card);
}
function renderPublicBusiness(item) {
  const card = element("article", "result-card public-business-card");
  append(card, element("p", "eyebrow", "♙ WAE WEB · Ficha pública autodeclarada"),
    element("h3", "business-public-title", item.name),
    element("p", "business-meta", item.category + " · " + item.city));
  if (item.description) card.append(element("p", "snippet", item.description));
  card.append(element("p", "tag", "No verificado por WAE WEB"));
  if (/^[0-9a-f-]{36}$/i.test(item.id || "")) {
    const profile = element("a", "link-button", "♙ Ver perfil del negocio");
    profile.href = "/?business=" + encodeURIComponent(item.id);
    card.append(profile);
  }
  const url = safeUrl(item.website);
  if (url?.startsWith("https://")) {
    card.append(button("◎ Abrir sitio", () => openBrowser(url), "link-button"));
    card.append(external(url, "↗ Sitio web original", "link-button"));
  }
  return card;
}
function renderData(data) {
  state.data = data;
  const allResults = data.results || [];
  const options = [...new Set(allResults.map(item => item.source).filter(Boolean))].sort();
  sourceFilter.replaceChildren(new Option("Todas las fuentes", ""));
  options.forEach(name => sourceFilter.add(new Option(name, name)));
  if (!options.includes(state.selectedSource)) state.selectedSource = "";
  sourceFilter.value = state.selectedSource;
  state.results = state.selectedSource ? allResults.filter(item => item.source === state.selectedSource) : allResults;
  resultsContainer.replaceChildren();
  weatherSlot.replaceChildren();
  const count = state.results.length;
  stats.textContent = count + " resultado" + (count === 1 ? "" : "s") + " visible" + (count === 1 ? "" : "s") +
    " de " + allResults.length + " recuperados · " +
    (data.failedSources?.length ? "Algunas fuentes no respondieron" : "Consulta completada");
  renderPanel(data);
  if (state.type === "all" || state.type === "research" || state.type === "index") {
    const filteredBrief = state.selectedSource ? {
      ...data, brief: { ...data.brief, notes: (data.brief?.notes || []).filter(note => note.source === state.selectedSource) }
    } : data;
    renderSummary(filteredBrief);
  }
  else answer.replaceChildren();
  if (state.type === "businesses") {
    state.results.forEach(item => resultsContainer.append(renderPublicBusiness(item)));
  } else if (state.type === "images") {
    const grid = renderImages(state.results);
    if (grid.children.length) resultsContainer.append(grid);
  } else {
    state.results.forEach((item, index) => {
      const card = renderResult(item, index);
      if (card) resultsContainer.append(card);
    });
  }
  if (!resultsContainer.children.length) {
    const detail = data.warning || data.message ||
      (state.type === "news" || state.type === "videos"
        ? "No hay resultados recuperados de los proveedores disponibles para esta consulta. Prueba otros términos."
        : "No hubo coincidencias de las fuentes disponibles. Modifica los términos e inténtalo nuevamente.");
    resultsContainer.append(renderSearchFallback(state.query,detail));
  }
}
function renderSearchFallback(query,message){
  const card=stateCard("Búsqueda pública temporalmente no disponible",message);
  const links=element("div","search-fallback-links");
  append(links,
    external("https://www.google.com/search?q="+encodeURIComponent(query),
      "↗ Buscar en Google","link-button"),
    external("https://es.wikipedia.org/w/index.php?search="+encodeURIComponent(query),
      "↗ Buscar en Wikipedia","link-button"),
    external("https://openlibrary.org/search?q="+encodeURIComponent(query),
      "↗ Buscar en Open Library","link-button"));
  card.append(element("p","research-disclaimer",
    "Enlaces externos para continuar tu investigación. No son resultados recuperados por WAEWEB."),links);
  return card;
}
async function renderWeather(query, signal, sequence) {
  if (!/^(clima|tiempo|temperatura|pron[oó]stico)\b/i.test(query)) return;
  try {
    const data = await getJSON("/api/weather?place=" + encodeURIComponent(query), signal);
    if (sequence !== state.sequence) return;
    const card = element("section", "weather-card");
    append(card, element("h2", "", "☀ " + data.place),
      element("p", "", "Observación: " + (data.observedAt || "Sin hora") + " · " + (data.timezone || "")),
      element("strong", "", data.temperature + " °C"),
      element("p", "", "Humedad: " + data.humidity + "% · Viento: " + data.wind + " km/h"));
    const forecast = element("div", "forecast");
    (data.days || []).forEach(day => forecast.append(element("span", "tag", day.date + " · " + day.min + "° / " + day.max + "°")));
    append(card, forecast, external(data.url, "Fuente: " + data.source, "link-button"));
    weatherSlot.append(card);
  } catch (e) {
    if (e.name !== "AbortError" && sequence === state.sequence) weatherSlot.append(stateCard("Clima no disponible", e.message));
  }
}
function showDirectionsWithoutLocality(){
  stopDirections();
  const map=createNativeMap();
  const stage=map.root;
  const note=element("p","map-description",
    "Vista general nativa de coordenadas. Busca un lugar para situar un punto en el visor.");
  const footnote=element("p","map-attribution",
    "Visor geográfico WAEWEB · activa «Calles» para cartografía real de OpenStreetMap · búsqueda precisa si hay proveedor configurado.");
  const directions=createDirections({getJSON,element,button,external,copyText,
    onDestinationSelect:place=>{
      if(!validMapPlace(place))return;
      map.setView(place,3);
    },
    onRoute:route=>map.setRoute(route.geometry)
  });
  activeDirections=directions;
  resultsContainer.append(note,stage,footnote,directions.root);
  resultsContainer.append(external("https://www.openstreetmap.org/#map=5/23.6/-102.5",
    "↗ Abrir mapa original","link-button"));
}
function renderMapPlaces(data) {
  stopDirections();
  const places = Array.isArray(data.results) ? data.results.filter(validMapPlace) : [];
  resultsContainer.replaceChildren();
  if (!places.length) {
    const card = stateCard("No se encontró el lugar",data.message ||
      "La geocodificación no encontró localidades con ese nombre. Prueba con una ciudad o coordenadas.");
    card.append(external("https://www.openstreetmap.org/search?query=" + encodeURIComponent(state.query),
      "↗ Ver más ubicaciones en el mapa original","link-button"));
    resultsContainer.append(card);
    stats.textContent = "Sin coincidencias geográficas · " + data.source;
    showDirectionsWithoutLocality();
    return;
  }

  const section = element("section","map-explorer");
  const heading = element("div","map-heading");
  const headText = element("div");
  append(headText,element("span","tag","WAEWEB · MAPAS"),
    element("h2","","Explorar " + data.query),
    element("p","map-description",data.precision === "coordinate"
      ? "Punto indicado por coordenadas. No equivale a una dirección postal verificada."
      : data.precision === "address_or_place"
        ? "Coincidencias de direcciones y lugares; selecciona el punto correcto antes de trazar una ruta."
        : "Localidades geocodificadas. El marcador representa un centro aproximado, no una dirección exacta."));
  const newSearch = button("⌕ Otra ubicación",()=>{resultsInput.focus();resultsInput.select();},"small-action");
  heading.append(headText,newSearch);
  section.append(heading);

  const placeTitle = element("h3","map-place-title");
  const placeDetail = element("p","map-place-detail");
  const coords = element("p","map-coordinates");
  const toolbar = element("div","map-toolbar");
  const zoomOut = button("− Alejar",()=>changeZoom(-1),"map-action");
  const zoomIn = button("+ Acercar",()=>changeZoom(1),"map-action");
  const copy = button("⧉ Copiar coordenadas",()=>copyText(
    (mapOverride||places[selected]).latitude.toFixed(6) + ", " +
    (mapOverride||places[selected]).longitude.toFixed(6)),"map-action");
  const visit = external("https://www.openstreetmap.org/","↗ Abrir mapa completo","map-action map-original");
  toolbar.append(zoomOut,zoomIn,copy,visit);

  const map=createNativeMap();
  const directions=createDirections({getJSON,element,button,external,copyText,
    onDestinationSelect:place=>{
      if(!validMapPlace(place))return;
      mapOverride=place;
      zoom=3;
      refresh();
    },
    onRoute:route=>map.setRoute(route.geometry)
  });
  activeDirections=directions;
  const stage = map.root;
  const footnote = element("p","map-attribution",
    "Visor WAEWEB · coordenadas de "+data.source+
    " · pulsa «Calles» para cartografía real © OpenStreetMap contributors; rutas solo desde un proveedor habilitado.");
  const picks = element("div","map-picks");
  picks.setAttribute("aria-label","Ubicaciones encontradas");
  let selected = 0, zoom = data.precision === "coordinate" ? 3 : 2;
  let mapOverride=null,shownPlace=null;
  const options = places.map((place,index)=>{
    const label = place.name + (place.detail ? " · " + place.detail : "");
    const choice = button(label,()=>select(index),"map-pick");
    choice.setAttribute("aria-pressed","false");
    picks.append(choice);
    return choice;
  });
  function refresh(){
    const place=mapOverride||places[selected];
    if(shownPlace!==place){map.setView(place,zoom);shownPlace=place;}
    placeTitle.textContent=place.name;
    placeDetail.textContent=place.detail || "Ubicación geográfica";
    coords.textContent="Lat. " + place.latitude.toFixed(6) + " · Lon. " + place.longitude.toFixed(6);
    visit.href=osmPlaceUrl(place);
    zoomIn.disabled=zoom>=4; zoomOut.disabled=zoom<=0;
    options.forEach((option,i)=>{
      option.classList.toggle("is-active",!mapOverride&&i===selected);
      option.setAttribute("aria-pressed",String(!mapOverride&&i===selected));
    });
    stats.textContent=places.length + (places.length===1 ? " ubicación" : " ubicaciones") +
      " · " + (mapOverride?"openrouteservice Pelias":data.source) + " · " + place.name;
  }
  function select(index){
    selected=index;zoom=places[index].precision==="coordinate"?3:2;
    directions.setDestination(places[index]);
    mapOverride=null;
    refresh();
  }
  function changeZoom(delta){
    zoom=Math.max(0,Math.min(4,zoom+delta));map.changeZoom(delta);refresh();
  }
  const details=element("div","map-place");
  details.append(placeTitle,placeDetail,coords,toolbar);
  section.append(details,stage,footnote,directions.root);
  if(places.length>1)section.append(element("h3","map-picks-title","Elegir ubicación"),picks);
  resultsContainer.append(section);
  directions.setDestination(places[selected]);
  mapOverride=null;
  refresh();
}
async function renderMap(query,signal,sequence) {
  // Coordinates supplied by the user can render without /api/maps. A deployment
  // 401 must never hide an independently known point or invent a street address.
  const point=localMapCoordinates(query);
  if(point){
    stopDirections();
    panel.replaceChildren();answer.replaceChildren();weatherSlot.replaceChildren();
    state.data=null;state.results=[];state.selectedSource="";
    renderMapPlaces({
      query,source:"Coordenadas en tu dispositivo",precision:"coordinate",
      results:[{id:"local-coordinates",name:"Punto indicado por coordenadas",
        detail:"Coordenadas introducidas por el usuario · sin dirección verificada",
        ...point,precision:"coordinate"}]
    });
    return;
  }
  stopDirections();
  stats.textContent="Localizando lugares reales…";
  panel.replaceChildren();answer.replaceChildren();weatherSlot.replaceChildren();
  state.data=null;state.results=[];state.selectedSource="";
  sourceFilter.replaceChildren(new Option("Todas las fuentes",""));
  resultsContainer.replaceChildren(stateCard("Buscando en el mapa",
    "Localizando ciudades y coordenadas. No se generan ubicaciones ficticias.",true));
  try {
    const [addressResponse,localityResponse]=await Promise.allSettled([
      getJSON("/api/places?q="+encodeURIComponent(query),signal),
      getJSON("/api/maps?q="+encodeURIComponent(query),signal)
    ]);
    if(sequence!==state.sequence)return;
    if(addressResponse.status==="fulfilled" && addressResponse.value.results?.length){
      renderMapPlaces({...addressResponse.value,precision:"address_or_place"});
    }else if(localityResponse.status==="fulfilled"){
      renderMapPlaces(localityResponse.value);
    }else if(addressResponse.status==="fulfilled"){
      renderMapPlaces({...addressResponse.value,precision:"address_or_place"});
    }else throw localityResponse.reason || addressResponse.reason;
  } catch(error) {
    if(error.name==="AbortError"||sequence!==state.sequence)return;
    stats.textContent="Mapa no disponible";
    const card=stateCard("No se pudo mostrar el mapa",error.message);
    card.append(external("https://www.openstreetmap.org/search?query="+encodeURIComponent(query),
      "↗ Abrir búsqueda en el mapa original","link-button"));
    card.append(external("/diagnostico.html",
      "⌕ Diagnosticar HTTP 401 y conexión de los módulos","link-button"));
    resultsContainer.replaceChildren(card);
    showDirectionsWithoutLocality();
  }
}
// The SAME search bars accept either a query or an explicit HTTPS address.
function runOmnibox(value,type="all",push=true){
  const intent=classifyOmnibox(value);
  if(intent.kind==="empty"){
    heroStatus.textContent="Escribe una búsqueda o dirección HTTPS.";
    stats.textContent=heroStatus.textContent;
    return;
  }
  if(intent.kind==="invalid"){
    heroStatus.textContent="La dirección o búsqueda es demasiado larga.";
    stats.textContent=heroStatus.textContent;
    return;
  }
  if(intent.kind==="url"){
    translator.hide();sourceFilter.hidden=false;
    state.type="all";stopDirections();
    state.controller?.abort();state.sequence++;
    heroStatus.textContent="";
    speechSynthesisSafeCancel();
    if(hero.hidden===false){
      stats.textContent="Vista web integrada · Introduce una consulta para encontrar fuentes.";
      panel.replaceChildren();answer.replaceChildren();weatherSlot.replaceChildren();
      resultsContainer.replaceChildren();
    }
    resultsInput.value=intent.value;
    return openBrowser(intent.value);
  }
  return performSearch(intent.value,type,push);
}
function showEmptyCategory(type,push=true){
  stopDirections();translator.hide();hideBrowser();
  state.controller?.abort();state.sequence++;
  state.type=type;state.query="";state.results=[];state.data=null;state.selectedSource="";
  hero.hidden=true;resultsView.hidden=false;setTab(type);
  heroInput.value="";resultsInput.value="";
  sourceFilter.hidden=false;
  sourceFilter.replaceChildren(new Option("Todas las fuentes",""));
  panel.replaceChildren();answer.replaceChildren();weatherSlot.replaceChildren();
  const categories={
    all:["Búsqueda WAEWEB","Consulta fuentes académicas, imágenes y bibliotecas.",["Inteligencia artificial","Tecnología en México"]],
    research:["Investigación","Publicaciones científicas, Wikidata y fuentes bibliográficas.",["Inteligencia artificial","Investigación médica"]],
    images:["Imágenes","Fotografías y archivos multimedia con origen identificable.",["Jalisco","Arquitectura mexicana"]],
    news:["Noticias","Artículos recientes de medios disponibles, con enlaces originales.",["Inteligencia artificial","México"]],
    videos:["Videos","Archivos audiovisuales disponibles de fuentes verificables.",["Tecnología","Naturaleza"]],
    books:["Libros","Explora fichas bibliográficas y autores.",["Ciencia","Historia de México"]],
    index:["Índice privado","Conecta una bóveda autorizada para consultar documentos.",[]],
    businesses:["Negocios","Busca empresas publicadas voluntariamente.",[]]
  };
  const [title,description,examples]=categories[type]||categories.all;
  stats.textContent=title+" · Introduce una búsqueda";
  const card=stateCard(title,description);
  const actions=element("div","search-fallback-links");
  for(const example of examples){
    actions.append(button("⌕ "+example,()=>performSearch(example,type),"link-button"));
  }
  card.append(actions);
  resultsContainer.replaceChildren(card);
  if(push)history.pushState({type},"",location.pathname+"?type="+encodeURIComponent(type));
}
async function performSearch(query, type = "all", push = true) {
  stopDirections();
  translator.hide();sourceFilter.hidden=false;
  if(type==="translate"){renderTranslator(push);return;}
  hideBrowser();
  const q = query.trim().slice(0, 180);
  if (q.length < 2) {
    if (type === "maps") {
      state.controller?.abort(); state.sequence++;
      state.type = "maps"; state.query = "";
      hero.hidden = true; resultsView.hidden = false; setTab("maps");
      answer.replaceChildren(); weatherSlot.replaceChildren(); panel.replaceChildren();
      state.data=null;state.results=[];state.selectedSource="";
      sourceFilter.replaceChildren(new Option("Todas las fuentes",""));
      resultsContainer.replaceChildren(stateCard("Explorar mapas",
        "Busca una localidad en WAEWEB o usa «Buscar origen / destino» para elegir direcciones y lugares precisos. También puedes escribir coordenadas."));
      showDirectionsWithoutLocality();
      stats.textContent = "Mapas · Escribe un lugar para comenzar.";
      resultsInput.focus();
    } else {
      if(!hero.hidden){
        const message = "Escribe al menos dos caracteres para buscar.";
        heroStatus.textContent = message;stats.textContent = message;heroInput.focus();
      }else showEmptyCategory(type,push);
    }
    return;
  }
  state.controller?.abort();
  heroStatus.textContent = "";
  speechSynthesisSafeCancel();
  state.controller = new AbortController();
  const signal = state.controller.signal;
  const sequence = ++state.sequence;
  state.query = q; state.type = type;
  state.selectedSource = "";
  hero.hidden = true; resultsView.hidden = false;
  heroInput.value = q; resultsInput.value = q; setTab(type);
  if (push) updateAddress(q, type);
  if (type === "maps") { await renderMap(q,signal,sequence); return; }
  if (type === "index" && !readerEnabled) {
    stats.textContent="Índice privado desactivado en esta vista.";
    panel.replaceChildren();answer.replaceChildren();weatherSlot.replaceChildren();
    resultsContainer.replaceChildren(stateCard("Índice privado no disponible",
      "La búsqueda pública no necesita bóveda. Vuelve a Todo o Investigación para consultar fuentes abiertas."));
    return;
  }
  if (type === "businesses" && !businessSearchEnabled) {
    stats.textContent="Registro de negocios desactivado en esta vista.";
    panel.replaceChildren();answer.replaceChildren();weatherSlot.replaceChildren();
    resultsContainer.replaceChildren(stateCard("Negocios aún no disponibles",
      "El Marketplace de pruebas no contiene empresas reales. Consulta las fuentes públicas desde Todo."));
    return;
  }
  stats.textContent = "Consultando fuentes reales…";
  panel.replaceChildren(); answer.replaceChildren(); weatherSlot.replaceChildren();
  resultsContainer.replaceChildren(stateCard("Buscando información", "Conectando con las fuentes disponibles.", true));
  // Weather is an independent public API; a search provider failure must not
  // suppress the weather card or misreport it as an invalid vault credential.
  if (type === "all") void renderWeather(q,signal,sequence);
  try {
    const url = type === "index"
      ? "/api/index/search?q=" + encodeURIComponent(q)
      : type === "businesses"
        ? "/api/businesses/public?q=" + encodeURIComponent(q)
        : "/api/search?q=" + encodeURIComponent(q) + "&type=" + encodeURIComponent(type);
    if (type === "index" && !vaultToken) {
      resultsContainer.replaceChildren(stateCard("Índice privado", "Conecta tu bóveda para buscar documentos autorizados."));
      openVaultDialog();
      return;
    }
    let data = await getJSON(url, signal);
    if (type === "businesses") {
      data = {
        type: "businesses", query: q, originalQuery: q,
        results: (data.businesses || []).map(item => ({ ...item, source: "WAE WEB · Autodeclarado" })),
        sources: ["Registro voluntario WAE WEB"], failedSources: [], fetchedAt: new Date().toISOString(),
        message: (data.businesses?.length ? data.disclaimer
          : "No se encontraron negocios publicados con esos términos. Las fichas privadas no aparecen en esta búsqueda.")
      };
    }
    if (type === "index") {
      data.sources = ["Índice WAE · bóveda autenticada"];
      data.failedSources = [];
      data.fetchedAt = new Date().toISOString();
    }
    if (sequence !== state.sequence) return;
    renderData(data);
  } catch (e) {
    if (e.name === "AbortError" || sequence !== state.sequence) return;
    stats.textContent = "No se pudo completar la consulta.";
    resultsContainer.replaceChildren(type==="index"||type==="businesses"
      ?stateCard("Consulta no disponible",e.message)
      :renderSearchFallback(q,e.message));
  }
}
function showReadDocument(data) {
  readerOutput.replaceChildren();
  const card = element("article", "reader-document");
  append(card, element("h3", "", data.title),
    element("p", "reader-note", "Fuente recuperada: " + data.url),
    element("p", "reader-note", "Huella SHA-256: " + data.fingerprint + " · Índice: " + data.indexSize + " documento(s) · bóveda persistente"));
  const excerpt = element("p", "reader-content", data.text);
  card.append(excerpt);
  const actions = element("div", "answer-actions");
  append(actions,
    external(data.url, "↗ Página original", "link-button"),
    button("⧉ Copiar texto recuperado", () => copyText(data.text)),
    button("◇ Guardar referencia", () => {
      const saved = workspace.add({ title: data.title, url: data.url, source: "Índice WAE", snippet: data.text.slice(0, 1200) });
      refreshLibraryCount();
      readerStatus.textContent = saved.persisted === false ? "Referencia temporal: el almacenamiento local está bloqueado." : "Referencia guardada en biblioteca.";
    }),
    button("⌕ Buscar en mi índice", () => performSearch(state.query || data.title, "index")));
  card.append(actions);
  readerOutput.append(card);
}
async function requestRead(url) {
  if (readerBusy) { readerStatus.textContent = "Hay una lectura en curso."; return; }
  if (!readerEnabled) { readerPanel.hidden = false; readerStatus.textContent = "Activa el lector y configura bóvedas en el servidor local."; return; }
  if (!vaultToken) { readerStatus.textContent = "Conecta tu bóveda primero."; openVaultDialog(); return; }
  readerBusy = true;
  readerPanel.hidden = false;
  readerPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  readerStatus.textContent = "Validando DNS y robots.txt, recuperando texto público…";
  readerOutput.replaceChildren();
  try {
    const data = await getJSON("/api/read", undefined, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ url })
    });
    showReadDocument(data);
    readerStatus.textContent = "Documento guardado en la bóveda autorizada.";
  } catch (error) {
    readerStatus.textContent = error.message || "No se pudo leer la página.";
  } finally { readerBusy = false; }
}
byId("reader-form").addEventListener("submit", event => {
  event.preventDefault();
  const url = byId("reader-url").value.trim();
  if (!url.startsWith("https://")) { readerStatus.textContent = "Solo se admiten páginas públicas HTTPS."; return; }
  requestRead(url);
});
async function loadReaderCapability() {
  try {
    const info = await getJSON("/api/capabilities");
     readerEnabled = info.readerEnabled === true;
    businessSearchEnabled = info.publicBusinessProfiles === true;
    for(const [type,available] of [["index",readerEnabled],["businesses",businessSearchEnabled]]){
      const tab=document.querySelector('[data-type="'+type+'"]');
      if(tab){tab.hidden=!available;tab.disabled=!available;}
    }
    readerPanel.hidden = !readerEnabled;
    if (readerEnabled) updateVaultUI();
  } catch {
    readerEnabled = false;
    readerPanel.hidden = true;
  }
}
loadReaderCapability();
document.addEventListener("wae:browser:read", event => requestRead(event.detail.url));
byId("hero-form").addEventListener("submit", event => { event.preventDefault(); runOmnibox(heroInput.value); });
byId("results-form").addEventListener("submit", event => { event.preventDefault(); runOmnibox(resultsInput.value, state.type==="translate"?"all":state.type); });
byId("home-button").addEventListener("click", goHome);
document.querySelectorAll("[data-query]").forEach(chip => chip.addEventListener("click", () => runOmnibox(chip.dataset.query)));
document.querySelectorAll("[data-type]").forEach(tab => tab.addEventListener("click", () => tab.dataset.type==="translate" ? renderTranslator() : performSearch(state.query || resultsInput.value, tab.dataset.type)));
byId("copy-search").addEventListener("click", () => copyText(location.href));
sourceFilter.addEventListener("change", () => {
  state.selectedSource = sourceFilter.value;
  if (state.data) renderData(state.data);
});
byId("library-button").addEventListener("click", () => { drawLibrary(); byId("library-dialog").showModal(); });
byId("close-library").addEventListener("click", () => byId("library-dialog").close());
byId("export-library").addEventListener("click", downloadLibrary);
refreshLibraryCount();
byId("about-button").addEventListener("click", () => byId("about-dialog").showModal());
byId("close-dialog").addEventListener("click", () => byId("about-dialog").close());
byId("voice-button").addEventListener("click", () => {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!Recognition) { heroStatus.textContent = "El reconocimiento de voz no está disponible en este navegador."; stats.textContent = heroStatus.textContent; return; }
  const recognition = new Recognition();
  recognition.lang = "es-MX"; recognition.interimResults = false;
  recognition.onresult = event => runOmnibox(event.results[0][0].transcript);
  recognition.onerror = () => { heroStatus.textContent = "No se pudo reconocer la voz; usa el campo de búsqueda."; stats.textContent = heroStatus.textContent; };
  recognition.start();
});
window.addEventListener("popstate", () => {
  hideBrowser();
  const params = new URLSearchParams(location.search);
  const q = params.get("q");
  if (q) runOmnibox(q, params.get("type") || "all", false);
  else if(params.get("type")==="translate")renderTranslator(false);
  else { stopDirections();translator.hide();state.controller?.abort(); state.sequence++; hero.hidden = false; resultsView.hidden = true; }
});
const params = new URLSearchParams(location.search);
if (params.get("q")) runOmnibox(params.get("q"), params.get("type") || "all", false);
else if(params.get("type")==="translate")renderTranslator(false);
