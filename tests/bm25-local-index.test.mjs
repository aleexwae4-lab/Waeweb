import test from "node:test";
import assert from "node:assert/strict";
import {rankLocalBM25} from "../server/web-index.mjs";
test("BM25 ranks a title match ahead of an equal corpus mention",()=>{
 const items=[
  {title:"Introduction",snippet:"solar energy guide",contentRecovered:false},
  {title:"Solar energy guide",snippet:"Overview",contentRecovered:false},
  {title:"Unrelated",snippet:"other topic",contentRecovered:false}
 ];
 const r=rankLocalBM25(items,"solar energy");
 assert.equal(r[0].title,"Solar energy guide");
 assert.equal(r.length,3);
});
test("BM25 handles empty input, accents and metadata without invented fields",()=>{
 const items=[{title:"energía solar",snippet:"",contentRecovered:false},{title:"solar",snippet:"energia",contentRecovered:false}];
 assert.equal(rankLocalBM25(items,"")[0],items[0]);
 assert.deepEqual(rankLocalBM25(items,"energía solar").map(x=>x.title).sort(),items.map(x=>x.title).sort());
});
