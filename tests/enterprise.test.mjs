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
    const books = home.body.indexOf('href="/libros.html"');
    const enterprise = home.body.indexOf('href="/enterprise.html"');
    const diagnostics = home.body.indexOf('href="/diagnostico.html"');
    assert.ok(books >= 0 && enterprise > books && diagnostics === -1);
    assert.ok(home.body.includes("Wae os enterprise'</a>"));
    assert.ok(!home.body.includes('href="https://wae-os-enterprice22.onrender.com'));
  });
});

test("enterprise route renders remote system inside a full-viewport shell", async () => {
  await withServer(async get => {
    const page = await get("/enterprise.html");
    assert.equal(page.status, 200);
    assert.ok(page.headers["content-type"].includes("text/html"));
    assert.ok(page.headers["content-security-policy"].includes("frame-src https:"));
    assert.ok(page.body.includes('<iframe class="enterprise-frame"'));
    assert.ok(page.body.includes('src="https://wae-os-enterprice22.onrender.com/?ui=875d2df7"'));
    assert.ok(page.body.includes('href="/" aria-label="Regresar a WAEWEB"'));
    assert.ok(page.body.includes('rel="noopener noreferrer"'));
    const styles = await get("/enterprise.css");
    assert.equal(styles.status, 200);
    assert.ok(styles.body.includes("height: 100dvh"));
  });
});
