import { createBrowserState, normalizeBrowserUrl } from "/browser-core.js";

const $ = id => document.getElementById(id);
const state = createBrowserState();
const frames = new Map();
const view = $("browser-view");
const stage = $("browser-stage");
const address = $("browser-address");
const tabs = $("browser-tabs");
const status = $("browser-status");
const external = $("browser-external");
const back = $("browser-back");
const forward = $("browser-forward");
const reload = $("browser-reload");
const reader = $("browser-reader");
const empty = $("browser-empty");
let lastView = "hero";

function showView() {
  for (const id of ["hero", "results-view", "account-view", "business-profile-view"]) {
    if (!$(id).hidden) lastView = id;
    $(id).hidden = true;
  }
  view.hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
export function hideBrowser() { view.hidden = true; }
function leaveBrowser() {
  hideBrowser();
  const destination = $(lastView) || $("hero");
  destination.hidden = false;
  if (lastView === "results-view") $("results-input").focus();
  else $("hero-input").focus();
}
function displayError(error) {
  status.textContent = error?.message || "La dirección no se pudo abrir.";
  address.setAttribute("aria-invalid", "true");
  address.focus();
}
function makeFrame(tab) {
  const frame = document.createElement("iframe");
  frame.className = "browser-frame";
  frame.title = "Página web: " + tab.title;
  frame.setAttribute("sandbox", "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox");
  frame.referrerPolicy = "no-referrer";
  frame.loading = "eager";
  frame.hidden = true;
  frame.addEventListener("load", () => {
    if (state.active()?.id === tab.id && !view.hidden)
      status.textContent = "Carga terminada o bloqueada por el sitio. WAE WEB no puede inspeccionar páginas de otros dominios.";
  });
  stage.append(frame);
  frames.set(tab.id, frame);
  return frame;
}
function render() {
  const current = state.active();
  tabs.replaceChildren();
  for (const tab of state.tabs()) {
    const item = document.createElement("div");
    item.className = "browser-tab" + (current?.id === tab.id ? " active" : "");
    const select = document.createElement("button");
    select.type = "button";
    select.className = "browser-tab-select";
    select.textContent = tab.title;
    select.title = tab.url || "Nueva pestaña";
    select.setAttribute("aria-label", "Ir a la pestaña " + tab.title);
    select.setAttribute("aria-pressed", String(current?.id === tab.id));
    select.addEventListener("click", () => { state.select(tab.id); render(); });
    const close = document.createElement("button");
    close.type = "button"; close.className = "browser-tab-close";
    close.textContent = "×"; close.title = "Cerrar pestaña";
    close.setAttribute("aria-label", "Cerrar " + tab.title);
    close.addEventListener("click", () => {
      frames.get(tab.id)?.remove();
      frames.delete(tab.id);
      const next = state.close(tab.id);
      if (!next) leaveBrowser();
      else render();
    });
    item.append(select, close);
    tabs.append(item);
  }
  for (const [id, frame] of frames) frame.hidden = !current || current.id !== id;
  address.value = current?.url || "";
  address.removeAttribute("aria-invalid");
  back.disabled = !current?.canBack;
  forward.disabled = !current?.canForward;
  reload.disabled = !current?.url;
  reader.disabled = !current?.url;
  external.hidden = !current?.url;
  if (current?.url) external.href = current.url;
  else external.removeAttribute("href");
  empty.hidden = Boolean(current?.url);
  $("browser-new").disabled = state.tabs().length >= 8;
}
function loadCurrent() {
  const tab = state.active();
  if (!tab?.url) { render(); return; }
  const frame = frames.get(tab.id) || makeFrame(tab);
  // Explicit address changes only: cross-origin navigations inside an iframe
  // cannot be observed or rewritten into the app's address/history.
  frame.src = tab.url;
  frame.title = "Página web: " + tab.title;
  render();
  status.textContent = "Intentando mostrar " + new URL(tab.url).hostname +
    ". Si está en blanco o falla, el sitio puede prohibir su incrustación. Usa «Abrir fuera».";
}
export function openBrowser(value = "", { newTab = false } = {}) {
  showView();
  let url = null;
  if (value) {
    try { url = normalizeBrowserUrl(value, location.origin); }
    catch (error) { render(); displayError(error); return false; }
  }
  try {
    if (newTab || !state.active()) state.create(url);
    else if (url) state.navigate(url);
  } catch (error) { render(); displayError(error); return false; }
  if (url) state.rename(state.active().id, new URL(url).hostname);
  if (url) loadCurrent();
  else { render(); status.textContent = "Escribe un dominio o pega una URL HTTPS para navegar dentro de WAE WEB."; address.focus(); }
  return true;
}
$("browser-form").addEventListener("submit", event => {
  event.preventDefault();
  const value = address.value;
  if (!value.trim()) { displayError(new TypeError("Introduce una dirección HTTPS.")); return; }
  openBrowser(value);
});
$("browser-back").addEventListener("click", () => {
  if (!state.active()?.canBack) return;
  state.back(); loadCurrent();
});
$("browser-forward").addEventListener("click", () => {
  if (!state.active()?.canForward) return;
  state.forward(); loadCurrent();
});
$("browser-reload").addEventListener("click", () => { if (state.active()?.url) loadCurrent(); });
$("browser-new").addEventListener("click", () => openBrowser("", { newTab: true }));
$("browser-close").addEventListener("click", leaveBrowser);
$("browser-open").addEventListener("click", () => openBrowser());
$("hero-browser").addEventListener("click", () => openBrowser($("hero-input").value.trim().startsWith("https://") ? $("hero-input").value.trim() : ""));
$("browser-reader").addEventListener("click", () => {
  const tab = state.active();
  if (!tab?.url) return;
  hideBrowser();
  $("hero").hidden = true;
  $("results-view").hidden = false;
  document.dispatchEvent(new CustomEvent("wae:browser:read", { detail: { url: tab.url } }));
});
document.addEventListener("wae:browser:open", event => openBrowser(event.detail?.url || ""));
document.addEventListener("wae:browser:hide", hideBrowser);
for (const id of ["account-button", "hero-account-button", "home-button", "account-back"]) {
  $(id)?.addEventListener("click", hideBrowser);
}
document.addEventListener("keydown", event => {
  if (view.hidden || event.altKey || event.shiftKey) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "l") {
    event.preventDefault(); address.focus(); address.select();
  } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "t") {
    event.preventDefault(); openBrowser("", { newTab: true });
  }
});
