// Opt-in encrypted PostgreSQL record store for accounts/businesses/promotions.
// No schema creation, filesystem fallback, or implicit migration at runtime.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS wae_accounts_record (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  envelope TEXT,
  revision BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO wae_accounts_record (id, envelope) VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;`;

let pool;
let configuredFor;

export function postgresAccountsSelected(env = process.env) {
  return env.WAE_ACCOUNTS_STORE === "postgres";
}

export function postgresAccountsConfig(env = process.env) {
  if (!postgresAccountsSelected(env)) return null;
  if (typeof env.WAE_ACCOUNTS_DATABASE_URL !== "string" || !env.WAE_ACCOUNTS_DATABASE_URL) return null;
  let parsed;
  try { parsed = new URL(env.WAE_ACCOUNTS_DATABASE_URL); } catch { return null; }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol) ||
      !parsed.hostname || !parsed.username || !parsed.password ||
      !parsed.pathname || parsed.pathname === "/" ||
      (parsed.hash && parsed.hash.length > 0)) return null;
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(hostname);
  const insecureLocalTest = env.NODE_ENV === "test" &&
    env.WAE_POSTGRES_ALLOW_INSECURE_LOCAL_TEST === "true" && local;
  if (parsed.search || !insecureLocalTest && !env.WAE_ACCOUNTS_PG_CA) {
    // CA pinning is required for production; URL query parameters are rejected
    // so sslmode and other driver options cannot weaken this setting.
    return null;
  }
  let ca;
  if (!insecureLocalTest) {
    try {
      ca = Buffer.from(env.WAE_ACCOUNTS_PG_CA, "base64").toString("utf8");
      if (!ca.includes("-----BEGIN CERTIFICATE-----")) return null;
    } catch { return null; }
  }
  try {
    const user = decodeURIComponent(parsed.username);
    const password = decodeURIComponent(parsed.password);
    const database = decodeURIComponent(parsed.pathname.slice(1));
    if (!user || !password || !database || database.includes("/") ||
        /[\\\\\\u0000-\\u001f\\u007f]/.test(database)) return null;
    return {
      host: hostname, port: parsed.port ? Number(parsed.port) : 5432,
      user, password, database,
      ssl: insecureLocalTest ? false : { ca, rejectUnauthorized: true },
      max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 10000,
      statement_timeout: 10000
    };
  } catch { return null; }
}
export const accountsPgSchema = SCHEMA;

async function getPool() {
  const config = postgresAccountsConfig();
  if (!config) throw Error("PostgreSQL cifrado no configurado.");
  const identifier = process.env.WAE_ACCOUNTS_DATABASE_URL + ":" +
    (process.env.WAE_ACCOUNTS_PG_CA || "") + ":" +
    (process.env.WAE_POSTGRES_ALLOW_INSECURE_LOCAL_TEST || "");
  if (pool && configuredFor === identifier) return pool;
  if (pool) await pool.end();
  const { default: pg } = await import("pg");
  pool = new pg.Pool(config);
  configuredFor = identifier;
  return pool;
}

export async function initializeAccountsPostgres() {
  const connection = await getPool();
  await connection.query(SCHEMA);
}

export async function readAccountsPostgres() {
  const connection = await getPool();
  const { rows } = await connection.query("SELECT envelope FROM wae_accounts_record WHERE id = 1");
  if (rows.length !== 1) throw Error("El almacén PostgreSQL no está inicializado.");
  return rows[0].envelope;
}

export async function mutateAccountsPostgres(operation) {
  const connection = await getPool();
  const client = await connection.connect();
  let started = false;
  try {
    await client.query("BEGIN");
    started = true;
    const { rows } = await client.query(
      "SELECT envelope FROM wae_accounts_record WHERE id = 1 FOR UPDATE");
    if (rows.length !== 1) throw Error("El almacén PostgreSQL no está inicializado.");
    const outcome = await operation(rows[0].envelope);
    if (typeof outcome?.envelope !== "string") throw Error("Actualización cifrada inválida.");
    await client.query(
      "UPDATE wae_accounts_record SET envelope = $1, revision = revision + 1, updated_at = NOW() WHERE id = 1",
      [outcome.envelope]);
    await client.query("COMMIT");
    started = false;
    return outcome.result;
  } catch (error) {
    if (started) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function closeAccountsPostgres() {
  if (pool) await pool.end();
  pool = undefined;
  configuredFor = undefined;
}
