import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { handler } from "../server/index.mjs";
import { normalizeQuery, dedupe, search, weather } from "../server/search.mjs";

test("normalizeQuery removes markup and bounds length", () => {
  assert.equal(normalizeQuery("  <b>Hola</b>  mundo "), "Hola mundo");
  assert.equal(normalizeQuery("x".repeat(300)).length, 180);
});
test("dedupe removes invalid and repeated links", () => {
  assert.equal(dedupe([
    { title: "First", url: "https://example.org/a" },
    { title: "Repeat", url: "https://example.org/a/" },
    { title: "Bad", url: "javascript:alert(1)" }
  ]).length, 1);
});
test("federated search attributes real provider data and signals provider failures", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => {
    const name = String(url);
    if (name.includes("es.wikipedia.org")) return new Response(JSON.stringify({
      query: { search: [{ title: "Test académico", pageid: 123, snippet: "Contenido <b>rastreable</b>" }] }
    }), { status: 200 });
    return new Response("unavailable", { status: 503 });
  };
  try {
    const data = await search("concepto prueba sintética");
    assert.equal(data.results.length, 1);
    assert.equal(data.results[0].source, "Wikipedia");
    assert.equal(data.results[0].snippet, "Contenido rastreable");
    assert.match(data.results[0].url, /curid=123/);
    assert.ok(data.failedSources.includes("Crossref"));
    assert.ok(data.failedSources.includes("OpenAlex"));
    assert.ok(!("estimatedHits" in data));
  } finally { globalThis.fetch = original; }
});
test("news without configured search does not invent stories", async () => {
  const key = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_ENGINE_ID;
  delete process.env.GOOGLE_SEARCH_API_KEY;
  delete process.env.GOOGLE_SEARCH_ENGINE_ID;
  try {
    const data = await search("noticias prueba", "news");
    assert.deepEqual(data.results, []);
    assert.match(data.message, /proveedores disponibles/);
  } finally {
    if (key !== undefined) process.env.GOOGLE_SEARCH_API_KEY = key;
    if (cx !== undefined) process.env.GOOGLE_SEARCH_ENGINE_ID = cx;
  }
});
test("weather uses returned observation, not hardcoded Madrid data", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => new Response(JSON.stringify(
    String(url).includes("geocoding-api")
      ? { results: [{ name: "Guadalajara", country: "México", latitude: 20.67, longitude: -103.35 }] }
      : { current: { temperature_2m: 29, relative_humidity_2m: 35, weather_code: 1, wind_speed_10m: 8, time: "2026-09-22T12:00" }, timezone: "America/Mexico_City", daily: { time: ["2026-09-22"], temperature_2m_max: [31], temperature_2m_min: [18] } }
  ), { status: 200 });
  try {
    const data = await weather("clima en Guadalajara");
    assert.match(data.place, /Guadalajara/);
    assert.equal(data.temperature, 29);
    assert.equal(data.source, "Open-Meteo");
  } finally { globalThis.fetch = original; }
});
test("server serves health, secure static HTML and blocks unknown files", async () => {
  const server = http.createServer((req, res) => {
    handler(req, res).catch(error => { res.statusCode = 500; res.end(error.message); });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const origin = "http://127.0.0.1:" + server.address().port;
    const get = async path => new Promise((resolve, reject) => http.get(origin + path, res => {
      let body = "";
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    }).on("error", reject));
    const health = await get("/api/health");
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).status, "ok");
    const index = await get("/");
    assert.equal(index.status, 200);
    assert.match(index.body, /WAE WEB/);
    assert.match(index.headers["content-security-policy"], /script-src 'self'/);
    assert.match(index.headers["content-security-policy"], /frame-src https:/);
    assert.match(index.headers["content-security-policy"], /frame-ancestors/);
    assert.equal((await get("/browser.js")).status, 200);
    assert.equal((await get("/browser-core.js")).status, 200);
    assert.equal((await get("/server/search.mjs")).status, 404);
    assert.equal((await get("/api/search?q=a")).status, 400);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
