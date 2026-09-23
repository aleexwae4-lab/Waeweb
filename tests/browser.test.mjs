import test from "node:test";
import assert from "node:assert/strict";
import { createBrowserState, normalizeBrowserUrl, browserInputTarget, browserPresentation, MAX_BROWSER_TABS, MAX_BROWSER_HISTORY } from "../public/browser-core.js";

test("Browser Core resolves HTTPS domains and preserves ordinary secure paths", () => {
  assert.equal(normalizeBrowserUrl("example.org"), "https://example.org/");
  assert.equal(normalizeBrowserUrl("https://example.org/a?q=1#section"), "https://example.org/a?q=1#section");
  assert.equal(normalizeBrowserUrl(" EXAMPLE.org/docs "), "https://example.org/docs");
});
test("Browser Core refuses unsafe schemes, credentials, local origins and invalid URLs", () => {
  for (const url of [
    "javascript:alert(1)", "data:text/html,hi", "file:///etc/passwd", "http://example.org",
    "https://user:pass@example.org", "https://localhost/", "https://private.internal",
    "https://example.org\\@evil.test", "https://example.org/\nheader", "https://example.org/" + "a".repeat(2048)
  ]) assert.throws(() => normalizeBrowserUrl(url), { name: "TypeError" }, url);
  assert.throws(() => normalizeBrowserUrl("https://wae.example/", "https://wae.example"), /Inicio/);
});
test("Browser Core tab switching and bounded back-forward history", () => {
  const state = createBrowserState(2, 3);
  const a = state.create(null);
  assert.equal(a.url, null);
  assert.equal(state.navigate("https://example.org/").canBack, false);
  assert.equal(state.navigate("https://example.org/a").canBack, true);
  state.navigate("https://example.org/b");
  state.navigate("https://example.org/c");
  assert.deepEqual(state.active().history, ["https://example.org/a", "https://example.org/b", "https://example.org/c"]);
  assert.equal(state.back().url, "https://example.org/b");
  assert.equal(state.back().url, "https://example.org/a");
  assert.equal(state.back().canBack, false);
  assert.equal(state.forward().url, "https://example.org/b");
  assert.equal(state.navigate("https://example.org/d").canForward, false);
  const b = state.create("https://example.net");
  assert.equal(state.tabs().length, 2);
  assert.throws(() => state.create("https://third.example"), RangeError);
  assert.equal(state.select(a.id).url, "https://example.org/d");
  assert.equal(state.close(a.id).id, b.id);
  assert.equal(state.close(b.id), null);
  assert.equal(state.tabs().length, 0);
});
test("Browser Core default budgets enforce eight tabs and thirty history entries", () => {
  const state = createBrowserState();
  for (let i = 0; i < MAX_BROWSER_TABS; i++) state.create("https://example.org/" + i);
  assert.throws(() => state.create("https://example.org/overflow"), RangeError);
  for (let i = 0; i < MAX_BROWSER_HISTORY + 7; i++) state.navigate("https://example.org/path/" + i);
  assert.equal(state.active().history.length, MAX_BROWSER_HISTORY);
});
test("Browser UI and HTML keep third party content isolated and provide escape hatches", async () => {
  const { readFile } = await import("node:fs/promises");
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const browser = await readFile(new URL("../public/browser.js", import.meta.url), "utf8");
  assert.match(html, /id="browser-address"/);
  assert.match(html, /id="browser-external"/);
  assert.match(html, /id="browser-reader"/);
  assert.match(browser, /allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox/);
  assert.doesNotMatch(browser, /allow-same-origin/);
  assert.match(browser, /referrerPolicy = "no-referrer"/);
  assert.match(html, /los sitios que impiden incrustación/i);
});

test("Browser omnibox searches natural language and navigates explicit domains", () => {
  assert.deepEqual(browserInputTarget("inteligencia artificial"), {kind:"search",value:"inteligencia artificial"});
  assert.deepEqual(browserInputTarget("clima en Guadalajara"), {kind:"search",value:"clima en Guadalajara"});
  assert.equal(browserInputTarget("openai.com").kind, "url");
  assert.equal(browserInputTarget("https://example.org/docs").value, "https://example.org/docs");
  assert.equal(browserInputTarget("javascript:alert(1)").kind, "invalid");
});

test("known iframe-hostile platforms get safe external-first handling, not a dead frame",()=>{
  for(const url of [
    "https://www.google.com/search?q=test",
    "https://www.youtube.com/watch?v=aB3_-xyZ901",
    "https://m.tiktok.com/@creator/video/7420123456789012345",
    "https://accounts.google.com/signin"
  ])assert.equal(browserPresentation(url).externalFirst,true,url);
  for(const url of [
    "https://youtube.com.evil.example/video",
    "https://docs.example.org/news",
    "https://wae-os-enterprice22.onrender.com/"
  ])assert.equal(browserPresentation(url).externalFirst,false,url);
  assert.equal(browserPresentation("javascript:bad").externalFirst,false);
});
test("browser keeps the real-site escape visible and requires click before restricted iframe",async()=>{
  const {readFile}=await import("node:fs/promises");
  const html=await readFile(new URL("../public/index.html",import.meta.url),"utf8");
  const browser=await readFile(new URL("../public/browser.js",import.meta.url),"utf8");
  const css=await readFile(new URL("../public/styles.css",import.meta.url),"utf8");
  const app=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(html,/id="browser-access-link"/);
  assert.match(html,/id="browser-frame-gate"/);
  assert.match(html,/id="browser-attempt"/);
  assert.match(browser,/if\(plan\.externalFirst && !previewOptIn\.has\(tab\.id\)\)/);
  assert.match(browser,/attempt\.addEventListener\("click"/);
  assert.match(browser,/accessLink\.href=current\.url/);
  assert.match(browser,/if \(lastView === "hero"\)/);
  assert.match(css,/\.browser-access-link/);
  assert.doesNotMatch(app,/https:\/\/www\.bing\.com\/search\?q=/);
  assert.match(app,/resultsContainer\.prepend\(notice\)/);
});
