// Optional PostgreSQL-backed encrypted vault envelopes.
// Only opaque AES-256-GCM payloads are persisted. No public HTTP routes here.
import { postgresAccountsConfig } from "./accounts-postgres.mjs";
import { createHash } from "node:crypto";

const SCHEMA = `CREATE TABLE IF NOT EXISTS wae_vault_records (
  vault_hash CHAR(64) PRIMARY KEY,
  envelope TEXT NOT NULL,
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);`;
const vaultHash = id => createHash("sha256").update(id).digest("hex");
let pool;
let identifier;

export function vaultPostgresSelected(env = process.env) {
  return env.WAE_VAULT_STORE === "postgres";
}
export function vaultPostgresConfig(env = process.env) {
  if (!vaultPostgresSelected(env)) return null;
  // The same verified, operator-configured database and TLS settings may be
  // shared with the accounts store; choosing vault PostgreSQL is independent.
  return postgresAccountsConfig({ ...env, WAE_ACCOUNTS_STORE: "postgres" });
}
export const vaultPgSchema = SCHEMA;
async function getPool() {
  const config = vaultPostgresConfig();
  if (!config) throw new Error("PostgreSQL de bóvedas no configurado.");
  const key = JSON.stringify([process.env.WAE_ACCOUNTS_DATABASE_URL,
    process.env.WAE_ACCOUNTS_PG_CA, process.env.WAE_POSTGRES_ALLOW_INSECURE_LOCAL_TEST]);
  if (pool && key === identifier) return pool;
  if (pool) await pool.end();
  const { default: pg } = await import("pg");
  pool = new pg.Pool(config);
  identifier = key;
  return pool;
}
export async function initializeVaultPostgres() {
  await (await getPool()).query(SCHEMA);
}
export async function readVaultPostgres(id) {
  const { rows } = await (await getPool()).query(
    "SELECT envelope FROM wae_vault_records WHERE vault_hash = $1", [vaultHash(id)]);
  return rows.length ? rows[0].envelope : null;
}
export async function mutateVaultPostgres(id, operation) {
  const client = await (await getPool()).connect();
  let started = false;
  try {
    await client.query("BEGIN");
    started = true;
    // Advisory locks protect the first insertion even when no row exists yet.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [vaultHash(id)]);
    const { rows } = await client.query(
      "SELECT envelope FROM wae_vault_records WHERE vault_hash = $1 FOR UPDATE", [vaultHash(id)]);
    const outcome = await operation(rows[0]?.envelope ?? null);
    if (typeof outcome?.envelope !== "string") throw new Error("Sobre de bóveda inválido.");
    await client.query(
      `INSERT INTO wae_vault_records(vault_hash, envelope) VALUES($1, $2)
       ON CONFLICT(vault_hash) DO UPDATE SET envelope = EXCLUDED.envelope,
         revision = wae_vault_records.revision + 1, updated_at = NOW()`,
      [vaultHash(id), outcome.envelope]);
    await client.query("COMMIT");
    started = false;
    return outcome.result;
  } catch (error) {
    if (started) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally { client.release(); }
}
export async function closeVaultPostgres() {
  if (pool) await pool.end();
  pool = undefined;
  identifier = undefined;
}
