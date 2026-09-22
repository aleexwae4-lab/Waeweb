// Pure, testable boundaries shared by the optional Electron shell.
import { isIP } from "node:net";
import { normalizeBrowserUrl } from "../public/browser-core.js";

export const MAX_DESKTOP_TABS = 8;

export function safeDesktopUrl(input, shellOrigin = "") {
  const url = new URL(normalizeBrowserUrl(input, shellOrigin));
  // Deliberately no local/file/app endpoints through untrusted Chromium views.
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (isIP(hostname) || /^\d+(?:\.\d+){0,3}$/.test(hostname) ||
      /\.(?:localhost|internal|local|test|invalid|onion)$/.test(hostname)) {
    throw new TypeError("Los destinos IP y locales no se abren en esta versión.");
  }
  return url.href;
}

export function safeDesktopTarget(input, shellOrigin = "") {
  try { return safeDesktopUrl(input, shellOrigin); } catch { return null; }
}

export function normalizeViewport(input, windowBounds) {
  const { width, height } = windowBounds || {};
  if (![width, height].every(v => Number.isFinite(v) && v > 0))
    throw new TypeError("Ventana inválida.");
  if (!input || !["x", "y", "width", "height"].every(k => Number.isFinite(input[k])))
    throw new TypeError("Área inválida.");
  const x = Math.min(Math.max(0, Math.floor(input.x)), Math.max(0, width - 1));
  const y = Math.min(Math.max(0, Math.floor(input.y)), Math.max(0, height - 1));
  const w = Math.min(Math.max(0, Math.floor(input.width)), width - x);
  const h = Math.min(Math.max(0, Math.floor(input.height)), height - y);
  if (w < 10 || h < 10) return null;
  return { x, y, width: w, height: h };
}

export function isTrustedShellSender(event, shellContents, shellOrigin) {
  if (!shellContents || shellContents.isDestroyed() || event.sender !== shellContents ||
      event.senderFrame !== shellContents.mainFrame) return false;
  try {
    const url = new URL(event.senderFrame.url);
    return url.origin === shellOrigin && url.pathname === "/";
  } catch { return false; }
}

/**
 * Protect the local desktop HTTP shell from DNS rebinding, hostile Host headers
 * and cross-site requests. This policy is ONLY applied to Electron's loopback
 * server; it does not change the public Node web server.
 */
export function desktopRequestAllowed(req, shellOrigin) {
  let expected;
  try { expected = new URL(shellOrigin); } catch { return false; }
  const host = req?.headers?.host;
  if (typeof host !== "string" || host !== expected.host) return false;
  const origin = req.headers.origin;
  if (origin !== undefined && origin !== shellOrigin) return false;
  const site = req.headers["sec-fetch-site"];
  if (site && !["same-origin", "none"].includes(site)) return false;
  const method = String(req.method || "GET").toUpperCase();
  if (!["GET", "HEAD", "OPTIONS"].includes(method) && origin !== shellOrigin) return false;
  return true;
}
