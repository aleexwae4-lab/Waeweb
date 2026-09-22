import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { sealVault } from "../server/crypto.mjs";
import { makeMediaKey } from "../server/marketplace-media.mjs";
import { mediaIntegrityManifest } from "../server/marketplace-integrity-audit.mjs";
import { createMarketMediaArchive } from "../server/marketplace-object-archive.mjs";
import { restoreArchivedMarketMedia } from "../server/marketplace-object-restore.mjs";

const business="11111111-1111-4111-8111-111111111111";
const listing="22222222-2222-4222-8222-222222222222";
const key=Buffer.alloc(32,0x79),postgresChecksum="a".repeat(64);
const jpeg=Buffer.from([255,216,255,224,0,0,1,2,3,4,255,217]);
const checksum=createHash("sha256").update(jpeg).digest("hex");
const media={origin:"https://private.example.test",bucket:"waeweb-private-images",
  region:"us-east-1",accessKey:"ci-only-test-key",
  secret:"ci-only-fake-media-secret-never-production"};
const makeDb=(n=1)=>({version:1,users:[{businesses:[{id:business,listings:
  Array.from({length:n},(_,i)=>{const id=i===0?listing:
    "33333333-3333-4333-8333-333333333333";
    return {id,imageKey:makeMediaKey(business,id),imageType:"image/jpeg",
      imageSha256:checksum,imageBytes:jpeg.length};})}]}]});
const snapshot=db=>({accounts:{envelope:JSON.stringify(sealVault("accounts",db,key))},
  vaults:[],checksum:postgresChecksum});
async function fixture(n=1){
  const db=makeDb(n),source=snapshot(db);
  const {archive}=await createMarketMediaArchive(db,{
    key,postgresChecksum,media,
    transport:async()=>({status:200,headers:new Headers({
      "content-type":"image/jpeg","content-length":String(jpeg.length)}),
      body:Readable.from([jpeg])})});
  return {source,archive,records:mediaIntegrityManifest(db).records};
}
function store(records=[],{denyHead=false,corruptPostWrite=false,race=false}={}){
  const objects=new Map(records.map(record=>[record.key,Buffer.from(jpeg)]));
  const calls=[];
  const transport=async(url,options)=>{
    const path=new URL(url).pathname;
    const objectKey=decodeURIComponent(path.split("/").slice(2).join("/"));
    calls.push({method:options.method,options});
    if(options.method==="HEAD")return denyHead?{status:403}:objects.has(objectKey)?
      {status:200,headers:new Headers({"content-length":String(jpeg.length)})}:{status:404};
    if(options.method==="PUT"){
      assert.equal(options.headers["if-none-match"],"*");
      assert.match(options.headers.authorization,
        /SignedHeaders=content-type;host;if-none-match;x-amz-content-sha256;x-amz-date/);
      if(race||objects.has(objectKey))return {status:412};
      const bytes=Buffer.from(options.body);
      if(corruptPostWrite)bytes[5]^=1;
      objects.set(objectKey,bytes);
      return {status:200};
    }
    if(options.method==="GET"){
      const bytes=objects.get(objectKey);
      return bytes?{status:200,headers:new Headers({
        "content-type":"image/jpeg","content-length":String(bytes.length)}),
        body:Readable.from([bytes])}:{status:404};
    }
    throw Error("unexpected operation");
  };
  return {objects,calls,transport};
}

test("RC21 restores missing objects from authenticated archive only with signed conditional PUT",async()=>{
  const {source,archive,records}=await fixture();
  const s=store();
  const result=await restoreArchivedMarketMedia(source,source,archive,{
    key,media,transport:s.transport});
  assert.equal(result.status,"batch_restored_and_verified");
  assert.equal(result.restored,1);
  assert.equal(result.verified,1);
  assert.equal(result.entireDatasetRestored,true);
  assert.equal(result.restoreCertified,false);
  assert.equal(result.noDeletionPerformed,true);
  assert.deepEqual(s.objects.get(records[0].key),jpeg);
  assert.deepEqual(s.calls.map(c=>c.method),["HEAD","PUT","GET"]);
  assert.ok(!JSON.stringify(result).includes(records[0].key));
  assert.ok(!JSON.stringify(result).includes(media.secret));
});
test("RC21 blocks DB mismatch, wrong archive, already-present objects BEFORE any write",async()=>{
  const {source,archive,records}=await fixture();
  const present=store([records[0]]);
  const existing=await restoreArchivedMarketMedia(source,source,archive,{
    key,media,transport:present.transport});
  assert.equal(existing.reason,"destination_not_empty");
  assert.equal(present.calls.some(c=>c.method==="PUT"),false);
  assert.deepEqual(present.objects.get(records[0].key),jpeg);
  const mismatch=store();
  const result=await restoreArchivedMarketMedia(source,snapshot(makeDb(0)),archive,{
    key,media,transport:mismatch.transport});
  assert.equal(result.reason,"target_mismatch");
  assert.equal(mismatch.calls.length,0);
  await assert.rejects(()=>restoreArchivedMarketMedia(source,source,{
    ...archive,ciphertext:archive.ciphertext.slice(0,-4)+"AAAA"},{
      key,media,transport:mismatch.transport}),{code:"media_archive_auth_failed"});
  assert.equal(mismatch.calls.length,0);
});
test("RC21 preflights entire batch and rejects unknown HEAD or queued keys",async()=>{
  const {source,archive,records}=await fixture(2);
  const s=store([records[1]]);
  const r=await restoreArchivedMarketMedia(source,source,archive,{
    key,media,transport:s.transport});
  assert.equal(r.reason,"destination_not_empty");
  assert.equal(s.calls.filter(c=>c.method==="PUT").length,0);
  const denied=store([],{denyHead:true});
  const d=await restoreArchivedMarketMedia(source,source,archive,{
    key,media,transport:denied.transport});
  assert.equal(d.reason,"destination_not_confirmed_missing");
  assert.equal(denied.calls.filter(c=>c.method==="PUT").length,0);
  const queuedDb=makeDb(2);
  queuedDb.mediaDeleteQueue=[{key:records[0].key,queuedAt:new Date().toISOString()}];
  const queuedSource=snapshot(queuedDb),empty=store();
  await assert.rejects(()=>restoreArchivedMarketMedia(
    queuedSource,queuedSource,archive,{key,media,transport:empty.transport}),
    {code:"media_restore_queued_reference"});
  assert.equal(empty.calls.length,0);
});
test("RC21 protects against conditional PUT races and verifies written bytes",async()=>{
  const {source,archive}=await fixture();
  const racing=store([],{race:true});
  const r=await restoreArchivedMarketMedia(source,source,archive,{
    key,media,transport:racing.transport});
  assert.equal(r.reason,"destination_race_exists");
  assert.equal(r.restored,0);
  assert.equal(racing.objects.size,0);
  const corrupt=store([],{corruptPostWrite:true});
  const c=await restoreArchivedMarketMedia(source,source,archive,{
    key,media,transport:corrupt.transport});
  assert.equal(c.status,"partial_recovery");
  assert.equal(c.reason,"post_write_integrity_failed");
  assert.equal(c.verified,0);
  assert.equal(c.restoreCertified,false);
  const changed=store();
  const drift=await restoreArchivedMarketMedia(source,source,archive,{
    key,media,transport:changed.transport,readCurrent:async()=>snapshot(makeDb(0))});
  assert.equal(drift.reason,"target_changed");
  assert.equal(changed.calls.length,0);
});
