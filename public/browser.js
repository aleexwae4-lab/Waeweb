import { createBrowserState, normalizeBrowserUrl, browserInputTarget, browserPresentation } from "/browser-core.js";

const $ = id => document.getElementById(id);
const state = createBrowserState();
const native = window.waeDesktop?.isNative === true ? window.waeDesktop : null;
let nativeState = null;
function syncNativeBounds() {
  if (!native || view.hidden) return;
  const box = stage.getBoundingClientRect();
  void native.setBounds({ x: box.left, y: box.top, width: box.width, height: box.height }).catch(displayError);
}
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
const gate=$("browser-frame-gate");
const access=$("browser-access");
const accessLabel=$("browser-access-label");
const accessLink=$("browser-access-link");
const attempt=$("browser-attempt");
const previewOptIn=new Set();
let lastView = "hero";

// The web pane is CHILD of search results, not another page or product.
function showView() {
  if (!view.hidden) return;
  lastView = $("results-view").hidden ? "hero" : "results-view";
  for (const id of ["hero", "account-view", "business-profile-view","marketplace-view"])
    $(id).hidden = true;
  $("results-view").hidden = false;
  view.hidden = false;
  if (native) void native.setVisible(true).then(syncNativeBounds).catch(displayError);
}
export function hideBrowser() {
  view.hidden = true;
  if (native) void native.setVisible(false).catch(displayError);
}
function leaveBrowser() {
  hideBrowser();
  // URL-only entry from the hero returns to the hero. A result link returns
  // to its existing results; a browser close never throws away search cards.
  if (lastView === "hero") {
    $("results-view").hidden = true;
    $("hero").hidden = false;
    $("hero-input").focus();
  } else $("results-input").focus();
}
function searchFromBrowser(query) {
  hideBrowser();
  const input = $("results-input");
  input.value = query;
  input.focus();
  input.form?.requestSubmit();
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
      status.textContent = "Vista cargada o rechazada por el sitio. Si está en blanco, usa «Abrir sitio original»: muchas páginas prohíben incrustación.";
  });
  stage.append(frame);
  frames.set(tab.id, frame);
  return frame;
}
function render() {
  const current = native ? nativeState?.tabs.find(tab => tab.id === nativeState.activeId) : state.active();
  const tabItems = native ? (nativeState?.tabs || []) : state.tabs();
  tabs.replaceChildren();
  for (const tab of tabItems) {
    const item = document.createElement("div");
    item.className = "browser-tab" + (current?.id === tab.id ? " active" : "");
    const select = document.createElement("button");
    select.type = "button";
    select.className = "browser-tab-select";
    select.textContent = tab.title;
    select.title = tab.url || "Nueva pestaña";
    select.setAttribute("aria-label", "Ir a la pestaña " + tab.title);
    select.setAttribute("aria-pressed", String(current?.id === tab.id));
    select.addEventListener("click", () => {
      if (native) void native.select(tab.id).then(value => { nativeState = value; render(); syncNativeBounds(); }).catch(displayError);
      else { state.select(tab.id); render(); }
    });
    const close = document.createElement("button");
    close.type = "button"; close.className = "browser-tab-close";
    close.textContent = "×"; close.title = "Cerrar pestaña";
    close.setAttribute("aria-label", "Cerrar " + tab.title);
    close.addEventListener("click", () => {
      if (native) {
        void native.close(tab.id).then(value => {
          nativeState = value;
          if (!value.tabs.length) leaveBrowser();
          else { render(); syncNativeBounds(); }
        }).catch(displayError);
        return;
      }
      frames.get(tab.id)?.remove();
      frames.delete(tab.id);
      previewOptIn.delete(tab.id);
      const next = state.close(tab.id);
      if (!next) leaveBrowser();
      else render();
    });
    item.append(select, close);
    tabs.append(item);
  }
  const planned=current?.url?browserPresentation(current.url):null;
  const blocked=Boolean(!native && current?.url && planned.externalFirst &&
    !previewOptIn.has(current.id));
  // In hosted web mode, do not present a large empty iframe for known restricted sites.
  view.classList.toggle("is-external-first", blocked);
  if (!native) for (const [id, frame] of frames)
    frame.hidden = !current || current.id !== id || blocked;
  access.hidden=!current?.url;
  if(current?.url){
    accessLink.href=current.url;
    accessLabel.textContent=blocked
      ?"Este sitio puede impedir la vista integrada. Abre la página original."
      :"Si la página no aparece aquí, puedes abrir el sitio original.";
  }else accessLink.removeAttribute("href");
  attempt.hidden=!blocked;
  gate.hidden=!blocked;

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
  stage.classList.toggle("is-empty",!current?.url || blocked);
  $("browser-new").disabled = tabItems.length >= 8;
}
function loadCurrent() {
  if (native) return;
  const tab = state.active();
  if (!tab?.url) { render(); return; }
  const plan=browserPresentation(tab.url);
  if(plan.externalFirst && !previewOptIn.has(tab.id)){
    render();
    status.textContent="Abre el sitio original o intenta la vista integrada.";
    return;
  }
  const frame = frames.get(tab.id) || makeFrame(tab);
  // Explicit address changes only: cross-origin navigations inside an iframe
  // cannot be observed or rewritten into the app's address/history.
  frame.src = tab.url;
  frame.title = "Página web: " + tab.title;
  render();
  status.textContent = "Abriendo " + new URL(tab.url).hostname +
    " · Si se muestra en blanco, este sitio no permite la vista integrada. Usa «Abrir sitio original».";
}
export function openBrowser(value = "", { newTab = false } = {}) {
  showView();
  let url = null;
  if (value) {
    try { url = normalizeBrowserUrl(value, location.origin); }
    catch (error) { render(); displayError(error); return false; }
  }
  if (native) {
    void native.open(url, newTab).then(value => {
      nativeState = value;
      render(); syncNativeBounds();
      status.textContent = url ? "Chromium: navegación real bajo el motor nativo WAEWEB." :
        "Nueva pestaña. Escribe una URL HTTPS para comenzar.";
      if (!url) address.focus();
    }).catch(displayError);
    return true;
  }
  try {
    if (newTab || !state.active()) state.create(url);
    else if (url) state.navigate(url);
  } catch (error) { render(); displayError(error); return false; }
  if(url) {
    previewOptIn.delete(state.active().id);
    state.rename(state.active().id, new URL(url).hostname);
  }
  if (url) loadCurrent();
  else { render(); status.textContent = "Escribe un dominio HTTPS para verlo junto a los resultados de búsqueda."; address.focus(); }
  view.scrollIntoView({behavior:"smooth",block:"start"});
  return true;
}
$("browser-form").addEventListener("submit", event => {
  event.preventDefault();
  const target = browserInputTarget(address.value, location.origin);
  if (target.kind === "empty") {
    displayError(new TypeError("Escribe una búsqueda o dirección web."));
    return;
  }
  if (target.kind === "search") {
    searchFromBrowser(target.value);
    return;
  }
  if (target.kind === "invalid") {
    displayError(new TypeError("Ese protocolo no está permitido. Busca por palabras o usa una dirección HTTPS."));
    return;
  }
  openBrowser(target.value);
});
$("browser-back").addEventListener("click", () => {
  if (native) { void native.back().catch(displayError); return; }
  if (!state.active()?.canBack) return;
  state.back(); loadCurrent();
});
$("browser-forward").addEventListener("click", () => {
  if (native) { void native.forward().catch(displayError); return; }
  if (!state.active()?.canForward) return;
  state.forward(); loadCurrent();
});
$("browser-reload").addEventListener("click", () => {
  if (native) void native.reload().catch(displayError);
  else if (state.active()?.url) loadCurrent();
});
$("browser-new").addEventListener("click", () => openBrowser("", { newTab: true }));
attempt.addEventListener("click",()=>{
  const tab=state.active();
  if(!tab?.url)return;
  previewOptIn.add(tab.id);
  loadCurrent();
});
$("browser-close").addEventListener("click", leaveBrowser);
// Header entry uses the unified omnibox, never opens a second empty page.
$("browser-open").addEventListener("click", () => {
  const input=$("hero").hidden ? $("results-input") : $("hero-input");
  input.focus();input.scrollIntoView({behavior:"smooth",block:"center"});
});
$("browser-reader").addEventListener("click", () => {
  const tab = native ? nativeState?.tabs.find(item => item.id === nativeState.activeId) : state.active();
  if (!tab?.url) return;
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

// Native mode renders remote sites in separate Chromium WebContentsViews, never iframes.
if (native) {
  native.onState(payload => {
    nativeState = payload;
    render();
    const current = payload.tabs.find(tab => tab.id === payload.activeId);
    if (current?.error) status.textContent = current.error;
  });
  void native.getState().then(value => { nativeState = value; render(); }).catch(displayError);
  external.addEventListener("click", event => {
    event.preventDefault();
    const current = nativeState?.tabs.find(tab => tab.id === nativeState.activeId);
    if (current?.url) void native.openExternal(current.url).catch(displayError);
  });
  window.addEventListener("resize", syncNativeBounds);
  window.addEventListener("scroll", syncNativeBounds, { passive: true });
  if ("ResizeObserver" in window) new ResizeObserver(syncNativeBounds).observe(stage);
  const disclaimer = document.querySelector(".browser-disclaimer");
  if (disclaimer) disclaimer.textContent =
    "Motor Chromium nativo para páginas HTTPS, con pestañas e historial propios. " +
    "Las páginas externas están aisladas de la aplicación y los permisos de cámara, micrófono, " +
    "ubicación y descargas se encuentran deshabilitados en esta etapa.";
  // External links elsewhere in the WAEWEB shell would otherwise be denied
  // by the native shell's strict setWindowOpenHandler.
  document.addEventListener("click", event => {
    const link = event.target.closest?.('a[target="_blank"]');
    if (!link || link === external || view.hidden === false && link.closest("#browser-view")) return;
    event.preventDefault();
    void native.openExternal(link.href).catch(displayError);
  });
}
