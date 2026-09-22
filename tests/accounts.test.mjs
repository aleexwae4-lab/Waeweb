import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  accountsEnabled, registerAccount, loginAccount, getAccount,
  logoutAccount, listBusinesses, addBusiness, deleteBusiness, updateBusinessVisibility, listPublicBusinesses, AccountError
} from "../server/accounts.mjs";
import { handler } from "../server/index.mjs";

const key = "ab".repeat(32); // Only a synthetic test fixture. Never use in production.
process.env.WAE_ACCOUNTS_ENABLED = "true";
process.env.WAE_ACCOUNTS_KEY = key;
const alice = { name: "Alicia Pruebas", email: "alice@example.test", password: "An-Example-Secret-Passphrase-2026" };
const bob = { name: "Roberto Pruebas", email: "bob@example.test", password: "Another-Example-Secret-Passphrase" };
const auth = token => ({ authorization: "Bearer " + token });
async function fixtureDir() { return mkdtemp(join(tmpdir(), "wae-account-test-")); }

test("registration, password hashing and encrypted account store survive subsequent loads", async () => {
  const dir = await fixtureDir();
  try {
    const registered = await registerAccount(alice, dir);
    assert.equal(registered.user.email, alice.email);
    assert.ok(registered.token.length >= 43);
    assert.equal(registered.user.passwordHash, undefined);
    assert.deepEqual(await getAccount("Bearer " + registered.token, dir), registered.user);
    const filenames = await readdir(dir);
    assert.deepEqual(filenames, ["accounts.encrypted.json"]);
    const raw = await readFile(join(dir, filenames[0]), "utf8");
    assert.equal(JSON.parse(raw).algorithm, "AES-256-GCM");
    assert.doesNotMatch(raw, /alice@example|Example-Secret-Passphrase|Alicia Pruebas/);
    const logged = await loginAccount({ email: "ALICE@example.test", password: alice.password }, dir);
    assert.equal(logged.user.id, registered.user.id);
    assert.notEqual(logged.token, registered.token);
    await logoutAccount("Bearer " + registered.token, dir);
    await assert.rejects(() => getAccount("Bearer " + registered.token, dir), { code: "not_authenticated" });
    assert.equal((await getAccount("Bearer " + logged.token, dir)).email, alice.email);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("reject duplicate email, invalid password, unknown account, and no account enumeration on bad login", async () => {
  const dir = await fixtureDir();
  try {
    await registerAccount(alice, dir);
    await assert.rejects(() => registerAccount({ ...alice, email: "ALICE@example.test" }, dir), { code: "email_registered" });
    await assert.rejects(() => registerAccount({ ...alice, email: "new@example.test", password: "short" }, dir), { code: "invalid_input" });
    await assert.rejects(() => loginAccount({ ...alice, password: "wrong-password-value" }, dir), { code: "invalid_credentials" });
    await assert.rejects(() => loginAccount({ email: "unknown@example.test", password: alice.password }, dir), { code: "invalid_credentials" });
    await assert.rejects(() => getAccount("Bearer " + "x".repeat(43), dir), { code: "not_authenticated" });
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("businesses are owner-only, private and self-declared; validation and deletion enforce ownership", async () => {
  const dir = await fixtureDir();
  try {
    const a = await registerAccount(alice, dir), b = await registerAccount(bob, dir);
    const entry = await addBusiness("Bearer " + a.token, {
      name: "Taller de Prueba", category: "Tecnología", city: "Guadalajara",
      website: "https://business.example.test/", description: "Servicios digitales"
    }, dir);
    assert.equal(entry.status, "self_declared");
    assert.equal(entry.visibility, "owner_only");
    assert.equal((await listBusinesses("Bearer " + a.token, dir)).businesses.length, 1);
    assert.equal((await listBusinesses("Bearer " + b.token, dir)).businesses.length, 0);
    assert.equal((await listPublicBusinesses("Taller Guadalajara", dir)).resultCount, 0);
    await assert.rejects(() => updateBusinessVisibility("Bearer " + b.token, entry.id, true, dir), { code: "business_missing" });
    const published = await updateBusinessVisibility("Bearer " + a.token, entry.id, true, dir);
    assert.equal(published.visibility, "public");
    const directory = await listPublicBusinesses("Taller Guadalajara", dir);
    assert.equal(directory.resultCount, 1);
    assert.equal(directory.businesses[0].verification, "self_declared");
    assert.equal(directory.businesses[0].name, "Taller de Prueba");
    assert.equal(directory.businesses[0].email, undefined);
    assert.equal(directory.businesses[0].ownerId, undefined);
    await updateBusinessVisibility("Bearer " + a.token, entry.id, false, dir);
    assert.equal((await listPublicBusinesses("Taller", dir)).resultCount, 0);
    await assert.rejects(() => deleteBusiness("Bearer " + b.token, entry.id, dir), { code: "business_missing" });
    await assert.rejects(() => addBusiness("Bearer " + a.token, {
      name: "Invalid", category: "Tech", city: "Mexico City", website: "javascript:alert(1)"
    }, dir), { code: "invalid_website" });
    assert.equal((await listBusinesses("Bearer " + a.token, dir)).businesses.length, 1);
    await deleteBusiness("Bearer " + a.token, entry.id, dir);
    assert.equal((await listBusinesses("Bearer " + a.token, dir)).businesses.length, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("simultaneous registrations and business updates avoid lost writes", async () => {
  const dir = await fixtureDir();
  try {
    const identities = await Promise.all(
      Array.from({ length: 8 }, (_, i) => registerAccount({
        name: "Persona " + i, email: "person" + i + "@example.test", password: "Suitable-Passphrase-For-Test-" + i
      }, dir))
    );
    const account = identities[0].token;
    const saved = await Promise.all(Array.from({ length: 12 }, (_, i) => addBusiness("Bearer " + account, {
      name: "Negocio digital " + i, category: "Industria digital", city: "Zapopan"
    }, dir)));
    assert.equal(new Set(saved.map(x => x.id)).size, 12);
    assert.equal((await listBusinesses("Bearer " + account, dir)).businesses.length, 12);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("HTTP account and business routes work with bearer auth; public service remains separate", async () => {
  const dir = await fixtureDir();
  const previous = { enabled: process.env.WAE_ACCOUNTS_ENABLED, key: process.env.WAE_ACCOUNTS_KEY,
    directory: process.env.WAE_ACCOUNTS_DIR };
  process.env.WAE_ACCOUNTS_DIR = dir;
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port;
  async function post(path, value, headers = {}) {
    return fetch(base + path, { method: "POST",
      headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
  }
  try {
    assert.equal((await (await fetch(base + "/api/capabilities")).json()).accountsEnabled, true);
    const ui = await fetch(base + "/accounts.js");
    assert.equal(ui.status, 200);
    assert.match(await ui.text(), /business-dashboard/);
    assert.equal((await fetch(base + "/api/account/me")).status, 401);
    const response = await post("/api/account/register", alice);
    assert.equal(response.status, 201);
    const { token, user } = await response.json();
    assert.equal(user.email, alice.email);
    assert.equal((await post("/api/account/register", alice)).status, 409);
    assert.equal((await post("/api/account/login", { email: alice.email, password: "Not-the-right-password" })).status, 401);
    assert.equal((await (await fetch(base + "/api/account/me", { headers: auth(token) })).json()).user.id, user.id);
    assert.equal((await fetch(base + "/api/businesses")).status, 401);
    assert.equal((await (await fetch(base + "/api/businesses/public?q=WAE")).json()).resultCount, 0);
    const created = await post("/api/businesses", {
      name: "WAE Business", category: "Inteligencia Artificial", city: "Zapopan"
    }, auth(token));
    assert.equal(created.status, 201);
    const business = (await created.json()).business;
    assert.equal((await (await fetch(base + "/api/businesses", { headers: auth(token) })).json()).businesses.length, 1);
    assert.equal((await (await fetch(base + "/api/businesses/public?q=WAE")).json()).resultCount, 0);
    const published = await fetch(base + "/api/businesses/" + business.id, {
      method: "PATCH", headers: { ...auth(token), "content-type": "application/json" },
      body: JSON.stringify({ published: true })
    });
    assert.equal(published.status, 200);
    const listing = await (await fetch(base + "/api/businesses/public?q=Artificial%20Zapopan")).json();
    assert.equal(listing.resultCount, 1);
    assert.equal(listing.businesses[0].name, "WAE Business");
    assert.equal(listing.businesses[0].email, undefined);
    assert.equal((await fetch(base + "/api/businesses/" + business.id, {
      method: "DELETE", headers: auth("x".repeat(43))
    })).status, 401);
    assert.equal((await fetch(base + "/api/businesses/" + business.id, {
      method: "DELETE", headers: auth(token)
    })).status, 200);
    assert.equal((await (await fetch(base + "/api/businesses/public?q=WAE")).json()).resultCount, 0);
    assert.equal((await post("/api/account/logout", {}, auth(token))).status, 200);
    assert.equal((await fetch(base + "/api/account/me", { headers: auth(token) })).status, 401);
    delete process.env.WAE_ACCOUNTS_KEY;
    assert.equal((await fetch(base + "/api/account/me")).status, 503);
  } finally {
    await new Promise(resolve => server.close(resolve));
    process.env.WAE_ACCOUNTS_ENABLED = previous.enabled;
    process.env.WAE_ACCOUNTS_KEY = previous.key;
    if (previous.directory === undefined) delete process.env.WAE_ACCOUNTS_DIR;
    else process.env.WAE_ACCOUNTS_DIR = previous.directory;
    await rm(dir, { recursive: true, force: true });
  }
});
