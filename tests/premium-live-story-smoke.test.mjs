import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {quickOpenWeb} from "../server/search.mjs";

// The live smoke must exercise the specialist-story path rather than a
// brand-only navigational search, which intentionally does not call HN.
test("Hacker News early smoke matches the bounded specialist intent contract",()=>{
  const smoke=readFileSync(new URL("../scripts/live-public-smoke.mjs",
    import.meta.url),"utf8");
  assert.match(smoke,/const earlyWeb=await request[\s\S]{0,130}encodeURIComponent\("hacker news"\)/);
  assert.match(smoke,/earlyWeb\.body\?\.scope==="public_specialist_story_links"/);
  assert.doesNotMatch(smoke,/const earlyWeb=await request[\s\S]{0,130}encodeURIComponent\("GitHub"\)/);
});
test("ordinary GitHub nav never fabricates community-linked pages",async()=>{
  const result=await quickOpenWeb("GitHub");
  assert.equal(result.scope,"verified_local_web_links_only");
  assert.ok(["not_applicable","local_cache"].includes(result.sourceStatus));
  assert.ok(result.results.every(row=>row.source!=="Hacker News · web abierta"&&
    row.source!=="WAE Index local · HN"));
});
