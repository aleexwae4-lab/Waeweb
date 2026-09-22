import test from "node:test";
import assert from "node:assert/strict";
import { makeMediaKey, headMarketImage } from "../server/marketplace-media.mjs";
import { mediaRecoveryKeys, probeMediaReferences, verifyMediaIntegrity } from "../server/marketplace-recovery.mjs";
import { queueMediaDeletion } from "../server/marketplace-lifecycle.mjs";
import { createHash } from "node:crypto";

const business="11111111-1111-4111-8111-111111111111";
const listing="22222222-2222-4222-8222-222222222222";
const media={origin:"https://private.example.test",bucket:"waeweb-private-images",
  region:"us-east-1",accessKey:"fixture-only-123456",secret:"fixture-secret-12345678901234567890"};
const key=()=>makeMediaKey(business,listing);
const db=keys=>({version:1,users:[{businesses:[{listings:keys.map(imageKey=>({imageKey}))}]}]});
const response=(status,length="1024")=>({
  status,headers:new Headers({"content-length":length})
});

test("RC17 signs HEAD without writes, does not reveal keys or secrets",async()=>{
  const k=key(), calls=[];
  const transport=async(url,options)=>{
    calls.push({url,options});return response(200);
  };
  const result=await probeMediaReferences(db([k]),{media,transport});
  assert.equal(result.status,"presence_checked_only");
  assert.equal(result.checked,1);
  assert.equal(result.present,1);
  assert.equal(result.restoreCertified,false);
  assert.equal(result.objectBytesVerified,false);
  assert.equal(result.objectBackupVerified,false);
  assert.equal(result.noDeletionPerformed,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.method,"HEAD");
  assert.equal(calls[0].options.redirect,"manual");
  assert.equal(calls[0].options.body,undefined);
  assert.match(calls[0].options.headers.authorization,/AWS4-HMAC-SHA256/);
  assert.ok(!JSON.stringify(result).includes(k));
  assert.ok(!JSON.stringify(result).includes(media.secret));
  assert.ok(!JSON.stringify(result).includes(media.origin));
});
test("RC17 detects missing, unauthorized, malformed size and provider outages without writing",async()=>{
  const keys=Array.from({length:5},key);
  let call=0;
  const transport=async()=>{
    call++;
    if(call===1)return response(200);
    if(call===2)return response(404);
    if(call===3)return response(403);
    if(call===4)return response(200,"0");
    throw Error("test-only-provider-failure");
  };
  const result=await probeMediaReferences(db(keys),{media,transport});
  assert.equal(result.status,"attention_required");
  assert.equal(result.present,1);assert.equal(result.missing,1);
  assert.equal(result.denied,1);assert.equal(result.invalid_size,1);
  assert.equal(result.unavailable,1);
  assert.equal(result.noDeletionPerformed,true);
});
test("RC17 pagination is explicit; partial is not certification",async()=>{
  const keys=Array.from({length:3},key);
  const state=db(keys);
  const transport=async()=>response(200);
  const first=await probeMediaReferences(state,{media,transport,limit:2});
  assert.equal(first.status,"partial");
  assert.equal(first.nextOffset,2);
  const last=await probeMediaReferences(state,{media,transport,offset:2,limit:2});
  assert.equal(last.checked,1);
  assert.equal(last.nextOffset,null);
  assert.equal(last.status,"presence_checked_only");
  assert.equal(last.restoreCertified,false);
  await assert.rejects(()=>probeMediaReferences(state,{media,transport,offset:4}),
    {code:"media_recovery_offset_invalid"});
  await assert.rejects(()=>probeMediaReferences(state,{media,transport,limit:51}),
    {code:"media_recovery_options"});
});
test("RC17 rejects corrupt and duplicate database references before provider reads",async()=>{
  let calls=0;
  const transport=async()=>{calls++;return response(200);};
  const k=key();
  await assert.rejects(()=>probeMediaReferences(db([k,k]),{media,transport}),
    {code:"media_recovery_references_invalid"});
  await assert.rejects(()=>probeMediaReferences(db(["../../bad"]),{media,transport}),
    {code:"media_recovery_references_invalid"});
  assert.equal(calls,0);
});
test("RC17 detects concurrent reference drift; transient response cannot be marked clean",async()=>{
  const k=key(), first=db([k]), changed=db([]);
  const result=await probeMediaReferences(first,{media,transport:async()=>response(200),
    readCurrent:async()=>changed});
  assert.equal(result.databaseUnchanged,false);
  assert.equal(result.status,"attention_required");
});
test("RC17 HEAD refuses redirects and missing provider configuration",async()=>{
  const k=key();
  const denied=await headMarketImage(media,k,async()=>response(302));
  assert.equal(denied.state,"unavailable");
  await assert.rejects(()=>headMarketImage(null,k),{code:"media_unavailable"});
  await assert.rejects(()=>headMarketImage(media,"../bad",async()=>response(200)),
    {code:"media_key_invalid"});
  const retained=db([k]);queueMediaDeletion(retained,key());
  assert.equal(mediaRecoveryKeys(retained).keys.length,1);
});

const jpeg=Buffer.from([255,216,255,224,0,0,1,2,3,4,255,217]);
const sha256=bytes=>createHash("sha256").update(bytes).digest("hex");
const integrityDb=(bytes=jpeg,overrides={})=>({version:1,users:[{businesses:[{listings:[{
  imageKey:key(),imageSha256:sha256(bytes),imageBytes:bytes.length,...overrides
}]}]}]});
const getResponse=(bytes=jpeg,status=200)=>({
  status,headers:new Headers({"content-length":String(bytes.length)}),
  arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)
});

test("RC18 verifies actual bytes against encrypted SHA-256 and exposes no image/key",async()=>{
  const state=integrityDb(),objectKey=state.users[0].businesses[0].listings[0].imageKey;
  const calls=[];
  const result=await verifyMediaIntegrity(state,{media,transport:async(url,options)=>{
    calls.push({url,options});return getResponse();
  }});
  assert.equal(result.status,"integrity_checked_only");
  assert.equal(result.verified,1);
  assert.equal(result.objectBytesVerified,1);
  assert.equal(result.restoreCertified,false);
  assert.equal(result.noImageBytesExposed,true);
  assert.equal(calls[0].options.method,"GET");
  assert.equal(calls[0].options.redirect,"manual");
  assert.equal(JSON.stringify(result).includes(objectKey),false);
  assert.equal(JSON.stringify(result).includes(jpeg.toString("base64")),false);
});
test("RC18 distinguishes checksum, size, missing reference and provider failures",async()=>{
  const good=integrityDb();
  const checksum=await verifyMediaIntegrity(good,{media,transport:async()=>getResponse(
    Buffer.from([255,216,255,224,9,9,9,9,9,9,255,217]))});
  assert.equal(checksum.checksum_mismatch,1);
  assert.equal(checksum.status,"attention_required");
  const size=await verifyMediaIntegrity(good,{media,transport:async()=>getResponse(
    Buffer.from([255,216,255,224,0,0,1,2,3,4,5,255,217]))});
  assert.equal(size.size_mismatch,1);
  const missing=integrityDb(jpeg,{imageSha256:null,imageBytes:null});
  const noRef=await verifyMediaIntegrity(missing,{media,transport:async()=>{throw Error("must not fetch");}});
  assert.equal(noRef.reference_missing,1);
  const denied=await verifyMediaIntegrity(good,{media,transport:async()=>getResponse(Buffer.alloc(0),403)});
  assert.equal(denied.denied,1);
});
test("RC18 integrity batches are capped and concurrent DB drift fails closed",async()=>{
  const state=integrityDb();
  await assert.rejects(()=>verifyMediaIntegrity(state,{media,limit:21}),
    {code:"media_integrity_options"});
  const result=await verifyMediaIntegrity(state,{media,transport:async()=>getResponse(),
    readCurrent:async()=>({version:1,users:[]})});
  assert.equal(result.databaseUnchanged,false);
  assert.equal(result.status,"attention_required");
});
