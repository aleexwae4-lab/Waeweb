// Browser Core: session-only state for explicit navigation, independent of account/vault data.
export const MAX_BROWSER_TABS = 8;
export const MAX_BROWSER_HISTORY = 30;

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
      tab.history = tab.history.slice(0, tab.cursor + 1);
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
