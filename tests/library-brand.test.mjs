import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const file=path=>readFile(new URL("../public/"+path,import.meta.url),"utf8");
test("book results are first-class WAE editorial bookshelf rather than repeated search cards",async()=>{
  const [app,gallery,css,modal]=await Promise.all([
    file("app.js"),file("book-gallery.js"),file("book-experience.css"),file("book-experience.js")
  ]);
  assert.match(app,/import \{renderBookCard\} from "\/book-gallery\.js"/);
  assert.match(app,/if\(state\.type==="books"\)return renderBookCard/);
  assert.match(app,/Historias que merecen ser descubiertas/);
  assert.match(app,/Cada gran idea empieza con una lectura/);
  assert.match(app,/wae-library-grid/);
  assert.match(app,/Fuentes bibliográficas y disponibilidad/);
  assert.match(app,/Crea tu libro en WAE/);
  assert.match(gallery,/Fuente: " \+ item\.source/);
  assert.match(gallery,/Ver libro →/);
  assert.match(gallery,/openBookDetail\(item,\{workspace,onSaved\}\)/);
  assert.match(css,/\.wae-library-cover-action/);
  assert.match(css,/\.wae-library-grid/);
  assert.match(modal,/wae-book-rights/);
  assert.match(modal,/Datos bibliográficos: " \+ item\.source/);
  assert.doesNotMatch(gallery,/iframe|innerHTML/);
});

test("editorial library creates no fabricated e-books, rights or source URLs",async()=>{
  const gallery=await file("book-gallery.js");
  assert.match(gallery,/isBookWork\(item\)/);
  assert.match(gallery,/item\.bookAccess/);
  assert.match(gallery,/workspace\.add\(item\)/);
  assert.doesNotMatch(gallery,/fakeBook|sampleBook|generateBooks|https:\/\/example\.com\/ebooks/);
});
