import { createWorkspace, asMarkdown } from "/workspace.js";
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
let readerBusy = false;
const heroStatus = byId("hero-status");
const panel = byId("knowledge-panel");
const answer = byId("answer-slot");
const weatherSlot = byId("weather-slot");
let state = { query: "", type: "all", results: [], data: null, selectedSource: "", controller: null, sequence: 0, summary: "" };

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
async function getJSON(path, signal) {
  const response = await fetch(path, { signal, headers: { accept: "application/json" } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "El servicio no respondió.");
  return data;
}
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
  const title = external(url, item.title, "result-title");
  if (item.source === "Open Library" && safeUrl(item.image)) {
    const cover = element("img", "book-cover");
    cover.src = safeUrl(item.image);
    cover.alt = "Portada de " + item.title;
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
      stats.textContent = outcome.persisted === false ? "Fuente guardada temporalmente; almacenamiento local bloqueado." : "Fuente guardada en la biblioteca local.";
      refreshLibraryCount();
    } else stats.textContent = outcome.reason;
  }, "save-button");
  save.disabled = workspace.has(url);
  meta.append(save);
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
  card.append(element("p", "", "Resultados devueltos por proveedores externos; WAE WEB no asigna una cifra global ficticia."));
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
  if (state.type === "images") {
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
        ? "Esta categoría necesita GOOGLE_SEARCH_API_KEY y GOOGLE_SEARCH_ENGINE_ID configurados en el servidor. No se mostrarán resultados ficticios."
        : "No hubo coincidencias de las fuentes disponibles. Modifica los términos e inténtalo nuevamente.");
    resultsContainer.append(stateCard("Sin resultados disponibles", detail));
  }
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
function renderMap(query) {
  state.controller?.abort();
  state.query = query; state.type = "maps";
  hero.hidden = true; resultsView.hidden = false;
  heroInput.value = query; resultsInput.value = query;
  setTab("maps");
  answer.replaceChildren(); weatherSlot.replaceChildren(); panel.replaceChildren(); resultsContainer.replaceChildren();
  stats.textContent = "Cartografía externa · OpenStreetMap";
  const map = element("section", "state-card");
  append(map, element("h2", "", "Explorar mapa"),
    element("p", "", "Abrir la consulta geográfica en OpenStreetMap. WAE WEB no simula coordenadas ni ubicaciones."));
  map.append(external("https://www.openstreetmap.org/search?query=" + encodeURIComponent(query), "↗ Ver mapa real", "link-button"));
  resultsContainer.append(map);
}
async function performSearch(query, type = "all", push = true) {
  const q = query.trim().slice(0, 180);
  if (q.length < 2) { heroInput.focus(); heroStatus.textContent = "Escribe al menos dos caracteres."; stats.textContent = heroStatus.textContent; return; }
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
  if (type === "maps") { renderMap(q); return; }
  stats.textContent = "Consultando fuentes reales…";
  panel.replaceChildren(); answer.replaceChildren(); weatherSlot.replaceChildren();
  resultsContainer.replaceChildren(stateCard("Buscando información", "Conectando con las fuentes disponibles.", true));
  try {
    const url = type === "index"
      ? "/api/index/search?q=" + encodeURIComponent(q)
      : "/api/search?q=" + encodeURIComponent(q) + "&type=" + encodeURIComponent(type);
    const data = await getJSON(url, signal);
    if (type === "index") {
      data.sources = ["Índice WAE · memoria temporal"];
      data.failedSources = [];
      data.fetchedAt = new Date().toISOString();
    }
    if (sequence !== state.sequence) return;
    renderData(data);
    if (type === "all") renderWeather(q, signal, sequence);
  } catch (e) {
    if (e.name === "AbortError" || sequence !== state.sequence) return;
    stats.textContent = "No se pudo completar la consulta.";
    resultsContainer.replaceChildren(stateCard("Error de búsqueda", e.message));
  }
}
function showReadDocument(data) {
  readerOutput.replaceChildren();
  const card = element("article", "reader-document");
  append(card, element("h3", "", data.title),
    element("p", "reader-note", "Fuente recuperada: " + data.url),
    element("p", "reader-note", "Huella SHA-256: " + data.fingerprint + " · Índice: " + data.indexSize + " documento(s) · temporal"));
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
  if (!readerEnabled) { readerStatus.textContent = "Activa WAE_READER_ENABLED=true en el servidor local para utilizar el lector."; return; }
  readerBusy = true;
  readerPanel.hidden = false;
  readerPanel.scrollIntoView({ behavior: "smooth", block: "start" });
  readerStatus.textContent = "Validando DNS y robots.txt, recuperando texto público…";
  readerOutput.replaceChildren();
  try {
    const data = await getJSON("/api/read?url=" + encodeURIComponent(url));
    showReadDocument(data);
    readerStatus.textContent = "Documento incorporado al índice temporal.";
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
    readerPanel.hidden = !readerEnabled;
    if (readerEnabled) readerStatus.textContent = "Lector seguro habilitado. El índice se pierde al reiniciar el servidor.";
  } catch {
    readerEnabled = false;
    readerPanel.hidden = true;
  }
}
loadReaderCapability();
byId("hero-form").addEventListener("submit", event => { event.preventDefault(); performSearch(heroInput.value); });
byId("results-form").addEventListener("submit", event => { event.preventDefault(); performSearch(resultsInput.value, state.type); });
byId("home-button").addEventListener("click", goHome);
document.querySelectorAll("[data-query]").forEach(chip => chip.addEventListener("click", () => performSearch(chip.dataset.query)));
document.querySelectorAll("[data-type]").forEach(tab => tab.addEventListener("click", () => performSearch(state.query || resultsInput.value, tab.dataset.type)));
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
  recognition.onresult = event => performSearch(event.results[0][0].transcript);
  recognition.onerror = () => { heroStatus.textContent = "No se pudo reconocer la voz; usa el campo de búsqueda."; stats.textContent = heroStatus.textContent; };
  recognition.start();
});
window.addEventListener("popstate", () => {
  const params = new URLSearchParams(location.search);
  const q = params.get("q");
  if (q) performSearch(q, params.get("type") || "all", false);
  else { state.controller?.abort(); state.sequence++; hero.hidden = false; resultsView.hidden = true; }
});
const params = new URLSearchParams(location.search);
if (params.get("q")) performSearch(params.get("q"), params.get("type") || "all", false);
