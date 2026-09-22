// Storage-only preflight for an operator, never an HTTP endpoint.
// Does NOT create tables, change records, install secrets or approve deployment.
import {createHash} from "node:crypto";
import {postgresAccountsConfig} from "./accounts-postgres.mjs";
import {vaultConfig,decodeEncryptedVault} from "./vault.mjs";
import {vaultKeysConfig,encryptionReady,openVaultEnvelope} from "./crypto.mjs";
import {accountKey} from "./accounts.mjs";
import {connectConfig} from "./connect.mjs";

const verified=id=>({id,status:"passed"});
const blocked=id=>({id,status:"blocked"});
export function assessStoragePrerequisites(env=process.env) {
  const configured=postgresAccountsConfig({...env,WAE_ACCOUNTS_STORE:"postgres"});
  const vaults=vaultConfig(env.WAE_VAULTS_JSON);
  const keys=vaultKeysConfig(env.WAE_VAULT_KEYS_JSON);
  const checks=[
    env.WAE_ACCOUNTS_ENABLED==="true" && env.WAE_ACCOUNTS_STORE==="postgres" &&
      /^[a-f\d]{64}$/i.test(env.WAE_ACCOUNTS_KEY||"") && configured
      ?verified("encrypted_accounts"):blocked("encrypted_accounts"),
    env.WAE_READER_ENABLED==="true" && env.WAE_VAULT_STORE==="postgres" &&
      encryptionReady(vaults,keys) && configured
      ?verified("isolated_vaults"):blocked("isolated_vaults"),
    env.WAE_CONNECT_ADMISSION_MODE==="postgres" && Boolean(connectConfig(env)) &&
      configured ?verified("distributed_connect"):blocked("distributed_connect")
  ];
  return {ready:checks.every(c=>c.status==="passed"),
    scope:"storage_only",releaseApproval:"not_evaluated",checks};
}
export async function probeStorageReadiness() {
  const result=assessStoragePrerequisites();
  if(!result.ready)return result;
  let client,started=false;
  try{
    const {default:pg}=await import("pg");
    const config=postgresAccountsConfig({...process.env,WAE_ACCOUNTS_STORE:"postgres"});
    client=new pg.Client(config);
    await client.connect();
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    started=true;
    const {rows:accounts}=await client.query(
      "SELECT envelope FROM wae_accounts_record WHERE id=1");
    if(accounts.length!==1)throw Error("accounts_schema_missing");
    const raw=accounts[0].envelope;
    if(raw!==null){
      if(typeof raw!=="string"||Buffer.byteLength(raw)>4*1024*1024)
        throw Error("accounts_envelope_invalid");
      const data=openVaultEnvelope("accounts",JSON.parse(raw),
        accountKey(process.env.WAE_ACCOUNTS_KEY));
      if(data?.version!==1||!Array.isArray(data.users)||data.users.length>500)
        throw Error("accounts_payload_invalid");
    }
    const ids=vaultConfig(process.env.WAE_VAULTS_JSON);
    const byHash=new Map([...ids.keys()].map(id=>[
      createHash("sha256").update(id).digest("hex"),id
    ]));
    const {rows:vaults}=await client.query(
      "SELECT vault_hash,envelope FROM wae_vault_records ORDER BY vault_hash");
    if(vaults.length>ids.size)throw Error("unknown_vault_records");
    for(const row of vaults){
      const id=byHash.get(row.vault_hash);
      if(!id||typeof row.envelope!=="string"||
        Buffer.byteLength(row.envelope)>3*1024*1024)
        throw Error("unavailable_vault_key");
      decodeEncryptedVault(id,JSON.parse(row.envelope));
    }
    // Verify both quota tables exist WITHOUT consuming a client's budget.
    await client.query("SELECT client_id FROM wae_connect_quota LIMIT 0");
    await client.query("SELECT lease_id FROM wae_connect_lease LIMIT 0");
    await client.query("COMMIT");started=false;
    return {...result,checks:result.checks.map(c=>({...c,dbVerified:true}))};
  }catch{
    if(started&&client)await client.query("ROLLBACK").catch(()=>{});
    return {...result,ready:false,checks:result.checks.map(c=>({
      id:c.id,status:"blocked",dbVerified:false
    })),reason:"storage_probe_failed"};
  }finally{if(client)await client.end().catch(()=>{});}
}
