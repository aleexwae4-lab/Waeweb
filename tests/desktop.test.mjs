import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { safeDesktopUrl, safeDesktopTarget, normalizeViewport, isTrustedShellSender, MAX_DESKTOP_TABS } from "../desktop/security.mjs";

test("native Chromium validates destinations independently of renderer", () => {
  assert.equal(safeDesktopUrl("example.org/path"), "https://example.org/path");
  assert.equal(safeDesktopUrl("https://example.org/"), "https://example.org/");
  for (const url of [
    "javascript:alert(1)", "file:///etc/passwd", "data:text/html,evil",
    "http://example.org/", "https://127.0.0.1/", "https://192.168.1.22/",
    "https://localhost/", "https://private.internal/", "https://private.localhost./",
    "https://user:pass@example.org/", "https://example.org/\r\nHost:evil",
    "https://9999999999/", "https://sub.local/"
  ]) {
    assert.throws(() => safeDesktopUrl(url), TypeError, url);
    assert.equal(safeDesktopTarget(url), null);
  }
  assert.equal(safeDesktopTarget("https://example.net/a"), "https://example.net/a");
  assert.equal(MAX_DESKTOP_TABS, 8);
});
test("native viewport clips untrusted renderer coordinates to actual content bounds", () => {
  assert.deepEqual(normalizeViewport({ x: 12.8, y: 15.9, width: 500, height: 300 }, { width: 400, height: 200 }),
    { x: 12, y: 15, width: 388, height: 185 });
  assert.deepEqual(normalizeViewport({ x: -100, y: -80, width: 500, height: 300 }, { width: 400, height: 200 }),
    { x: 0, y: 0, width: 400, height: 200 });
  assert.equal(normalizeViewport({ x: 500, y: 500, width: 1, height: 1 }, { width: 400, height: 200 }), null);
  assert.throws(() => normalizeViewport({ x: 0, y: 0, width: NaN, height: 200 }, { width: 800, height: 600 }));
  assert.throws(() => normalizeViewport(null, { width: 800, height: 600 }));
});
test("IPC accepts only main frame from exact local shell origin and pathname", () => {
  const frame = { url: "http://127.0.0.1:1234/" };
  const contents = { isDestroyed: () => false, mainFrame: frame };
  const event = { sender: contents, senderFrame: frame };
  assert.equal(isTrustedShellSender(event, contents, "http://127.0.0.1:1234"), true);
  assert.equal(isTrustedShellSender(event, contents, "http://127.0.0.1:2222"), false);
  assert.equal(isTrustedShellSender({ sender: contents, senderFrame: { url: frame.url } }, contents, "http://127.0.0.1:1234"), false);
  assert.equal(isTrustedShellSender({ sender: {}, senderFrame: frame }, contents, "http://127.0.0.1:1234"), false);
  frame.url = "http://127.0.0.1:1234/api/health";
  assert.equal(isTrustedShellSender(event, contents, "http://127.0.0.1:1234"), false);
});
test("Electron shell source retains sandbox, isolated sessions, and no remote preload", async () => {
  const main = await readFile(new URL("../desktop/main.cjs", import.meta.url), "utf8");
  const preload = await readFile(new URL("../desktop/preload.cjs", import.meta.url), "utf8");
  const browser = await readFile(new URL("../public/browser.js", import.meta.url), "utf8");
  assert.match(main, /new WebContentsView/);
  assert.match(main, /nodeIntegration: false, contextIsolation: true, sandbox: true/);
  assert.match(main, /webSecurity: true/);
  assert.match(main, /partition: "wae-external-web"/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /setPermissionCheckHandler/);
  assert.match(main, /isTrustedShellSender/);
  assert.match(main, /navigationHistory\.goBack/);
  assert.match(main, /navigationHistory\.goForward/);
  assert.match(main, /setWindowOpenHandler/);
  assert.doesNotMatch(main, /ignore-certificate-errors|disable-web-security|allowRunningInsecureContent: true/);
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
  assert.doesNotMatch(preload, /exposeInMainWorld\("ipcRenderer"/);
  assert.match(browser, /waeDesktop/);
});
