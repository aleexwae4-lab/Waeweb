import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {mkdtemp,readdir,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {handler} from "../server/index.mjs";
import {requiresDurableStorage} from "../server/hosting.mjs";
import {accountsEnabled} from "../server/accounts.mjs";
import {vaultStorageReady} from "../server/vault.mjs";
import {connectAdmissionReady} from "../server/connect-postgres.mjs";

const hosted=[
  {VERCEL:"1"},
  {RENDER:"true"},
  {RENDER_SERVICE_ID:"srv-test-waeweb"},
  {RENDER_EXTERNAL_HOSTNAME:"waeweb.example.onrender.com"},
  {NODE_ENV:"production"},
  {AWS_LAMBDA_FUNCTION_NAME:"waeweb-handler"},
  {K_SERVICE:"waeweb"}
];
const keys=["VERCEL","RENDER","RENDER_SERVICE_ID","RENDER_EXTERNAL_HOSTNAME",
  "NODE_ENV","AWS_LAMBDA_FUNCTION_NAME","K_SERVICE","WAE_ACCOUNTS_ENABLED",
  "WAE_ACCOUNTS_STORE","WAE_ACCOUNTS_KEY","WAE_ACCOUNTS_DIR",
  "WAE_VAULT_STORE","WAE_READER_ENABLED","WAE_VAULTS_JSON",
  "WAE_VAULT_KEYS_JSON","WAE_VAULT_DIR","WAE_CONNECT_ADMISSION_MODE"];
const vaultToken="hosted-fixture-token-"+ "v".repeat(40);

test("hosted and production runtimes require durable storage even when NODE_ENV=test",()=>{
  for(const flag of hosted){
    assert.equal(requiresDurableStorage({...flag,NODE_ENV:flag.NODE_ENV||"test"}),true);
    assert.equal(connectAdmissionReady({...flag,NODE_ENV:flag.NODE_ENV||"test",
      WAE_CONNECT_ADMISSION_MODE:"local"}),false);
  }
  assert.equal(requiresDurableStorage({NODE_ENV:"test"}),false);
  assert.equal(requiresDurableStorage({NODE_ENV:"development"}),false);
  assert.equal(connectAdmissionReady({NODE_ENV:"test",WAE_CONNECT_ADMISSION_MODE:"local"}),true);
});

test("real HTTP rejects ephemeral accounts, business registrations and vaults on Render and Vercel",async()=>{
  const old=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  const root=await mkdtemp(join(tmpdir(),"wae-hosting-denied-"));
  const server=http.createServer(handler);
  try{
    for(const key of keys)delete process.env[key];
    Object.assign(process.env,{
      NODE_ENV:"test",WAE_ACCOUNTS_ENABLED:"true",
      WAE_ACCOUNTS_STORE:"file",WAE_ACCOUNTS_KEY:"ab".repeat(32),
      WAE_ACCOUNTS_DIR:root,WAE_VAULT_DIR:root,
      WAE_VAULT_STORE:"file",WAE_READER_ENABLED:"true",
      WAE_VAULTS_JSON:JSON.stringify({team_alpha:vaultToken}),
      WAE_VAULT_KEYS_JSON:JSON.stringify({team_alpha:"cd".repeat(32)}),
      WAE_CONNECT_ADMISSION_MODE:"local"
    });
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const base="http://127.0.0.1:"+server.address().port;
    const register=()=>fetch(base+"/api/account/register",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({name:"Hosted test",email:"blocked@example.test",
        password:"NeverPersistInTemporaryStorage"})
    });
    for(const flag of hosted){
      for(const name of ["VERCEL","RENDER","RENDER_SERVICE_ID",
        "RENDER_EXTERNAL_HOSTNAME","AWS_LAMBDA_FUNCTION_NAME",
        "K_SERVICE"])delete process.env[name];
      process.env.NODE_ENV="test";
      Object.assign(process.env,flag);
      assert.equal(accountsEnabled(),false,JSON.stringify(flag));
      assert.equal(vaultStorageReady(),false,JSON.stringify(flag));
      const cap=await (await fetch(base+"/api/capabilities")).json();
      assert.equal(cap.accountsEnabled,false);
      assert.equal(cap.publicBusinessProfiles,false);
      assert.equal(cap.readerEnabled,false);
      assert.equal(cap.indexPersistence,"disabled");
      assert.equal((await register()).status,503);
      assert.equal((await fetch(base+"/api/businesses")).status,503);
      assert.equal((await fetch(base+"/api/index/search",{
        headers:{authorization:"Bearer "+vaultToken}
      })).status,503);
    }
    assert.deepEqual(await readdir(root),[],"no ephemeral account/vault files were created");
    process.env.RENDER="true";
    process.env.WAE_ACCOUNTS_STORE="postgres";
    process.env.WAE_VAULT_STORE="postgres";
    assert.equal(accountsEnabled(),false,"missing PostgreSQL config cannot fall back");
    assert.equal(vaultStorageReady(),false,"missing PostgreSQL config cannot fall back");
    assert.equal((await register()).status,503);
    assert.deepEqual(await readdir(root),[]);
  }finally{
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    for(const [key,val] of Object.entries(old)){
      if(val===undefined)delete process.env[key];else process.env[key]=val;
    }
    await rm(root,{recursive:true,force:true});
  }
});
