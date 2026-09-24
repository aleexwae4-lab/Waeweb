// Browser Core: session-only state for explicit navigation, independent of account/vault data.
export const MAX_BROWSER_TABS = 8;
export const MAX_BROWSER_HISTORY = 30;

export function looksLikeWebAddress(input) {
  const value = String(input ?? "").trim();
  if (!value || /\s/.test(value)) return false;
  if (/^https:\/\//i.test(value)) return true;
  return /^(?:www\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}(?::\d{1,5})?(?:[/?#][^\s]*)?$/i.test(value);
}


// No web application can override X-Frame-Options or frame-ancestors imposed
// by a third party. These destinations should be external-first, with an
// explicit optional attempt at the embedded view. This does NOT claim that
// every URL on these domains is blocked.
export function browserPresentation(value){
  let host;
  try{host=new URL(value).hostname.toLowerCase().replace(/^www\./,"");}catch{
    return {externalFirst:false,reason:""};
  }
  const restricted=["youtube.com","youtu.be","tiktok.com","facebook.com",
    "instagram.com","openai.com","chatgpt.com","pinterest.com",
    "accounts.google.com","google.com","x.com","twitter.com",
    "github.com","mercadolibre.com.mx","mercadolibre.com",
    "linkedin.com","whatsapp.com"];
  const externalFirst=restricted.some(domain=>host===domain||host.endsWith("."+domain))||
    /^google\.[a-z]{2,}(?:\.[a-z]{2,})?$/.test(host);
  return externalFirst
    ?{externalFirst:true,reason:"Esta plataforma suele restringir la vista dentro de otras páginas."}
    :{externalFirst:false,reason:""};
}

// Browser edition cannot force an embedded view of a third-party website.
// Native desktop Chromium retains internal navigation for the same domains.
export function siteVisitMode(url, native=false){
  return native || !browserPresentation(url).externalFirst?"integrated":"original";
}

export function browserInputTarget(input, appOrigin = "") {
  const value = String(input ?? "").trim();
  if (!value) return { kind: "empty", value: "" };
  if (looksLikeWebAddress(value)) return { kind: "url", value: normalizeBrowserUrl(value, appOrigin) };
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return { kind: "invalid", value };
  return { kind: "search", value: value.slice(0, 180) };
}

export function normalizeBrowserUrl(input, appOrigin = "") {
  if (typeof input !== "string" || input.length > 2048) throw new TypeError("La dirección es demasiado larga o inválida.");
  const typed = input.trim();
  if (!typed || /[\\\u0000-\u001f\u007f]/.test(typed)) throw new TypeError("Escribe una dirección web válida.");
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(typed) ? typed : "https://" + typed;
  let url;
  try { url = new URL(candidate); } catch { throw new TypeError("No se pudo interpretar la dirección."); }
  if (url.protocol !== "https:") throw new TypeError("La navegación integrada solo admite HTTPS. Utiliza Abrir fuera para otros protocolos.");
  if (url.username || url.password) throw new TypeError("No introduzcas contraseñas ni credenciales en la dirección.");
  if (!url.hostname.includes(".") || /\.(?:local|localhost|internal|test|invalid|onion)$/i.test(url.hostname) || url.hostname === "localhost")
    throw new TypeError("Solo se permiten dominios web HTTPS.");
  if (appOrigin && url.origin === appOrigin) throw new TypeError("Utiliza Inicio para navegar por WAE WEB.");
  if (url.href.length > 2048) throw new TypeError("La dirección supera el límite de 2048 caracteres.");
  return url.href;
}

export function createBrowserState(maxTabs = MAX_BROWSER_TABS, maxHistory = MAX_BROWSER_HISTORY) {
  const tabs = [];
  let activeId = null;
  let nextId = 1;
  const active = () => tabs.find(tab => tab.id === activeId) || null;
  const snapshot = tab => tab ? {
    id: tab.id, title: tab.title, url: tab.history[tab.cursor], history: [...tab.history],
    cursor: tab.cursor, canBack: tab.cursor > 0, canForward: tab.cursor < tab.history.length - 1
  } : null;
  function create(url, title = "Nueva pestaña") {
    if (tabs.length >= maxTabs) throw new RangeError("Máximo de " + maxTabs + " pestañas; cierra una antes de abrir otra.");
    const tab = { id: nextId++, title, history: [url], cursor: 0 };
    tabs.push(tab); activeId = tab.id; return snapshot(tab);
  }
  function navigate(url) {
    const tab = active();
    if (!tab) return create(url);
    if (tab.history[tab.cursor] !== url) {
      if (tab.history.length === 1 && tab.history[0] === null) tab.history = [];
      else tab.history = tab.history.slice(0, tab.cursor + 1);
      tab.history.push(url);
      if (tab.history.length > maxHistory) tab.history.shift();
      tab.cursor = tab.history.length - 1;
    }
    return snapshot(tab);
  }
  function back() { const tab = active(); if (tab && tab.cursor > 0) tab.cursor--; return snapshot(tab); }
  function forward() { const tab = active(); if (tab && tab.cursor < tab.history.length - 1) tab.cursor++; return snapshot(tab); }
  function select(id) { if (!tabs.some(tab => tab.id === id)) return null; activeId = id; return snapshot(active()); }
  function close(id) {
    const index = tabs.findIndex(tab => tab.id === id);
    if (index < 0) return snapshot(active());
    tabs.splice(index, 1);
    if (activeId === id) activeId = tabs[Math.min(index, tabs.length - 1)]?.id ?? null;
    return snapshot(active());
  }
  function rename(id, title) {
    const tab = tabs.find(item => item.id === id);
    if (tab) tab.title = String(title).slice(0, 80);
    return snapshot(tab);
  }
  return { create, navigate, back, forward, select, close, rename, active: () => snapshot(active()), tabs: () => tabs.map(snapshot) };
}
