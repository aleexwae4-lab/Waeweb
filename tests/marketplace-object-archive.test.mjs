import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createHash } from "node:crypto";
import { makeMediaKey } from "../server/marketplace-media.mjs";
import { createMarketMediaArchive, openMarketMediaArchive }
  from "../server/marketplace-object-archive.mjs";

const business="11111111-1111-4111-8111-111111111111";
const listing="22222222-2222-4222-8222-222222222222";
const key=makeMediaKey(business,listing);
const jpeg=Buffer.from([255,216,255,224,0,0,1,2,3,4,255,217]);
const checksum=createHash("sha256").update(jpeg).digest("hex");
const pgChecksum="a".repeat(64),secret=Buffer.alloc(32,0xa1);
const media={origin:"https://private.example.test",bucket:"waeweb-private-images",
 region:"us-east-1",accessKey:"ci-only-test-key",secret:"ci-only-fake-media-secret-never-production"};
const db=(records=[{imageKey:key,imageType:"image/jpeg",
  imageSha256:checksum,imageBytes:jpeg.length}])=>({
    users:[{businesses:[{id:business,listings:records.map(record=>({
      id:listing,...record}))}]}]});
const response=(bytes=jpeg)=>({status:200,headers:new Headers({
 "content-type":"image/jpeg","content-length":String(bytes.length)}),
 body:Readable.from([bytes])});

test("RC20 encrypts the JPEG bytes and key under PG-snapshot-bound AEAD",async()=>{
  const calls=[];
  const {archive,summary}=await createMarketMediaArchive(db(),{
    key:secret,postgresChecksum:pgChecksum,media,transport:async(url,options)=>{
      calls.push(options);return response();
    }});
  assert.equal(summary.checked,1);
  assert.equal(summary.contentsEncrypted,true);
  assert.equal(summary.objectBackupVerified,false);
  assert.equal(summary.restoreCertified,false);
  assert.equal(calls[0].method,"GET");
  assert.equal(calls[0].redirect,"manual");
  assert.ok(!JSON.stringify(archive).includes(key));
  assert.ok(!JSON.stringify(archive).includes(jpeg.toString("base64")));
  assert.ok(!JSON.stringify(summary).includes(key));
  const opened=openMarketMediaArchive(archive,{key:secret,postgresChecksum:pgChecksum,
    manifestFingerprint:archive.manifestFingerprint});
  assert.equal(opened.items.length,1);
  assert.equal(opened.items[0].key,key);
  assert.deepEqual(Buffer.from(opened.items[0].bytes,"base64"),jpeg);
});
test("RC20 tampered ciphertext, wrong key or different PG backup fails closed",async()=>{
  const {archive}=await createMarketMediaArchive(db(),{
    key:secret,postgresChecksum:pgChecksum,media,transport:async()=>response()});
  const args={key:secret,postgresChecksum:pgChecksum,
    manifestFingerprint:archive.manifestFingerprint};
  assert.throws(()=>openMarketMediaArchive(archive,{...args,key:Buffer.alloc(32,2)}),
    {code:"media_archive_auth_failed"});
  assert.throws(()=>openMarketMediaArchive(archive,{...args,postgresChecksum:"b".repeat(64)}),
    {code:"media_archive_identity_mismatch"});
  const tampered={...archive,ciphertext:archive.ciphertext.slice(0,-4)+"AAAA"};
  assert.throws(()=>openMarketMediaArchive(tampered,args),
    {code:"media_archive_auth_failed"});
});
test("RC20 refuses missing legacy SHA-256, corrupt bytes and DB drift before archiving",async()=>{
  let calls=0;
  const transport=async()=>{calls++;return response();};
  await assert.rejects(()=>createMarketMediaArchive(db([{
    imageKey:key,imageType:"image/jpeg"
  }]),{key:secret,postgresChecksum:pgChecksum,media,transport}),
  {code:"media_archive_legacy_unverified"});
  assert.equal(calls,0);
  await assert.rejects(()=>createMarketMediaArchive(db(),{
    key:secret,postgresChecksum:pgChecksum,media,transport:async()=>response(
      Buffer.from([255,216,255,224,0,1,1,2,3,4,255,217]))}),
    {code:"media_archive_mismatch"});
  await assert.rejects(()=>createMarketMediaArchive(db(),{
    key:secret,postgresChecksum:pgChecksum,media,transport,
    readCurrent:async()=>db([])}),{code:"media_archive_database_changed"});
});
test("RC20 archive caps batch size and refuses empty datasets",async()=>{
  await assert.rejects(()=>createMarketMediaArchive(db(),{
    key:secret,postgresChecksum:pgChecksum,media,limit:6}),
    {code:"media_archive_options"});
  await assert.rejects(()=>createMarketMediaArchive(db([]),{
    key:secret,postgresChecksum:pgChecksum,media}),
    {code:"media_archive_empty_batch"});
});
