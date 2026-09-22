import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { makeMediaKey } from "../server/marketplace-media.mjs";
import { verifyMarketImageIntegrity } from "../server/marketplace-integrity.mjs";
import { mediaIntegrityManifest, auditMediaDigests } from "../server/marketplace-integrity-audit.mjs";

const biz="11111111-1111-4111-8111-111111111111";
const item="22222222-2222-4222-8222-222222222222";
const media={origin:"https://private.example.test",bucket:"waeweb-private-images",
  region:"us-east-1",accessKey:"fixture-only-123456",
  secret:"fixture-secret-12345678901234567890"};
const jpeg=Buffer.from([255,216,255,224,0,0,1,2,3,4,255,217]);
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
const listing=(key,opts={})=>({id:item,imageKey:key,imageType:"image/jpeg",
  imageSha256:hash(jpeg),imageBytes:jpeg.length,...opts});
const db=items=>({version:1,users:[{businesses:[{id:biz,listings:items}]}]});
const fake=(bytes=jpeg,status=200,headers={})=>
  new Response(bytes,{status,headers:{"content-type":"image/jpeg",...headers}});
const credentials={checksum:hash(jpeg),size:jpeg.length};

test("RC18 records valid match privately with bounded presigned GET",async()=>{
  const key=makeMediaKey(biz,item),requests=[];
  const result=await auditMediaDigests(db([listing(key)]),{
    media,transport:async(url,options)=>{
      requests.push({url,options});return fake();
    }
  });
  assert.equal(result.status,"batch_verified_only");
  assert.equal(result.verified,1);
  assert.equal(result.bytesCompared,true);
  assert.equal(result.restoreCertified,false);
  assert.equal(result.objectBackupVerified,false);
  assert.equal(result.noDeletionPerformed,true);
  assert.equal(requests.length,1);
  assert.equal(requests[0].options.method,"GET");
  assert.equal(requests[0].options.redirect,"manual");
  assert.equal(requests[0].options.body,undefined);
  assert.match(requests[0].url,/X-Amz-Signature=[a-f0-9]{64}/);
  assert.ok(!JSON.stringify(result).includes(key));
  assert.ok(!JSON.stringify(result).includes(media.secret));
  assert.ok(!JSON.stringify(result).includes(media.origin));
  assert.ok(!JSON.stringify(result).includes(hash(jpeg)));
});

test("RC18 detects same-length tampering; a valid HEAD alone cannot certify bytes",async()=>{
  const key=makeMediaKey(biz,item);
  const altered=Buffer.from(jpeg);altered[5]^=1;
  const result=await auditMediaDigests(db([listing(key)]),{
    media,transport:async()=>fake(altered)
  });
  assert.equal(result.mismatch,1);
  assert.equal(result.status,"attention_required");
  assert.equal(result.bytesCompared,false);
});

test("RC18 legacy image metadata is NOT silently trusted or fetched",async()=>{
  const key=makeMediaKey(biz,item);let calls=0;
  const result=await auditMediaDigests(db([listing(key,{
    imageSha256:undefined,imageBytes:undefined})]),{
      media,transport:async()=>{calls++;return fake();}
    });
  assert.equal(result.legacy_unverified,1);
  assert.equal(result.status,"attention_required");
  assert.equal(calls,0);
});

test("RC18 rejects invalid, duplicated or cross-listing references before network",async()=>{
  const key=makeMediaKey(biz,item);let calls=0;
  const transport=async()=>{calls++;return fake()};
  await assert.rejects(()=>auditMediaDigests(db([listing(key),listing(key)]),{media,transport}),
    {code:"media_integrity_duplicate"});
  await assert.rejects(()=>auditMediaDigests(db([listing("../not-valid")]),{media,transport}),
    {code:"media_integrity_reference_invalid"});
  await assert.rejects(()=>auditMediaDigests(db([listing(makeMediaKey(biz,
    "33333333-3333-4333-8333-333333333333"))]),{media,transport}),
    {code:"media_integrity_reference_invalid"});
  assert.equal(calls,0);
});

test("RC18 checks headers, redirects, wrong MIME, truncated bodies, sizes and status",async()=>{
  const key=makeMediaKey(biz,item);
  const check=async(transport,opts=credentials)=>
    verifyMarketImageIntegrity(media,key,{...opts,transport});
  assert.equal((await check(async()=>fake(null,404))).state,"missing");
  assert.equal((await check(async()=>fake(null,403))).state,"denied");
  assert.equal((await check(async()=>fake(null,302))).state,"unavailable");
  assert.equal((await check(async()=>fake(jpeg,200,{"content-type":"text/html"}))).state,"invalid_format");
  assert.equal((await check(async()=>fake(jpeg.subarray(0,-1)))).state,"invalid_format");
  assert.equal((await check(async()=>fake(jpeg,200,{"content-length":"12"}))).state,"verified");
  assert.equal((await check(async()=>fake(jpeg,200,{"content-length":"999999999"}))).state,"invalid_size");
  assert.equal((await check(async()=>{throw Error("offline")})).state,"unavailable");
  assert.equal((await check(async()=>fake(),{checksum:"not-hash",size:12})).state,"metadata_invalid");
  assert.equal((await check(async()=>fake(),{checksum:hash(jpeg),size:13})).state,"mismatch");
});

test("RC18 detects concurrent metadata drift and refuses unjustified full certification",async()=>{
  const key=makeMediaKey(biz,item);
  const first=db([listing(key)]),changed=db([listing(key,{imageSha256:hash("different")})]);
  const a=await auditMediaDigests(first,{media,transport:async()=>fake(),
    readCurrent:async()=>changed});
  assert.equal(a.databaseUnchanged,false);
  assert.equal(a.status,"attention_required");
  assert.equal(a.entireDatasetVerified,false);
  const keys=Array.from({length:3},()=>makeMediaKey(biz,item));
  const many=db(keys.map(k=>listing(k)));
  const batch=await auditMediaDigests(many,{media,limit:2,transport:async()=>fake()});
  assert.equal(batch.status,"partial");
  assert.equal(batch.nextOffset,2);
  assert.equal(batch.entireDatasetVerified,false);
  await assert.rejects(()=>auditMediaDigests(many,{media,offset:4}),
    {code:"media_integrity_offset_invalid"});
  await assert.rejects(()=>auditMediaDigests(many,{media,limit:11}),
    {code:"media_integrity_options"});
  assert.equal(mediaIntegrityManifest(many).records.length,3);
});
