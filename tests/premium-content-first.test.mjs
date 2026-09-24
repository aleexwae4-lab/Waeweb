import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const file=name=>readFileSync(new URL("../public/"+name,import.meta.url),"utf8");
const app=file("app.js"),css=file("styles.css"),html=file("index.html"),browser=file("browser.js");
test("named sites have one opening action instead of a duplicate visit button",()=>{
  assert.match(app,/const directSite=state\.type==="all"&&item\.siteLink===true/);
  assert.match(app,/The result title already opens the site; a second visit button is redundant/);
  assert.doesNotMatch(app,/meta\.append\(directSite\s*\?/);
  assert.match(app,/if\(!directSite\)meta\.append\(external\(url,"↗ Origen"/);
});
test("web results retain reading and attribution while folding secondary actions",()=>{
  assert.match(app,/const secondary=element\("div","web-result-secondary"\)/);
  assert.match(app,/child===save/);
  assert.match(app,/child\.classList\.contains\("wae-result-voice"\)/);
  assert.match(app,/child\.classList\.contains\("web-index-action"\)/);
  assert.match(app,/const more=element\("details","web-result-more"\)/);
  assert.match(app,/if\(webReadingSlot\)card\.append\(webReadingSlot\)/);
  assert.match(css,/\.web-result-more\[open\]\{flex-basis:100%/);
});
test("video results start with available clips rather than a promotional hero",()=>{
  assert.doesNotMatch(app,/resultsContainer\.append\(hero\)/);
  assert.match(app,/state\.type==="videos"\?element\("div","video-results-grid"\)/);
  assert.match(css,/\.video-original-searches\{order:99/);
  assert.match(app,/const control=button\(label\+" · "\+amount/);
});
test("home keeps business registration without duplicate oversized promotions",()=>{
  assert.match(html,/<details class="hero-business hero-business-details">/);
  assert.match(html,/id="hero-account-button"/);
  assert.match(html,/id="marketplace-button"/);
  assert.match(html,/id="hero-marketplace"/);
  assert.match(css,/#hero-marketplace\{display:none!important\}/);
  assert.match(css,/\.hero-business-details>summary/);
});
test("blocked destinations get fallback and normal pages do not duplicate external toolbar",()=>{
  assert.match(browser,/access\.hidden=!current\?\.url \|\| !blocked/);
  assert.match(browser,/if \(current\?\.url\) external\.href = current\.url/);
  assert.match(css,/\.browser-view \.browser-disclaimer\{display:none\}/);
});
test("mobile share and source controls remain accessible",()=>{
  assert.match(css,/\.statsbar #copy-search\{display:inline-flex!important/);
  assert.match(html,/id="copy-search"[^>]*title="Copiar enlace de búsqueda"/);
  assert.match(app,/sourceFilter\.hidden = state\.type==="books" \|\| options\.length < 2/);
  assert.match(app,/const retry=button\("↻ Reintentar búsqueda"/);
  assert.match(app,/const alternatives=element\("details","search-alternatives"\)/);
});
