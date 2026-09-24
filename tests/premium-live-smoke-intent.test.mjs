import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {directorySites,earlyWikidataSiteEligible} from "../server/site-discovery.mjs";

// The live smoke is a contract test for the REMOTE P856 path. It must not
// silently turn into an unrelated curated-directory test after new releases.
test("live P856 smoke query is not a curated named site",()=>{
  const smoke=readFileSync(new URL("../scripts/live-public-smoke.mjs",
    import.meta.url),"utf8");
  const match=smoke.match(/const unknown=await request\("\/api\/search\?nav=1&type=all&q="\+\s*encodeURIComponent\("([^"]+)"\)\)/);
  assert.ok(match,"live smoke must state its remote P856 query");
  assert.deepEqual(directorySites(match[1]),[],
    "a curated site bypasses Wikidata and invalidates the P856 smoke");
  assert.equal(earlyWikidataSiteEligible(match[1]),true);
  assert.match(smoke,/scope==="wikidata_P856_exact_name"/);
  assert.match(smoke,/candidate\.linkBasis==="wikidata_P856"/);
  assert.match(smoke,/\["unavailable","no_match"\]/);
});
