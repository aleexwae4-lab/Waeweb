import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { connectAdmissionConfig, connectAdmissionReady, initializeConnectPostgres,
  acquireConnectPostgres, closeConnectPostgres } from "../server/connect-postgres.mjs";
import { connectConfig } from "../server/connect.mjs";

const exec=promisify(execFile);
const enabled=process.env.WAE_PG_INTEGRATION==="true";
const one="inteligenciauniversal",two="universal-core-vt3h",three="waeosgreen";

test("real PostgreSQL enforces Connect concurrency and quotas across independent processes",{
  skip:!enabled
},async()=>{
  assert.equal(process.env.NODE_ENV,"test");
  assert.ok(connectAdmissionConfig());
  assert.ok(connectConfig());
  assert.equal(connectAdmissionReady({...process.env,NODE_ENV:"production",
    WAE_CONNECT_ADMISSION_MODE:"local"}),false);
  assert.equal(connectConfig({...process.env,NODE_ENV:"production",
    WAE_CONNECT_ADMISSION_MODE:"local"}),null);

  // Schema absent: the Connect endpoint must reject work rather than fall back.
  await assert.rejects(()=>acquireConnectPostgres(one));
  await initializeConnectPostgres();

  const worker=`import { acquireConnectPostgres,closeConnectPostgres } from "./server/connect-postgres.mjs";
const id=process.env.WAE_CONNECT_TEST_ID;
const amount=Number(process.env.WAE_CONNECT_TEST_ATTEMPTS);
const hold=process.env.WAE_CONNECT_TEST_HOLD==="true";
const leases=[];const results=[];
for(let i=0;i<amount;i++){
  const r=await acquireConnectPostgres(id);
  results.push(r.ok?"ok":r.reason);
  if(r.ok){
    if(hold)leases.push(r);
    else await r.release();
  }
}
console.log(JSON.stringify(results));
if(hold)await new Promise(resolve=>setTimeout(resolve,600));
for(const lease of leases)await lease.release();
await closeConnectPostgres();`;

  // Four independent writers race for exactly three global leases.
  const competing=await Promise.all(Array.from({length:4},()=>exec(process.execPath,
    ["--input-type=module","-e",worker],{
      env:{...process.env,WAE_CONNECT_TEST_ID:one,
        WAE_CONNECT_TEST_ATTEMPTS:"1",WAE_CONNECT_TEST_HOLD:"true"},
      maxBuffer:65536
    })));
  const outcomes=competing.flatMap(x=>JSON.parse(x.stdout.trim()));
  assert.equal(outcomes.filter(x=>x==="ok").length,3);
  assert.equal(outcomes.filter(x=>x==="connect_concurrency_limited").length,1);
  const recovered=await acquireConnectPostgres(one);
  assert.equal(recovered.ok,true,"released leases make a new slot available");
  await recovered.release();

  // Five independent processes collectively consume a separate client's
  // 20/minute budget; 28 attempts cannot each receive a fresh local budget.
  const jobs=await Promise.all(Array.from({length:4},()=>exec(process.execPath,
    ["--input-type=module","-e",worker],{
      env:{...process.env,WAE_CONNECT_TEST_ID:two,
        WAE_CONNECT_TEST_ATTEMPTS:"7",WAE_CONNECT_TEST_HOLD:"false"},
      maxBuffer:65536
    })));
  const quota=jobs.flatMap(x=>JSON.parse(x.stdout.trim()));
  assert.equal(quota.filter(x=>x==="ok").length,20);
  assert.equal(quota.filter(x=>x==="connect_rate_limited").length,8);
  assert.equal((await acquireConnectPostgres(two)).reason,"connect_rate_limited");

  const third=await acquireConnectPostgres(three);
  assert.equal(third.ok,true,"the third system has a separate budget");
  await third.release();
  await closeConnectPostgres();
});
