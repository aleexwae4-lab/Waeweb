import test from "node:test";
import assert from "node:assert/strict";
import {
  ReaderError, isPublicAddress, safeReaderUrl, robotsPermits, extractHtml,
  readPage, indexDocument, searchIndex, getIndexedDocument
} from "../server/reader.mjs";
import { handler } from "../server/index.mjs";
import http from "node:http";

const mockedResolver = async () => [{ address: "93.184.215.14", family: 4 }];
function transportWithRobots(robots, html) {
  const seen = [];
  const transport = async (url, address) => {
    seen.push({ url: url.href, ip: address.address });
    return url.pathname === "/robots.txt"
      ? { status: robots === null ? 404 : 200, body: robots || "", headers: { "content-type": "text/plain" } }
      : { status: 200, body: html, headers: { "content-type": "text/html; charset=utf-8" } };
  };
  return { transport, seen };
}
test("reject private, documentation, metadata and special DNS addresses", () => {
  for (const ip of ["127.0.0.1", "10.0.0.3", "172.18.0.1", "192.168.4.4",
    "169.254.169.254", "100.100.100.100", "0.0.0.0", "192.0.0.4",
    "192.0.2.1", "198.51.100.2", "203.0.113.6", "224.0.0.1", "::1", "::ffff:127.0.0.1"]) {
    assert.equal(isPublicAddress(ip), false, ip);
  }
  assert.equal(isPublicAddress("93.184.215.14"), true);
});
test("reject unsafe URL protocols, IP literals, credentials and nonstandard ports", () => {
  for (const url of ["http://example.org", "file:///etc/passwd",
    "https://127.0.0.1", "https://[::1]/", "https://example.local/a",
    "https://localhost/", "https://user:pass@example.org/",
    "https://example.org:8443/", "https://example.org/#fragment"]) {
    assert.throws(() => safeReaderUrl(url), ReaderError, url);
  }
  assert.equal(safeReaderUrl("https://example.org/a").href, "https://example.org/a");
});
test("robots parser honors target agent, wildcards, precedence and Allow override", () => {
  const text = "User-agent: *\nDisallow: /private\nAllow: /private/public\nUser-agent: WAEWebResearchBot\nDisallow: /admin\n";
  assert.equal(robotsPermits(text, "/admin/secret"), false);
  assert.equal(robotsPermits(text, "/private/secret"), true); // named group overrides wildcard.
  assert.equal(robotsPermits("User-agent: *\nDisallow: /private\nAllow: /private/public\n", "/private/secret"), false);
  assert.equal(robotsPermits("User-agent: *\nDisallow: /private\nAllow: /private/public\n", "/private/public/help"), true);
  assert.equal(robotsPermits("User-agent: *\nDisallow: /\n", "/"), false);
  assert.equal(robotsPermits("User-agent: *\nDisallow: /private$\n", "/private"), false);
  assert.equal(robotsPermits("User-agent: *\nDisallow: /private$\n", "/private/public"), true);
});
test("extract HTML strips executable markup, titles, entities and tags", () => {
  const data = extractHtml('<html><head><title>WAE &amp; ciencia</title><style>bad</style></head><body><nav>menu</nav><main><h1>Informe</h1><p>La ciencia &lt;avanza&gt;.</p><script>steal()</script></main></body></html>');
  assert.equal(data.title, "WAE & ciencia");
  assert.match(data.text, /La ciencia <avanza>/);
  assert.doesNotMatch(data.text, /steal|menu|bad/);
});
test("reader obtains public document with DNS-pinned transport and attributes original text", async () => {
  const mocks = transportWithRobots("User-agent: *\nAllow: /\n", "<title>Informe WAE</title><main>Texto comprobable de una página pública de investigación.</main>");
  const doc = await readPage("https://reader-test-one.org/article", { resolver: mockedResolver, transport: mocks.transport });
  assert.equal(doc.title, "Informe WAE");
  assert.match(doc.text, /Texto comprobable/);
  assert.match(doc.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(mocks.seen.length, 2);
  assert.ok(mocks.seen.every(entry => entry.ip === "93.184.215.14"));
});
test("reader fails closed for mixed DNS and site robots deny before requesting article", async () => {
  const resolver = async () => [
    { address: "93.184.215.14", family: 4 }, { address: "127.0.0.1", family: 4 }
  ];
  let called = 0;
  await assert.rejects(() => readPage("https://reader-test-two.org/", {
    resolver, transport: async () => { called++; return { status: 200 }; }
  }), { code: "blocked_dns" });
  assert.equal(called, 0);
  const mocks = transportWithRobots("User-agent: *\nDisallow: /nope\n", "<title>Mal</title><body>Texto que no debe extraerse nunca.</body>");
  await assert.rejects(() => readPage("https://reader-test-three.org/nope", {
    resolver: mockedResolver, transport: mocks.transport
  }), { code: "robots_disallowed" });
  assert.equal(mocks.seen.length, 1);
});
test("redirects are rejected instead of allowing destination robots bypass", async () => {
  const calls = [];
  const transport = async (url, address) => {
    calls.push(url.href);
    if (url.pathname === "/robots.txt") return { status: 404, body: "" };
    return { status: 302, location: "https://another-site.org/private" };
  };
  await assert.rejects(() => readPage("https://reader-test-four.org/public", {
    resolver: mockedResolver, transport
  }), { code: "redirect_limit" });
  assert.equal(calls.length, 2);
});
test("index is bounded, searchable, source-attributed, and never claims persistence", () => {
  const store = new Map();
  const page = {
    id: "a".repeat(20), title: "Prueba de biología", url: "https://example.org/biologia",
    text: "La biología estudia los seres vivos y sus sistemas. Un documento original consultado a petición del usuario.",
    source: "Índice WAE", fingerprint: "b".repeat(64), fetchedAt: "2026-09-22T06:00:00.000Z"
  };
  indexDocument(page, store);
  const data = searchIndex("biología", store);
  assert.equal(data.count, 1);
  assert.equal(data.persistence, "memory_only");
  assert.equal(data.results[0].url, page.url);
  assert.equal(data.brief.notes[0].source, "Índice WAE");
  assert.equal(getIndexedDocument(page.id, store).fingerprint, page.fingerprint);
  assert.equal(getIndexedDocument("bad", store), null);
  assert.throws(() => indexDocument({ ...page, id: "bad" }, store), ReaderError);
  for (let i = 0; i < 90; i++) {
    indexDocument({ ...page, id: i.toString(16).padStart(20, "0") }, store);
  }
  assert.equal(store.size, 80);
});
test("reader API is opt-in and does not issue network calls by default", async () => {
  const previous = process.env.WAE_READER_ENABLED;
  delete process.env.WAE_READER_ENABLED;
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const base = "http://127.0.0.1:" + server.address().port;
    const response = await fetch(base + "/api/read?url=" + encodeURIComponent("https://example.org"));
    assert.equal(response.status, 503);
    assert.match((await response.json()).error, /lector desactivado/i);
    const caps = await (await fetch(base + "/api/capabilities")).json();
    assert.equal(caps.readerEnabled, false);
    assert.equal(caps.indexPersistence, "disabled");
    assert.equal((await fetch(base + "/api/index/search?q=a")).status, 503);
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previous !== undefined) process.env.WAE_READER_ENABLED = previous;
  }
});
