import test from "node:test";
import assert from "node:assert/strict";
import { parseQuery, scoreResult, rankResults, researchBrief } from "../server/intelligence.mjs";
import { search, openAlexAbstract } from "../server/search.mjs";
import { createWorkspace, asMarkdown } from "../public/workspace.js";

test("advanced query parser preserves terms and extracts operators", () => {
  const p = parseQuery('energía solar site:example.org after:2024-01-01 before:2026-01-01 -marketing "energía solar"');
  assert.equal(p.query, "energía solar energía solar");
  assert.equal(p.site, "example.org");
  assert.equal(p.after, "2024-01-01");
  assert.equal(p.before, "2026-01-01");
  assert.deepEqual(p.excludes, ["marketing"]);
  assert.deepEqual(p.phrases, ["energia solar"]);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(parseQuery("ciencia after:2026-99-99").errors, ["Fecha after: inválida."]);
  assert.ok(parseQuery("ciencia after:2026 before:2025").errors.length);
});
test("ranking reflects matches while restrictions are applied without inventing dates", () => {
  const items = [
    { title: "Energía solar académica", snippet: "renovable", url: "https://papers.example.org/1", source: "Crossref", date: "2025-01-03" },
    { title: "Otra energía", snippet: "marketing solar", url: "https://papers.example.org/2", source: "Crossref", date: "2025-01-05" },
    { title: "Energía solar", snippet: "artículo", url: "https://malicious.example.com/3", source: "Google", date: "2025-01-04" },
    { title: "Energía solar", snippet: "sin fecha", url: "https://papers.example.org/4", source: "Crossref", date: null }
  ];
  const spec = parseQuery('energía solar site:example.org after:2025 before:2026 -marketing');
  assert.equal(rankResults(items, spec).length, 1);
  assert.equal(rankResults(items, spec)[0].url, "https://papers.example.org/1");
  assert.ok(scoreResult(items[0], "energía solar") > scoreResult(items[1], "energía solar"));
  assert.equal(rankResults(items, parseQuery('energía solar source:openalex')).length, 0);
});
test("cited brief contains actual snippets with no fabricated summary or verified label", () => {
  const results = [
    { title: "Doc 1", url: "https://site-a.org/a", source: "Crossref", snippet: "Documento real primero. Algo más." },
    { title: "Doc 2", url: "https://site-a.org/b", source: "Crossref", snippet: "Mismo dominio." },
    { title: "Doc 3", url: "https://site-b.org/a", source: "OpenAlex", snippet: "Segunda fuente documental." }
  ];
  const data = researchBrief(results);
  assert.equal(data.kind, "extractive");
  assert.equal(data.notes.length, 2);
  assert.equal(data.notes[0].statement, "Documento real primero.");
  assert.equal(data.domainsRepresented, 2);
  assert.match(data.disclaimer, /no se han contrastado/);
});
test("OpenAlex inverted abstract is reconstructed by source positions", () => {
  assert.equal(openAlexAbstract({ ciencia: [1], La: [0], avanza: [2] }), "La ciencia avanza");
  assert.equal(openAlexAbstract(null), "");
});
test("cache does not leak general results into site-constrained query", async () => {
  const previous = globalThis.fetch;
  const googleKey = process.env.GOOGLE_SEARCH_API_KEY;
  const googleEngine = process.env.GOOGLE_SEARCH_ENGINE_ID;
  delete process.env.GOOGLE_SEARCH_API_KEY;
  delete process.env.GOOGLE_SEARCH_ENGINE_ID;
  globalThis.fetch = async url => {
    const u = String(url);
    if (u.includes("wikipedia.org")) return new Response(JSON.stringify({ query: { search: [
      { title: "Ciencias especiales", pageid: 1234, snippet: "La ciencia importa." }
    ] } }), { status: 200 });
    if (u.includes("crossref.org")) return new Response(JSON.stringify({ message: { items: [] } }), { status: 200 });
    if (u.includes("openalex.org")) return new Response(JSON.stringify({ results: [] }), { status: 200 });
    return new Response("no", { status: 404 });
  };
  try {
    const general = await search("ciencias-cache-prueba");
    const explicit = await search("ciencias-cache-prueba source:wikipedia");
    const filtered = await search("ciencias-cache-prueba site:example.org");
    assert.equal(general.results.length, 1);
    assert.equal(explicit.results.length, 1);
    assert.equal(filtered.results.length, 0);
    assert.equal(filtered.filters.site, "example.org");
    assert.equal(filtered.brief.notes.length, 0);
  } finally {
    globalThis.fetch = previous;
    if (googleKey !== undefined) process.env.GOOGLE_SEARCH_API_KEY = googleKey;
    if (googleEngine !== undefined) process.env.GOOGLE_SEARCH_ENGINE_ID = googleEngine;
  }
});
test("research workspace saves, deduplicates, removes and exports citations locally", () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key) || null, setItem: (key, val) => data.set(key, val) };
  const book = createWorkspace(storage);
  const item = { title: "Artículo", url: "https://example.org/paper", source: "OpenAlex", snippet: "Texto de la fuente.", date: "2025" };
  assert.equal(book.add(item).ok, true);
  assert.equal(book.add(item).duplicate, true);
  assert.equal(book.count(), 1);
  assert.match(asMarkdown(book.list()), /https:\/\/example.org\/paper/);
  assert.match(asMarkdown(book.list()), /OpenAlex/);
  assert.equal(book.remove(item.url), true);
  assert.equal(book.count(), 0);
  assert.equal(book.add({ title: "invalid", url: "javascript:alert(1)" }).ok, false);
});
test("private workspace remains functional when storage is blocked, with warning", () => {
  const storage = { getItem: () => { throw Error("denied"); }, setItem: () => { throw Error("denied"); } };
  const book = createWorkspace(storage);
  const response = book.add({ title: "Fuente", url: "https://example.org/x" });
  assert.equal(response.ok, true);
  assert.equal(response.persisted, false);
  assert.equal(book.count(), 1);
});
