import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { handler } from "../server/index.mjs";

async function withServer(run) {
  const server = http.createServer((req, res) => {
    handler(req, res).catch(error => { res.statusCode = 500; res.end(error.message); });
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const origin = "http://127.0.0.1:" + server.address().port;
    const get = path => new Promise((resolve, reject) =>
      http.get(origin + path, res => {
        let body = "";
        res.on("data", chunk => { body += chunk; });
        res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
      }).on("error", reject)
    );
    await run(get);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test("WAEWEB footer links to internal enterprise fullscreen access immediately after Libros", async () => {
  await withServer(async get => {
    const home = await get("/");
    assert.equal(home.status, 200);
    assert.match(home.body, /href="\\/libros\\.html"[^>]*>▤ Libros →<\\/a><a[^>]*href="\\/enterprise\\.html"[^>]*>Wae os enterprise'<\\/a>/);
    assert.doesNotMatch(home.body, /href="https:\\/\\/wae-os-enterprice22\\.onrender\\.com/);
  });
});

test("enterprise route renders original remote system inside the full-viewport shell", async () => {
  await withServer(async get => {
    const page = await get("/enterprise.html");
    assert.equal(page.status, 200);
    assert.match(page.headers["content-type"], /text\\/html/);
    assert.match(page.headers["content-security-policy"], /frame-src https:/);
    assert.match(page.body, /<iframe[^>]*class="enterprise-frame"/);
    assert.match(page.body, /src="https:\\/\\/wae-os-enterprice22\\.onrender\\.com\\/\\?ui=875d2df7"/);
    assert.match(page.body, /href="\\/" aria-label="Regresar a WAEWEB"/);
    assert.match(page.body, /rel="noopener noreferrer"/);
    assert.equal((await get("/enterprise.css")).status, 200);
  });
});
