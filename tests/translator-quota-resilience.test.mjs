import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {translateText} from "../server/translate.mjs";

test("a real MyMemory quota remains a truthful HTTP 429 and never invents translated text",async()=>{
  const prior=process.env.WAE_TRANSLATE_PROVIDER,old=globalThis.fetch;
  process.env.WAE_TRANSLATE_PROVIDER="mymemory";
  globalThis.fetch=async()=>new Response(JSON.stringify({
    responseStatus:429,responseDetails:"Daily limit reached",
    responseData:{translatedText:"fake success"}
  }),{status:200});
  try{
    await assert.rejects(translateText({
      text:"Prueba externa de cuota",source:"es",target:"en"
    }),err=>err.code==="provider_quota"&&err.status===429);
  }finally{
    prior===undefined?delete process.env.WAE_TRANSLATE_PROVIDER:process.env.WAE_TRANSLATE_PROVIDER=prior;
    globalThis.fetch=old;
  }
});
test("auto translator retries natively only after a quota failure, never claims a fake provider translation",()=>{
  const ui=readFileSync(new URL("../public/translator.js",import.meta.url),"utf8");
  const smoke=readFileSync(new URL("../scripts/live-public-smoke.mjs",import.meta.url),"utf8");
  assert.match(ui,/const quota=\/HTTP 429\|límite\|limite\|cuota\|quota\/i/);
  assert.match(ui,/engine!=="auto"\|\|!localAvailable\(\)/);
  assert.match(ui,/result=\{translatedText:await bounded/);
  assert.match(ui,/El proveedor gratuito alcanzó su cuota/);
  assert.match(smoke,/body\.code==="provider_quota"/);
  assert.match(smoke,/LIVE DEGRADED/);
  assert.match(smoke,/if\(!valid&&!providerQuota\)process\.exitCode=1/);
  assert.doesNotMatch(smoke,/LIVE RATE LIMIT \/api\/translate, retrying after one minute/);
});
