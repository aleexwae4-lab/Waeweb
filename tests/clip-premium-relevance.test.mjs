import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {rankImageResults} from "../server/image-intelligence.mjs";
const search=readFileSync(new URL("../server/search.mjs",import.meta.url),"utf8");
const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
test("ordinary web search does not use Hacker News as a generic substitute for a web index",()=>{
  assert.match(search,/const feeds=\[\.\.\.\(technical\?\[\["Hacker News"/);
  assert.match(search,/page===1 && !spec\.source && !spec\.site && technicalWebQuery/);
});
test("image ranking rejects unrelated public-feed photos while keeping visible query matches",()=>{
  const base={url:"https://example.com/p/1",image:"https://img.example.com/1.jpg",source:"Flickr · fotos públicas"};
  const ranked=rankImageResults([
    {...base,title:"Rider on a motorcycle",snippet:"Public photo"},
    {...base,url:"https://example.com/p/2",image:"https://img.example.com/2.jpg",title:"Artificial intelligence conference",snippet:"AI policy meeting"}
  ],"inteligencia artificial").results;
  assert.equal(ranked.length,1);
  assert.match(ranked[0].title,/Artificial intelligence/i);
});
test("mobile integrated browser hides secondary chrome but preserves address and external navigation",()=>{
  assert.match(css,/browser-view:not\(\.is-external-first\) \.browser-heading\{display:none\}/);
  assert.match(css,/browser-view:not\(\.is-external-first\) \.browser-tabs\{display:none\}/);
  assert.match(css,/#browser-status\{display:none\}/);
  assert.match(css,/\.browser-stage\{min-height:58dvh\}/);
  assert.doesNotMatch(css,/browser-view:not\(\.is-external-first\) \.browser-address\{display:none/);
  assert.doesNotMatch(css,/browser-view:not\(\.is-external-first\) \.browser-external\{display:none/);
});
