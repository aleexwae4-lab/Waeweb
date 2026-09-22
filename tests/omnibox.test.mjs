import test from "node:test";
import assert from "node:assert/strict";
import { classifyOmnibox } from "../public/omnibox.js";

test("one search box keeps words, research operators, questions and climate as searches",()=>{
  for(const q of [
    "TikTok","clima en Guadalajara","Inteligencia artificial",
    "investigación médica","site:example.org energía", "2.5 millones en MXN",
    "¿Qué es un navegador?","alguien@example.com", "www.example.com consulta"
  ])assert.equal(classifyOmnibox(q).kind,"search",q);
});
test("explicit HTTPS addresses and valid domains enter the inline web viewer",()=>{
  for(const q of [
    "https://example.org/","https://www.example.org/a?q=1",
    "example.org","www.wikipedia.org/wiki/Web","sub.domain.co.uk:443/docs"
  ])assert.equal(classifyOmnibox(q).kind,"url",q);
});
test("invalid schemes are never silently interpreted as harmless search",()=>{
  for(const q of ["javascript:alert(1)","file:///etc/passwd",
    "http://example.com","ftp://example.com"])
    assert.equal(classifyOmnibox(q).kind,"url",q);
  assert.equal(classifyOmnibox("  ").kind,"empty");
  assert.equal(classifyOmnibox("x".repeat(2050)).kind,"invalid");
});
