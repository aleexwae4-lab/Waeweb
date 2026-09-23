import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { openLibrary } from "../server/search.mjs";

const load = name => readFile(new URL("../public/" + name, import.meta.url), "utf8");

test("WAE library is native in the existing search rather than an Open Library iframe", async () => {
  const [html, app, details, css] = await Promise.all([
    load("index.html"), load("app.js"), load("book-experience.js"), load("book-experience.css")
  ]);
  assert.match(html, /data-type="books">▤ Biblioteca WAE<\/button>/);
  assert.match(html, /href="\/book-experience\.css"/);
  assert.match(app, /import \{ isBookWork, openBookDetail \} from "\/book-experience\.js"/);
  assert.match(app, /nativeBook\?"Biblioteca WAE WEB"/);
  assert.match(app, /openBookDetail\(item, \{ workspace, onSaved: refreshLibraryCount \}\)/);
  assert.match(details, /dialog\.showModal\(\)/);
  assert.match(details, /Datos bibliográficos: Open Library/);
  assert.match(details, /no acredita disponibilidad de lectura, descarga, préstamo o compra/);
  assert.match(details, /\/libros\.html#publicar/);
  assert.doesNotMatch(details, /iframe|dangerouslySetInnerHTML|innerHTML/);
  assert.match(css, /\.wae-book-dialog::backdrop/);
});

test("WAE library keeps canonical Open Library work URLs and documented provenance", async () => {
  const prior = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    docs: [{ key: "/works/OL314W", title: "Obra verificada", author_name: ["Autora"],
      first_publish_year: 2020, cover_i: 12345 }]
  }), { status: 200 });
  try {
    const [book] = await openLibrary("obra verificada");
    assert.equal(book.source, "Open Library");
    assert.equal(book.url, "https://openlibrary.org/works/OL314W");
    assert.equal(book.image, "https://covers.openlibrary.org/b/id/12345-M.jpg");
    assert.match(book.snippet, /Autora/);
  } finally {
    globalThis.fetch = prior;
  }
});
