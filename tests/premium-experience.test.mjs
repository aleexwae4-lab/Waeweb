import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { premiumCategories, matchesPremiumAction, isPremiumTypingTarget, normalizePremiumTerm } from "../public/premium-core.js";

const html = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/premium.css", import.meta.url), "utf8");
const script = readFileSync(new URL("../public/premium-experience.js", import.meta.url), "utf8");

test("premium search matches accents and ignores case without mutating query", () => {
  assert.equal(matchesPremiumAction("imágenes", "Imagenes fotos"), true);
  assert.equal(matchesPremiumAction("MAPAS", "mapas rutas lugares"), true);
  assert.equal(matchesPremiumAction("tiktok", "videos youtube tiktok clips"), true);
  assert.equal(matchesPremiumAction("imágenes", "mapas rutas"), false);
  assert.equal(normalizePremiumTerm(null), "");
});

test("slash never steals keystrokes from editable controls", () => {
  for (const tagName of ["INPUT","TEXTAREA","SELECT"]) {
    assert.equal(isPremiumTypingTarget({ tagName }), true);
  }
  assert.equal(isPremiumTypingTarget({tagName:"DIV",isContentEditable:true}),true);
  assert.equal(isPremiumTypingTarget({tagName:"BUTTON"}),false);
  assert.deepEqual(premiumCategories,["all","images","videos","maps","books","translate"]);
});

test("explorer integrates existing controls without calling providers", () => {
  for (const id of [
    "premium-launch","premium-command-dialog","premium-command-search",
    "premium-mobile-dock","premium-command-close"
  ]) assert.match(html, new RegExp('id="'+id+'"'));
  assert.match(html, /src="\/premium-experience\.js"/);
  assert.match(script, /\.requestSubmit\(\)/);
  assert.match(script, /\.showModal\(\)/);
  assert.match(script, /\.click\(\)/);
  assert.doesNotMatch(script, /\bfetch\s*\(|XMLHttpRequest|localStorage|sessionStorage/);
});

test("3.0 mobile and accessibility features have robust fallbacks", () => {
  assert.match(css, /\.premium-mobile-dock/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /prefers-reduced-motion\s*:\s*reduce/);
  assert.match(css, /forced-colors\s*:\s*active/);
  assert.match(css, /\[hidden\]\s*\{display:none!important;\}/);
  assert.doesNotMatch(css, /@import|url\(\s*['"]?https?:/i);
});
