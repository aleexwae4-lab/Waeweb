import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {browserPresentation,siteVisitMode} from "../public/browser-core.js";

test("named navigation never traps popular websites in a blank embedded frame",()=>{
  for(const url of [
    "https://github.com/","https://github.com/owner/repo",
    "https://www.mercadolibre.com.mx/",
    "https://www.mercadolibre.com/item",
    "https://www.instagram.com/","https://www.facebook.com/",
    "https://www.linkedin.com/","https://www.whatsapp.com/",
    "https://www.youtube.com/"
  ]){
    assert.equal(browserPresentation(url).externalFirst,true,url);
    assert.equal(siteVisitMode(url,false),"original",url);
    assert.equal(siteVisitMode(url,true),"integrated",url);
  }
});
test("hosted mode opens every external hostname at its origin",()=>{
  for(const url of [
    "https://github.com.evil.example.org/",
    "https://mercadolibre.com.mx.bad.example.org/",
    "https://fakegithub.com/",
    "https://github.io/",
    "https://developer.mozilla.org/"
  ]){
    assert.equal(siteVisitMode(url,false),"original",url);
  }
});
test("real website title and primary action are direct HTTPS links on web, buttons in native",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/siteVisitMode\(url,window\.waeDesktop\?\.isNative===true\)==="original"/);
  assert.match(app,/directSite\s*\? external\(url,item\.title,"result-title web-result-title wae-external-site-title"\)/);
  assert.match(app,/item\.siteLink===true\s*\? button\(item\.title,\(\)=>openBrowser\(url\)/);
  // A result title is the only primary visit action; do not render a duplicate CTA.
  assert.doesNotMatch(app,/meta\.append\(directSite\s*\?/);
  assert.match(app,/if\(item\.snippet\)meta\.append\(reader\.control\)/);
  assert.match(app,/a\.referrerPolicy = "no-referrer"/);
  assert.match(app,/if\(!directSite\)meta\.append\(external\(url,"↗ Origen","save-button"\)\)/);
  assert.match(app,/button\(item\.title,\(\)=>webReadingToggle\?\.\(\),"result-title web-result-title"\)/);
});
