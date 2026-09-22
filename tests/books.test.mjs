import test from "node:test";
import assert from "node:assert/strict";
import { openLibrary, search } from "../server/search.mjs";
import { parseQuery } from "../server/intelligence.mjs";

test("books lookup returns only real Open Library works with attributed covers and dates", async () => {
  const prior = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.match(String(url), /^https:\/\/openlibrary\.org\/search\.json/);
    return new Response(JSON.stringify({ docs: [
      { key: "/works/OL123W", title: "Libro comprobable", author_name: ["Autora", "Coautor"], first_publish_year: 2024, cover_i: 9876 },
      { key: "/works/../../secrets", title: "Ruta insegura", cover_i: -1 },
      { key: "/works/OL456W", title: "Sin datos inventados" }
    ] }), { status: 200 });
  };
  try {
    const items = await openLibrary("biblioteca caso");
    assert.equal(items.length, 2);
    assert.equal(items[0].url, "https://openlibrary.org/works/OL123W");
    assert.equal(items[0].source, "Open Library");
    assert.equal(items[0].date, "2024");
    assert.equal(items[0].image, "https://covers.openlibrary.org/b/id/9876-M.jpg");
    assert.match(items[0].snippet, /Autora/);
    assert.equal(items[1].image, null);
    assert.equal(items[1].date, null);
  } finally { globalThis.fetch = prior; }
});
test("books category and source:openlibrary do not fabricate unrelated results", async () => {
  assert.equal(parseQuery("literatura source:openlibrary").source, "openlibrary");
  const prior = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ docs: [] }), { status: 200 });
  try {
    const data = await search("biblioteca prueba independiente", "books");
    assert.equal(data.type, "books");
    assert.deepEqual(data.results, []);
    assert.ok(data.sources.includes("Open Library"));
  } finally { globalThis.fetch = prior; }
});
