"use strict";
const { contextBridge, ipcRenderer } = require("electron");

// Only this narrow, immutable API is exposed to the trusted local WAEWEB shell.
// Remote WebContentsViews have no preload and cannot call these IPC channels.
const invoke = (name, data = {}) => ipcRenderer.invoke("wae:desktop:action", name, data);
contextBridge.exposeInMainWorld("waeDesktop", Object.freeze({
  isNative: true,
  getState: () => invoke("state"),
  open: (url, newTab = false) => invoke("open", { url, newTab }),
  select: id => invoke("select", { id }),
  close: id => invoke("close", { id }),
  back: () => invoke("back"),
  forward: () => invoke("forward"),
  reload: () => invoke("reload"),
  setVisible: visible => invoke("visible", { visible }),
  setBounds: bounds => invoke("bounds", { bounds }),
  openExternal: url => invoke("external", { url }),
  onState: callback => {
    if (typeof callback !== "function") throw new TypeError("Callback requerido.");
    const listener = (_event, value) => callback(value);
    ipcRenderer.on("wae:desktop:state", listener);
    return () => ipcRenderer.removeListener("wae:desktop:state", listener);
  }
}));
