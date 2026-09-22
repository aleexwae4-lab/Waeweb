import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { createMarketMediaArchive } from "../server/marketplace-object-archive.mjs";
import { auditMarketMediaArchiveSet } from "../server/marketplace-archive-set.mjs";
import { makeMediaKey } from "../server/marketplace-media.mjs";

const business="11111111-1111-4111-8111-111111111111";
const jpeg=Buffer.from([255,216,255,224,0,0,1,2,3,4,255,217]);
const sha=createHash("sha256").update(jpeg).digest("hex");
const pg="a".repeat(64),key=Buffer.alloc(32,0xab);
const media={origin:"https://private.example.test",bucket:"waeweb-private-images",
  region:"us-east-1",accessKey:"ci-only-test-key",
  secret:"ci-only-fake-media-secret-never-production"};
const data=(count=6)=>({users:[{businesses:[{id:business,listings:
  Array.from({length:count},(_,i)=>{
    const id="22222222-2222-4222-8222-"+String(i+1).padStart(12,"0");
    return {id,imageKey:makeMediaKey(business,id),imageType:"image/jpeg",
      imageSha256:sha,imageBytes:jpeg.length};
  })}]}]});
const response=()=>({status:200,headers:new Headers({
  "content-type":"image/jpeg","content-length":String(jpeg.length)}),
  body:Readable.from([jpeg])});
async function fixture(){
  const db=data(),params={key,postgresChecksum:pg,media,
    transport:async()=>response()};
  const first=(await createMarketMediaArchive(db,{...params,offset:0,limit:5})).archive;
  const last=(await createMarketMediaArchive(db,{...params,offset:5,limit:5})).archive;
  const overlap=(await createMarketMediaArchive(db,{...params,offset:3,limit:3})).archive;
  return {db,first,last,overlap};
}
test("RC22 verifies full six-image archive coverage over two authenticated capsules",async()=>{
  const {db,first,last}=await fixture();
  const report=auditMarketMediaArchiveSet(db,[last,first],{
    key,postgresChecksum:pg});
  assert.equal(report.status,"complete_set_verified");
  assert.equal(report.total,6);
  assert.equal(report.covered,6);
  assert.equal(report.missing,0);
  assert.equal(report.completeArchiveSetVerified,true);
  assert.equal(report.restoreCertified,false);
  assert.equal(report.independentCopyVerified,false);
  assert.equal(report.noDeletionPerformed,true);
  assert.ok(!JSON.stringify(report).includes(first.ciphertext));
  assert.ok(!JSON.stringify(report).includes(media.secret));
  assert.ok(!JSON.stringify(report).includes("marketplace/"));
});
test("RC22 identifies missing batches, overlaps and duplicate capsules",async()=>{
  const {db,first,last,overlap}=await fixture();
  const partial=auditMarketMediaArchiveSet(db,[last],{key,postgresChecksum:pg});
  assert.equal(partial.status,"incomplete_set");
  assert.equal(partial.covered,1);
  assert.equal(partial.missing,5);
  assert.equal(partial.completeArchiveSetVerified,false);
  const overlapping=auditMarketMediaArchiveSet(db,[first,overlap],{
    key,postgresChecksum:pg});
  assert.equal(overlapping.status,"attention_required");
  assert.equal(overlapping.overlap,2);
  assert.equal(overlapping.completeArchiveSetVerified,false);
  await assert.throws(()=>auditMarketMediaArchiveSet(db,[first,first],{
    key,postgresChecksum:pg}),{code:"media_archive_set_duplicate"});
});
test("RC22 fails closed on wrong snapshot, altered ciphertext and changed DB records",async()=>{
  const {db,first,last}=await fixture();
  assert.throws(()=>auditMarketMediaArchiveSet(db,[first,last],{
    key,postgresChecksum:"b".repeat(64)}),{code:"media_archive_identity_mismatch"});
  const bad={...last,ciphertext:last.ciphertext.slice(0,-4)+"AAAA"};
  assert.throws(()=>auditMarketMediaArchiveSet(db,[first,bad],{
    key,postgresChecksum:pg}),{code:"media_archive_auth_failed"});
  assert.throws(()=>auditMarketMediaArchiveSet(data(5),[first,last],{
    key,postgresChecksum:pg}),{code:"media_archive_identity_mismatch"});
  assert.throws(()=>auditMarketMediaArchiveSet(db,[],{
    key,postgresChecksum:pg}),{code:"media_archive_set_options"});
  assert.throws(()=>auditMarketMediaArchiveSet(db,Array(101).fill(first),{
    key,postgresChecksum:pg}),{code:"media_archive_set_options"});
});
test("RC22 cannot label an empty Marketplace as a backed-up object set",()=>{
  assert.throws(()=>auditMarketMediaArchiveSet(data(0),[],{
    key,postgresChecksum:pg}),{code:"media_archive_set_options"});
});
