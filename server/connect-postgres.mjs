// Shared, fail-closed admission for WAEWEB Connect across Node/Render/Vercel replicas.
// Uses the same verified TLS PostgreSQL connection as the optional encrypted stores,
// but separate tables with no access to account or vault contents.
import { randomUUID } from "node:crypto";
import { postgresAccountsConfig } from "./accounts-postgres.mjs";
import { requiresDurableStorage } from "./hosting.mjs";

const SCHEMA = `CREATE TABLE IF NOT EXISTS wae_connect_quota (
  client_id VARCHAR(40) PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0)
);
CREATE TABLE IF NOT EXISTS wae_connect_lease (
  lease_id UUID PRIMARY KEY,
  client_id VARCHAR(40) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS wae_connect_lease_client_expiry
ON wae_connect_lease(client_id, expires_at);`;
let pool;
let poolKey;
export const connectPgSchema=SCHEMA;

export function connectAdmissionConfig(env=process.env) {
  if (env.WAE_CONNECT_ADMISSION_MODE!=="postgres") return null;
  return postgresAccountsConfig({...env,WAE_ACCOUNTS_STORE:"postgres"});
}
export function connectAdmissionReady(env=process.env) {
  const mode=env.WAE_CONNECT_ADMISSION_MODE||"local";
  if (mode==="postgres") return Boolean(connectAdmissionConfig(env));
  // A process-local Map does not enforce global quotas when replicated.
  return mode==="local" && !requiresDurableStorage(env) &&
    ["development","test"].includes(env.NODE_ENV);
}
async function getPool() {
  const cfg=connectAdmissionConfig();
  if (!cfg) throw new Error("WAEWEB Connect PostgreSQL admission not configured");
  const nextKey=JSON.stringify([process.env.WAE_ACCOUNTS_DATABASE_URL,
    process.env.WAE_ACCOUNTS_PG_CA,process.env.WAE_POSTGRES_ALLOW_INSECURE_LOCAL_TEST]);
  if (pool && poolKey===nextKey) return pool;
  if (pool) await pool.end();
  const {default:pg}=await import("pg");
  pool=new pg.Pool(cfg);
  poolKey=nextKey;
  return pool;
}
export async function initializeConnectPostgres() {
  await (await getPool()).query(SCHEMA);
}
export async function acquireConnectPostgres(clientId) {
  if (!["inteligenciauniversal","universal-core-vt3h","waeosgreen"].includes(clientId))
    throw new Error("Unknown Connect client");
  const connection=await (await getPool()).connect();
  let began=false;
  const leaseId=randomUUID();
  try {
    await connection.query("BEGIN");began=true;
    await connection.query(
      "INSERT INTO wae_connect_quota(client_id) VALUES($1) ON CONFLICT DO NOTHING",
      [clientId]);
    const {rows}=await connection.query(
      `SELECT request_count,
        window_start <= clock_timestamp() - INTERVAL '60 seconds' AS expired
       FROM wae_connect_quota WHERE client_id=$1 FOR UPDATE`,[clientId]);
    if (rows.length!==1) throw new Error("Connect quota schema unavailable");
    // All replicas serialize this client's quota under the same row lock.
    const nextCount=rows[0].expired?1:rows[0].request_count+1;
    if (nextCount>20) {
      await connection.query("ROLLBACK");began=false;
      return {ok:false,reason:"connect_rate_limited"};
    }
    await connection.query(
      "DELETE FROM wae_connect_lease WHERE client_id=$1 AND expires_at<=clock_timestamp()",
      [clientId]);
    const {rows:active}=await connection.query(
      `SELECT count(*)::int AS active FROM wae_connect_lease
       WHERE client_id=$1 AND expires_at>clock_timestamp()`,[clientId]);
    if (active[0].active>=3) {
      await connection.query("ROLLBACK");began=false;
      return {ok:false,reason:"connect_concurrency_limited"};
    }
    await connection.query(
      `UPDATE wae_connect_quota SET request_count=$2,
       window_start=CASE WHEN $3::boolean THEN clock_timestamp() ELSE window_start END
       WHERE client_id=$1`,[clientId,nextCount,rows[0].expired]);
    await connection.query(
      `INSERT INTO wae_connect_lease(lease_id,client_id,expires_at)
       VALUES($1,$2,clock_timestamp()+INTERVAL '45 seconds')`,
      [leaseId,clientId]);
    await connection.query("COMMIT");began=false;
    return {ok:true,release:async()=> {
      await (await getPool()).query(
        "DELETE FROM wae_connect_lease WHERE lease_id=$1 AND client_id=$2",
        [leaseId,clientId]);
    }};
  }catch(error){
    if (began) await connection.query("ROLLBACK").catch(()=>{});
    throw error;
  }finally{connection.release();}
}
export async function closeConnectPostgres() {
  if (pool) await pool.end();
  pool=undefined;poolKey=undefined;
}
