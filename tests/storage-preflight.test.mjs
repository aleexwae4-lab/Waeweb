import test from "node:test";
import assert from "node:assert/strict";
import {assessStoragePrerequisites} from "../server/storage-preflight.mjs";

const env={
  NODE_ENV:"test",
  WAE_ACCOUNTS_ENABLED:"true",
  WAE_ACCOUNTS_STORE:"postgres",
  WAE_ACCOUNTS_KEY:"ab".repeat(32),
  WAE_ACCOUNTS_DATABASE_URL:"postgresql://wae_user:local-ci-private@127.0.0.1/wae_test",
  WAE_POSTGRES_ALLOW_INSECURE_LOCAL_TEST:"true",
  WAE_READER_ENABLED:"true",
  WAE_VAULT_STORE:"postgres",
  WAE_VAULTS_JSON:JSON.stringify({org_alpha:"independent-test-vault-token-"+"X".repeat(35)}),
  WAE_VAULT_KEYS_JSON:JSON.stringify({org_alpha:"cd".repeat(32)}),
  WAE_CONNECT_ENABLED:"true",
  WAE_CONNECT_ADMISSION_MODE:"postgres",
  WAE_CONNECT_CLIENTS_JSON:JSON.stringify({
    inteligenciauniversal:"independent-test-connect-token-"+"Z".repeat(35)
  })
};
test("read-only storage preflight shows scope but no credentials or endpoint",()=>{
  const ready=assessStoragePrerequisites(env);
  assert.equal(ready.ready,true);
  assert.equal(ready.scope,"storage_only");
  assert.equal(ready.releaseApproval,"not_evaluated");
  assert.deepEqual(ready.checks.map(x=>x.id),[
    "encrypted_accounts","isolated_vaults","distributed_connect"]);
  const serialized=JSON.stringify(ready);
  for(const secret of [env.WAE_ACCOUNTS_KEY,
    env.WAE_ACCOUNTS_DATABASE_URL,env.WAE_VAULT_KEYS_JSON,
    env.WAE_VAULTS_JSON,env.WAE_CONNECT_CLIENTS_JSON])
    assert.equal(serialized.includes(secret),false);
});
test("incomplete PostgreSQL, mismatched vault key or local quotas fail closed",()=>{
  for(const patch of [
    {WAE_ACCOUNTS_DATABASE_URL:""},
    {NODE_ENV:"production"},
    {WAE_ACCOUNTS_KEY:"invalid"},
    {WAE_VAULT_KEYS_JSON:JSON.stringify({org_beta:"cd".repeat(32)})},
    {WAE_CONNECT_ADMISSION_MODE:"local"},
    {WAE_CONNECT_CLIENTS_JSON:"{}"},
    {WAE_ACCOUNTS_STORE:"file"},
    {WAE_VAULT_STORE:"file"}
  ]){
    const report=assessStoragePrerequisites({...env,...patch});
    assert.equal(report.ready,false,JSON.stringify(patch));
    assert.equal(report.releaseApproval,"not_evaluated");
    assert.ok(report.checks.some(x=>x.status==="blocked"));
  }
});
