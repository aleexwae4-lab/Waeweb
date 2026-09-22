"use strict";

// Optional native Chromium shell. Never imported by the web/Render/Vercel server.
const { app, BrowserWindow, WebContentsView, ipcMain, session, shell } = require("electron");
const http = require("node:http");
const { join } = require("node:path");
const { pathToFileURL } = require("node:url");

app.enableSandbox();

let windowRef = null;
let server = null;
let shellOrigin = "";
let activeId = null;
let nextId = 1;
let visible = false;
let viewport = null;
const tabs = new Map();
const MAX_TABS = 8;
let security;

function assertRemote(input) {
  // The exact same browser URL policy is checked in the native main process.
  return security.safeDesktopUrl(input, shellOrigin);
}
function activeTab() { return tabs.get(activeId) || null; }
function cleanTab(tab) {
  const wc = tab.view.webContents;
  const loaded = !wc.isDestroyed() ? wc.getURL() : "";
  const target = /^https:\/\//i.test(loaded) ? loaded : tab.target;
  const history = !wc.isDestroyed() && wc.navigationHistory;
  return {
    id: tab.id, title: (!wc.isDestroyed() && wc.getTitle() || tab.title).slice(0, 80),
    url: target || null, canBack: Boolean(history?.canGoBack()),
    canForward: Boolean(history?.canGoForward()), loading: !wc.isDestroyed() && wc.isLoading(),
    error: tab.error || ""
  };
}
function snapshot() {
  return { activeId, tabs: [...tabs.values()].map(cleanTab), native: true };
}
function emitState() {
  if (windowRef && !windowRef.isDestroyed() && !windowRef.webContents.isDestroyed()) {
    windowRef.webContents.send("wae:desktop:state", snapshot());
  }
}
function removeView(tab) {
  if (windowRef && !windowRef.isDestroyed()) windowRef.contentView.removeChildView(tab.view);
}
function layout() {
  if (!windowRef || windowRef.isDestroyed()) return;
  const tab = activeTab();
  for (const other of tabs.values()) if (other !== tab || !visible || !viewport) removeView(other);
  if (!visible || !tab || !tab.target || !viewport) { if (tab) removeView(tab); return; }
  const size = windowRef.getContentBounds();
  const bounds = security.normalizeViewport(viewport, { width: size.width, height: size.height });
  if (!bounds) { removeView(tab); return; }
  windowRef.contentView.addChildView(tab.view);
  tab.view.setBounds(bounds);
}
function selectTab(id) {
  if (!tabs.has(id)) throw new TypeError("Pestaña no encontrada.");
  activeId = id;
  layout();
  emitState();
  return snapshot();
}
function loadInTab(tab, input) {
  const url = assertRemote(input);
  tab.target = url;
  tab.error = "";
  if (!tab.view.webContents.isDestroyed()) {
    void tab.view.webContents.loadURL(url).catch(error => {
      if (tabs.has(tab.id)) { tab.error = "No se pudo cargar la página: " + (error?.message || "Error de red"); emitState(); }
    });
  }
  layout(); emitState();
}
function createTab(input = null, activate = true) {
  if (tabs.size >= MAX_TABS) throw new RangeError("Límite de ocho pestañas abiertas.");
  const target = input ? assertRemote(input) : null;
  // Remote web content never receives a preload or Node.js, and uses a different
  // ephemeral Chromium session from the local WAEWEB accounts/shell session.
  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, allowRunningInsecureContent: false,
      webviewTag: false, partition: "wae-external-web"
    }
  });
  const id = nextId++;
  const tab = { id, view, target: null, title: target ? new URL(target).hostname : "Nueva pestaña", error: "" };
  tabs.set(id, tab);
  const wc = view.webContents;
  // Session-wide permission and download policies are installed once at startup.
  wc.on("will-navigate", (event, legacyUrl) => {
    if (!security.safeDesktopTarget(event.url || legacyUrl, shellOrigin)) event.preventDefault();
  });
  wc.on("will-redirect", (event, legacyUrl) => {
    if (!security.safeDesktopTarget(event.url || legacyUrl, shellOrigin)) event.preventDefault();
  });
  wc.setWindowOpenHandler(({ url }) => {
    const safe = security.safeDesktopTarget(url, shellOrigin);
    if (safe && tabs.size < MAX_TABS) setImmediate(() => {
      if (windowRef && !windowRef.isDestroyed()) {
        try { createTab(safe); } catch { /* closed/limit while dispatching */ }
      }
    });
    return { action: "deny" };
  });
  for (const eventName of ["did-start-loading", "did-stop-loading", "did-navigate", "did-navigate-in-page", "page-title-updated"]) {
    wc.on(eventName, () => { if (tabs.has(id)) emitState(); });
  }
  wc.on("did-fail-load", (_event, code, description, _url, mainFrame) => {
    if (mainFrame && code !== -3 && tabs.has(id)) { tab.error = description || "Fallo de navegación."; emitState(); }
  });
  if (activate) activeId = id;
  if (target) loadInTab(tab, target);
  layout(); emitState();
  return snapshot();
}
function closeTab(id) {
  const tab = tabs.get(id);
  if (!tab) return snapshot();
  removeView(tab);
  tabs.delete(id);
  if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
  if (activeId === id) activeId = [...tabs.keys()].at(-1) || null;
  layout(); emitState();
  return snapshot();
}
function guard(event) {
  if (!security.isTrustedShellSender(event, windowRef?.webContents, shellOrigin))
    throw new Error("Acceso IPC denegado.");
}
async function command(event, name, data = {}) {
  guard(event);
  if (!data || typeof data !== "object" || Array.isArray(data)) throw new TypeError("Datos inválidos.");
  if (name === "state") return snapshot();
  if (name === "visible") { visible = data.visible === true; layout(); return snapshot(); }
  if (name === "bounds") {
    viewport = security.normalizeViewport(data.bounds, {
      width: windowRef.getContentBounds().width, height: windowRef.getContentBounds().height
    });
    layout(); return snapshot();
  }
  if (name === "open") {
    const url = data.url ? assertRemote(data.url) : null;
    if (data.newTab === true || !activeTab()) return createTab(url);
    if (url) loadInTab(activeTab(), url);
    return snapshot();
  }
  if (name === "select") return selectTab(data.id);
  if (name === "close") return closeTab(data.id);
  const tab = activeTab();
  if (name === "back" && tab?.view.webContents.navigationHistory.canGoBack()) tab.view.webContents.navigationHistory.goBack();
  else if (name === "forward" && tab?.view.webContents.navigationHistory.canGoForward()) tab.view.webContents.navigationHistory.goForward();
  else if (name === "reload" && tab?.target) tab.view.webContents.reload();
  else if (name === "external") {
    // Only a validated user-triggered HTTPS URL may escape into the OS browser.
    await shell.openExternal(assertRemote(data.url));
    return snapshot();
  } else if (!["back", "forward", "reload"].includes(name)) throw new TypeError("Comando no permitido.");
  emitState();
  return snapshot();
}
async function start() {
  security = await import(pathToFileURL(join(__dirname, "security.mjs")).href);
  const { handler } = await import(pathToFileURL(join(__dirname, "../server/index.mjs")).href);
  server = http.createServer((req, res) => {
    if (!security.desktopRequestAllowed(req, shellOrigin)) {
      res.writeHead(403, {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff"
      });
      res.end("Acceso local denegado.");
      return;
    }
    Promise.resolve(handler(req, res)).catch(() => {
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end("Error interno.");
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  shellOrigin = "http://127.0.0.1:" + server.address().port;
  const shellSession = session.fromPartition("wae-shell");
  shellSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  shellSession.setPermissionCheckHandler(() => false);
  shellSession.on("will-download", event => event.preventDefault());
  const externalSession = session.fromPartition("wae-external-web");
  externalSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  externalSession.setPermissionCheckHandler(() => false);
  externalSession.on("will-download", event => event.preventDefault());
  windowRef = new BrowserWindow({
    title: "WAEWEB Browser Engine", width: 1280, height: 860,
    minWidth: 760, minHeight: 520, backgroundColor: "#030407",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"), partition: "wae-shell",
      nodeIntegration: false, contextIsolation: true, sandbox: true,
      webSecurity: true, webviewTag: false
    }
  });
  windowRef.webContents.on("will-navigate", (event, legacyUrl) => {
    try {
      const destination = new URL(event.url || legacyUrl);
      if (destination.origin !== shellOrigin || !["/", "/index.html"].includes(destination.pathname)) event.preventDefault();
    } catch { event.preventDefault(); }
  });
  windowRef.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  windowRef.on("resize", layout);
  windowRef.on("closed", () => {
    visible = false;
    for (const tab of tabs.values()) if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close();
    tabs.clear(); activeId = null; windowRef = null;
  });
  ipcMain.handle("wae:desktop:action", command);
  await windowRef.loadURL(shellOrigin + "/");
  emitState();
  // A real Electron smoke run validates preload, IPC, Node API and window.
  // No third-party browsing or secrets are needed for this local check.
  if (process.argv.includes("--smoke")) {
    try {
      const check = await windowRef.webContents.executeJavaScript(`(async () => {
        const response = await fetch("/api/health");
        const health = await response.json();
        const initial = await window.waeDesktop.getState();
        const opened = await window.waeDesktop.open(null, true);
        const closed = await window.waeDesktop.close(opened.activeId);
        return {
          bridge: window.waeDesktop?.isNative === true,
          address: !!document.getElementById("browser-address"),
          api: response.ok && health.product === "WAE WEB",
          before: initial.tabs.length,
          during: opened.tabs.length,
          after: closed.tabs.length
        };
      })()`);
      if (!check.bridge || !check.address || !check.api || check.before !== 0 ||
          check.during !== 1 || check.after !== 0) throw new Error("Smoke assertion: " + JSON.stringify(check));
      console.log("WAEWEB_NATIVE_SMOKE_PASS", JSON.stringify(check));
    } catch (error) {
      process.exitCode = 1;
      console.error("WAEWEB_NATIVE_SMOKE_FAIL", error.message);
    }
    app.quit();
  }
}
app.whenReady().then(start).catch(error => {
  console.error("WAEWEB desktop startup failed:", error.message);
  app.quit();
});
app.on("before-quit", () => { if (server) server.close(); });
app.on("window-all-closed", () => { app.quit(); });
