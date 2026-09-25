import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

const read=name=>readFile(new URL("../infra/searxng/"+name,import.meta.url),"utf8");

test("self-hosted SearXNG bundle is pinned, JSON-enabled and secret-safe",async()=>{
  const [settings,build,start,smoke,readme]=await Promise.all([
    read("settings.yml"),read("build.sh"),read("start.sh"),read("smoke.py"),read("README.md")
  ]);
  const pin="3cd69d30e2a78dfc817be9e349e7c2e4317c92e3";
  assert.match(build,new RegExp(pin));
  assert.match(build,/git -C "\$UPSTREAM" checkout --detach "\$PIN"/);
  assert.match(build,/granian/);
  assert.match(settings,/formats:\s*\n\s*- html\s*\n\s*- json/);
  assert.match(settings,/safe_search:\s*1/);
  assert.match(settings,/enable_metrics:\s*false/);
  assert.match(settings,/public_instance:\s*false/);
  assert.match(settings,/limiter:\s*false/);
  assert.match(start,/SEARXNG_SECRET:\?SEARXNG_SECRET is required/);
  assert.match(start,/SEARXNG_SETTINGS_PATH/);
  assert.match(start,/exec granian searx\.webapp:app/);
  assert.match(smoke,/format.*json/s);
  assert.match(smoke,/WAE_SEARCH_CORE_READY/);
  assert.doesNotMatch(settings,/[a-f0-9]{48,}/i,"no production secret may be committed");
  assert.doesNotMatch(start,/https:\/\/waeweb-search-core/i,"runtime URL must be supplied by Render");
  assert.match(readme,/startup-only loopback smoke check/i);
});
