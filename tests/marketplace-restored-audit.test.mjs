import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { sealVault } from "../server/crypto.mjs";
import { makeMediaKey } from "../server/marketplace-media.mjs";
import { sameRecoveryData, backupMediaRecords,
  assessRestoredMarketplaceMedia } from "../server/marketplace-restored-audit.mjs";

const business="11111111-1111-4111-8111-111111111111";
const listing="22222222-2222-4222-8222-222222222222";
const key=Buffer.alloc(32,0x5a);
const jpeg=Buffer.from([255,216,255,224,0,0,1,2,3,4,255,217]);
const k=makeMediaKey(business,listing);
const digest=createHash("sha256").update(jpeg).digest("hex");
const media={origin:"https://private.example.test",bucket:"waeweb-private-images",
 region:"us-east-1",accessKey:"ci-only-test-key",secret:"ci-only-fake-media-secret-never-production"};
const data=(records=[{imageKey:k,imageType:"image/jpeg",imageSha256:digest,imageBytes:jpeg.length}])=>
  ({version:1,users:[{businesses:[{id:business,listings:records.map((record,i)=>
    ({id:i===0?listing:"33333333-3333-4333-8333-333333333333",...record}))}]}]});
const envelope=db=>JSON.stringify(sealVault("accounts",db,key));
const snapshot=db=>({accounts:{envelope:envelope(db)},vaults:[]});
const response=bytes=>({status:200,
 headers:new Headers({"content-length":String(bytes.length),"content-type":"image/jpeg"}),
 body:Readable.from([bytes])});

test("RC19 checks restored DB snapshot and SHA-256 bytes without writing or leaking keys",async()=>{
  const source=snapshot(data()),calls=[];
  const transport=async(url,options)=>{calls.push({url,options});return response(jpeg);};
  const result=await assessRestoredMarketplaceMedia(source,source,{key,media,transport});
  assert.equal(result.status,"matching_target_batch_verified");
  assert.equal(result.checked,1);assert.equal(result.verified,1);
  assert.equal(result.targetSnapshotMatchesBackup,true);
  assert.equal(result.restoreCertified,false);
  assert.equal(result.objectBackupVerified,false);
  assert.equal(result.noDeletionPerformed,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.method,"GET");
  assert.equal(calls[0].options.redirect,"manual");
  assert.ok(!JSON.stringify(result).includes(k));
  assert.ok(!JSON.stringify(result).includes(media.secret));
  assert.ok(!JSON.stringify(result).includes(media.origin));
});
test("RC19 rejects modified target BEFORE requesting a private image",async()=>{
  const source=snapshot(data()), current=snapshot(data([]));
  let calls=0;
  const result=await assessRestoredMarketplaceMedia(source,current,{key,media,
    transport:async()=>{calls++;return response(jpeg);}});
  assert.equal(result.status,"target_mismatch");
  assert.equal(result.targetSnapshotMatchesBackup,false);
  assert.equal(result.restoreCertified,false);
  assert.equal(calls,0);
});
test("RC19 fails when bytes are corrupted or missing after DB recovery",async()=>{
  const source=snapshot(data());
  const altered=Buffer.from(jpeg);altered[5]^=1;
  const report=await assessRestoredMarketplaceMedia(source,source,{key,media,
    transport:async()=>response(altered)});
  assert.equal(report.mismatch,1);
  assert.equal(report.status,"attention_required");
  assert.equal(report.restoreCertified,false);
  const missing=await assessRestoredMarketplaceMedia(source,source,{key,media,
    transport:async()=>({status:404})});
  assert.equal(missing.missing,1);
  assert.equal(missing.status,"attention_required");
});
test("RC19 rejects altered vaults, absent accounts and corrupt references",async()=>{
  const source=snapshot(data());
  const changed={...source,vaults:[{vaultHash:"changed",envelope:"encrypted"}]};
  assert.equal(sameRecoveryData(source,changed),false);
  assert.throws(()=>backupMediaRecords({accounts:{envelope:null}},key),
    {code:"media_recovery_backup_accounts_absent"});
  assert.throws(()=>backupMediaRecords(snapshot(data([{
    imageKey:"../../bad",imageType:"image/jpeg"
  }])),key),{code:"media_integrity_reference_invalid"});
});
test("RC19 is not a certified restore for an empty dataset or a partial batch",async()=>{
  const empty=snapshot(data([]));
  const result=await assessRestoredMarketplaceMedia(empty,empty,{key,media,
    transport:async()=>{throw Error("no object should be requested");}});
  assert.equal(result.checked,0);
  assert.equal(result.restoreCertified,false);
  const secondKey=makeMediaKey(business,"33333333-3333-4333-8333-333333333333");
  const many=snapshot(data([
    {imageKey:k,imageType:"image/jpeg",imageSha256:digest,imageBytes:jpeg.length},
    {imageKey:secondKey,imageType:"image/jpeg",imageSha256:digest,imageBytes:jpeg.length}
  ]));
  const partial=await assessRestoredMarketplaceMedia(many,many,{key,media,limit:1,
    transport:async()=>response(jpeg)});
  assert.equal(partial.status,"partial");
  assert.equal(partial.nextOffset,1);
  assert.equal(partial.restoreCertified,false);
});
test("RC19 detects a concurrent target change while reading objects",async()=>{
  const source=snapshot(data());
  const result=await assessRestoredMarketplaceMedia(source,source,{key,media,
    transport:async()=>response(jpeg),readCurrent:async()=>snapshot(data([]))});
  assert.equal(result.status,"attention_required");
  assert.equal(result.targetSnapshotMatchesBackup,false);
});
