import test from "node:test";
import assert from "node:assert/strict";
import {guardedProvider,providerCircuitSnapshot,ProviderCircuitOpenError,
  resetProviderResilience} from "../server/provider-resilience.mjs";
import {searxngWeb,searxngInfrastructureStatus} from "../server/web-providers.mjs";

test("provider resilience opens a bounded circuit and reports sanitized passive health",async()=>{
  resetProviderResilience("unit-provider");
  let calls=0;
  const fail=()=>guardedProvider("unit-provider",async()=>{
    calls++;const e=Error("upstream unavailable");e.code="upstream_503";throw e;
  },{threshold:2,cooldownMs:5000});
  await assert.rejects(fail(),/upstream unavailable/);
  assert.equal(providerCircuitSnapshot("unit-provider").state,"degraded");
  await assert.rejects(fail(),/upstream unavailable/);
  const open=providerCircuitSnapshot("unit-provider");
  assert.equal(open.state,"circuit_open");
  assert.ok(open.retryAfterSeconds>0);
  await assert.rejects(fail(),e=>e instanceof ProviderCircuitOpenError);
  assert.equal(calls,2,"open circuit must fail fast without another upstream request");
  resetProviderResilience("unit-provider");
  assert.equal((await guardedProvider("unit-provider",async()=>"ok")),"ok");
  assert.equal(providerCircuitSnapshot("unit-provider").state,"healthy");
});

test("SearXNG uses the shared circuit without exposing the operator URL",async()=>{
  const old=process.env.WAE_SEARXNG_URL,fetchOld=globalThis.fetch;
  resetProviderResilience("searxng");
  process.env.WAE_SEARXNG_URL="https://search.example.org";
  let calls=0;
  globalThis.fetch=async()=>{calls++;return new Response("busy",{status:503});};
  try{
    const before=searxngInfrastructureStatus();
    assert.equal(before.configured,true);
    assert.equal(before.mode,"operator_controlled");
    assert.equal(JSON.stringify(before).includes("search.example.org"),false);
    await assert.rejects(searxngWeb("wae"));
    await assert.rejects(searxngWeb("wae"));
    assert.equal(searxngInfrastructureStatus().state,"circuit_open");
    await assert.rejects(searxngWeb("wae"),e=>e.code==="searxng_circuit_open");
    assert.equal(calls,2);
  }finally{
    globalThis.fetch=fetchOld;resetProviderResilience("searxng");
    if(old===undefined)delete process.env.WAE_SEARXNG_URL;else process.env.WAE_SEARXNG_URL=old;
  }
});
