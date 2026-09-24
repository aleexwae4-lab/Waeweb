import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {browserPresentation} from "../public/browser-core.js";

const read = name => readFileSync(new URL("../public/"+name,import.meta.url),"utf8");

test("known non-embeddable named sites never get a giant default iframe", () => {
  for(const url of [
    "https://openai.com/", "https://chatgpt.com/", "https://www.instagram.com/",
    "https://www.pinterest.com/", "https://github.com/", "https://www.mercadolibre.com.mx/"
  ]) assert.equal(browserPresentation(url).externalFirst,true,url);
  assert.equal(browserPresentation("https://openai.com.evil.example/").externalFirst,false);
  assert.equal(browserPresentation("https://docs.example.org/").externalFirst,false);
  const browser=read("browser.js");
  const css=read("styles.css");
  assert.match(browser,/view\.classList\.toggle\("is-external-first", blocked\)/);
  assert.match(css,/\.browser-view\.is-external-first \.browser-stage\{display:none!important\}/);
  assert.match(browser,/accessLink\.href=current\.url/);
  assert.match(browser,/attempt\.addEventListener\("click"/);
});
test("web results appear before optional provider diagnostics on mobile",()=>{
  const css=read("styles.css"),app=read("app.js"),html=read("index.html");
  assert.match(css,/\.web-search-toolbar\{order:99/);
  assert.match(css,/\.web-search-toolbar-heading,\.web-search-metrics,\.web-results-heading\{display:none!important\}/);
  assert.match(css,/#browser-open\{display:none\}/);
  assert.match(app,/sourceFilter\.hidden = state\.type==="books" \|\| options\.length < 2/);
  assert.match(app,/visible\+" de "\+count\+" resultados"/);
  assert.match(html,/id="results-container"/);
  assert.match(html,/id="browser-access-link"/);
});
