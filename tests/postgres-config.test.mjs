import test from "node:test";
import assert from "node:assert/strict";
import { postgresAccountsConfig } from "../server/accounts-postgres.mjs";

const local = {
  WAE_ACCOUNTS_STORE: "postgres",
  WAE_ACCOUNTS_DATABASE_URL: "postgresql://account:secret@127.0.0.1:5432/wae_test",
  WAE_POSTGRES_ALLOW_INSECURE_LOCAL_TEST: "true",
  NODE_ENV: "test"
};

test("Postgres account backend fails closed when TLS is absent in production", () => {
  assert.equal(postgresAccountsConfig({ ...local, NODE_ENV: "production" }), null);
  assert.equal(postgresAccountsConfig({ ...local, WAE_ACCOUNTS_STORE: "file" }), null);
  assert.equal(postgresAccountsConfig({ ...local, WAE_ACCOUNTS_DATABASE_URL: "" }), null);
  assert.equal(postgresAccountsConfig({ ...local, WAE_ACCOUNTS_DATABASE_URL:
    "postgresql://account:secret@example.org:5432/wae_test" }), null);
  assert.equal(postgresAccountsConfig({ ...local, WAE_ACCOUNTS_DATABASE_URL:
    "postgresql://account:secret@127.0.0.1/wae_test?sslmode=disable" }), null);
  assert.equal(postgresAccountsConfig({ ...local, WAE_ACCOUNTS_DATABASE_URL:
    "postgresql://account:secret@127.0.0.1/wae_test#fragment" }), null);
  assert.equal(postgresAccountsConfig({ ...local, WAE_ACCOUNTS_DATABASE_URL:
    "postgresql://account:%XX@127.0.0.1/wae_test" }), null);
  assert.equal(postgresAccountsConfig({ ...local, WAE_ACCOUNTS_DATABASE_URL:
    "postgresql://account:secret@127.0.0.1/wae_test%2Fanother" }), null);
});

test("Insecure test exception works on loopback only and production CA is verified", () => {
  const config = postgresAccountsConfig(local);
  assert.equal(config.ssl, false);
  assert.equal(config.database, "wae_test");
  assert.equal(config.max, 5);
  const ca = Buffer.from("-----BEGIN CERTIFICATE-----\nCI ONLY\n-----END CERTIFICATE-----").toString("base64");
  const prod = postgresAccountsConfig({
    ...local, NODE_ENV: "production", WAE_ACCOUNTS_PG_CA: ca,
    WAE_ACCOUNTS_DATABASE_URL: "postgresql://account:secret@db.example.org:5432/wae_test"
  });
  assert.equal(prod.ssl.rejectUnauthorized, true);
  assert.match(prod.ssl.ca, /BEGIN CERTIFICATE/);
});
