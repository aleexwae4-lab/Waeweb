import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  initializeAccountsPostgres, closeAccountsPostgres, readAccountsPostgres,
  postgresAccountsConfig
} from "../server/accounts-postgres.mjs";
import {
  accountsEnabled, registerAccount, loginAccount, getAccount,
  logoutAccount, addBusiness, updateBusinessVisibility,
  listPublicBusinesses, addMarketListing, setMarketListingVisibility,
  getPublicMarketCatalog, browseMarketplace
} from "../server/accounts.mjs";

const exec = promisify(execFile);
const enabled = process.env.WAE_PG_INTEGRATION === "true";

test("real PostgreSQL preserves encrypted accounts and serialized mutations across processes", {
  skip: !enabled
}, async () => {
  assert.equal(process.env.NODE_ENV, "test");
  assert.ok(postgresAccountsConfig());
  assert.equal(accountsEnabled(), true);
  const key = process.env.WAE_ACCOUNTS_KEY;
  assert.ok(key && key.length === 64);

  // An absent schema fails closed; deployment NEVER fabricates empty accounts.
  await assert.rejects(() => getAccount("Bearer " + "a".repeat(43)),
    { code: "storage_failure" });
  await initializeAccountsPostgres();

  const alice = await registerAccount({
    name: "Almacén de prueba", email: "postgres-owner@example.test",
    password: "Secure-Test-Password-2026-Account"
  });
  assert.equal((await getAccount("Bearer " + alice.token)).id, alice.user.id);
  const encrypted = await readAccountsPostgres();
  assert.match(encrypted, /"AES-256-GCM"/);
  assert.doesNotMatch(encrypted, /postgres-owner@example|Secure-Test-Password/);

  const workerCode = `import { registerAccount, getAccount } from "./server/accounts.mjs";
import { closeAccountsPostgres } from "./server/accounts-postgres.mjs";
const owner = await getAccount("Bearer " + process.env.WAE_TEST_BEARER);
const result = await registerAccount({
  name: "Trabajador independiente", email: process.env.WAE_TEST_EMAIL,
  password: "Secure-Test-Password-2026-Worker"
});
console.log(JSON.stringify({ owner: owner.id, registered: result.user.email }));
await closeAccountsPostgres();`;
  const jobs = Array.from({ length: 4 }, (_, index) => exec(process.execPath,
    ["--input-type=module", "-e", workerCode], {
      env: { ...process.env, WAE_TEST_BEARER: alice.token,
        WAE_TEST_EMAIL: "postgres-worker-" + index + "@example.test" },
      maxBuffer: 128 * 1024
    }));
  const results = await Promise.all(jobs);
  for (let i = 0; i < results.length; i++) {
    const data = JSON.parse(results[i].stdout.trim());
    assert.equal(data.owner, alice.user.id);
    assert.equal(data.registered, "postgres-worker-" + i + "@example.test");
  }
  for (let i = 0; i < results.length; i++) {
    const worker = await loginAccount({
      email: "postgres-worker-" + i + "@example.test",
      password: "Secure-Test-Password-2026-Worker"
    });
    assert.ok(worker.token);
  }

  const business = await addBusiness("Bearer " + alice.token, {
    name: "Negocio persistente", category: "Tecnología", city: "Guadalajara"
  });
  assert.equal((await updateBusinessVisibility("Bearer " + alice.token, business.id, true)).visibility, "public");
  assert.equal((await listPublicBusinesses("Negocio persistente")).businesses[0].id, business.id);
  const listing = await addMarketListing("Bearer " + alice.token,business.id,{
    kind:"service",title:"Consultoría avanzada",category:"Tecnología",
    description:"Servicio de tecnología con persistencia cifrada.",
    price:"2499.00",availability:"available"
  });
  assert.equal((await browseMarketplace({q:"consultoría"})).total,0,
    "private listing must never leak through PostgreSQL");
  await setMarketListingVisibility("Bearer " + alice.token,business.id,listing.id,true);
  assert.equal((await getPublicMarketCatalog(business.id)).items[0].priceCents,249900);
  const catalogWorker = `import { browseMarketplace } from "./server/accounts.mjs";
import { closeAccountsPostgres } from "./server/accounts-postgres.mjs";
const result=await browseMarketplace({q:"Consultoría",kind:"service",city:"Guadalajara"});
console.log(JSON.stringify({count:result.total,price:result.items[0]?.priceCents}));
await closeAccountsPostgres();`;
  const crossProcess=await exec(process.execPath,["--input-type=module","-e",catalogWorker],{
    env:{...process.env},maxBuffer:128*1024
  });
  assert.deepEqual(JSON.parse(crossProcess.stdout.trim()),{count:1,price:249900});

  await logoutAccount("Bearer " + alice.token);
  await assert.rejects(() => getAccount("Bearer " + alice.token),
    { code: "not_authenticated" });

  process.env.WAE_ACCOUNTS_KEY = createHash("sha256").update("wrong key").digest("hex");
  try {
    await assert.rejects(() => listPublicBusinesses("Negocio"), { code: "decrypt_failed" });
  } finally { process.env.WAE_ACCOUNTS_KEY = key; }
  assert.equal((await listPublicBusinesses("Negocio")).resultCount, 1);
  await closeAccountsPostgres();
});
