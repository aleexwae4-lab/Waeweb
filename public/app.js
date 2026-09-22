"use strict";
const byId = id => document.getElementById(id);
const hero = byId("hero");
const resultsView = byId("results-view");
const heroInput = byId("hero-input");
const resultsInput = byId("results-input");
const resultsContainer = byId("results-container");
const stats = byId("result-stats");
const heroStatus = byId("hero-status");
const panel = byId("knowledge-panel");
const answer = byId("answer-slot");
const weatherSlot = byId("weather-slot");
let state = { query: "", type: "all", results: [], controller: null, sequence: 0, summary: "" };

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
  append(card, row, title);
  if (item.snippet) card.append(element("p", "snippet", item.snippet));
  const meta = element("div", "meta-line");
  if (item.date) meta.append(element("span", "tag", formatDate(item.date)));
  meta.append(element("span", "", "↗ Consultar documento original"));
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
function renderSummary(data) {
  answer.replaceChildren();
  const item = data.results.find(r => r.source === "Wikipedia" && r.snippet) || data.results.find(r => r.snippet);
  if (!item) return;
  const url = safeUrl(item.url);
  if (!url) return;
  state.summary = item.snippet;
  const card = element("section", "answer-card");
  append(card, element("p", "eyebrow", "Fragmento de fuente · No generado por IA"),
    element("h2", "", "Vista rápida documental"),
    element("blockquote", "", item.snippet));
  const actions = element("div", "answer-actions");
  append(actions, external(url, "↗ " + item.source),
    button("⧉ Copiar", () => copyText(item.snippet)),
    button("◖ Escuchar / detener", () => readAloud(item.snippet)));
  card.append(actions); answer.append(card);
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
  if (data.fetchedAt) card.append(element("p", "legend", "Consulta: " + formatDate(data.fetchedAt)));
  card.append(element("p", "legend", "Contrasta los resultados con sus fuentes originales. Los extractos no sustituyen una verificación independiente."));
  panel.append(card);
}
function renderData(data) {
  state.results = data.results || [];
  resultsContainer.replaceChildren();
  weatherSlot.replaceChildren();
  const count = state.results.length;
  stats.textContent = count + " resultado" + (count === 1 ? "" : "s") + " recuperado" + (count === 1 ? "" : "s") +
    " · " + (data.failedSources?.length ? "Algunas fuentes no respondieron" : "Consulta completada");
  renderPanel(data);
  if (state.type === "all") renderSummary(data);
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
    const detail = data.message ||
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
  hero.hidden = true; resultsView.hidden = false;
  heroInput.value = q; resultsInput.value = q; setTab(type);
  if (push) updateAddress(q, type);
  if (type === "maps") { renderMap(q); return; }
  stats.textContent = "Consultando fuentes reales…";
  panel.replaceChildren(); answer.replaceChildren(); weatherSlot.replaceChildren();
  resultsContainer.replaceChildren(stateCard("Buscando información", "Conectando con las fuentes disponibles.", true));
  try {
    const data = await getJSON("/api/search?q=" + encodeURIComponent(q) + "&type=" + encodeURIComponent(type), signal);
    if (sequence !== state.sequence) return;
    renderData(data);
    if (type === "all") renderWeather(q, signal, sequence);
  } catch (e) {
    if (e.name === "AbortError" || sequence !== state.sequence) return;
    stats.textContent = "No se pudo completar la consulta.";
    resultsContainer.replaceChildren(stateCard("Error de búsqueda", e.message));
  }
}
byId("hero-form").addEventListener("submit", event => { event.preventDefault(); performSearch(heroInput.value); });
byId("results-form").addEventListener("submit", event => { event.preventDefault(); performSearch(resultsInput.value, state.type); });
byId("home-button").addEventListener("click", goHome);
document.querySelectorAll("[data-query]").forEach(chip => chip.addEventListener("click", () => performSearch(chip.dataset.query)));
document.querySelectorAll("[data-type]").forEach(tab => tab.addEventListener("click", () => performSearch(state.query || resultsInput.value, tab.dataset.type)));
byId("copy-search").addEventListener("click", () => copyText(location.href));
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
