import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { makeMediaKey } from "../server/marketplace-media.mjs";
import { auditMarketObjectInventory } from "../server/marketplace-object-inventory.mjs";

const business="11111111-1111-4111-8111-111111111111";
const listing="22222222-2222-4222-8222-222222222222";
const media={origin:"https://private.example.test",bucket:"waeweb-private-images",
  region:"us-east-1",accessKey:"ci-only-test-key",secret:"ci-only-fake-media-secret-never-production"};
const key=()=>makeMediaKey(business,listing);
const db=(keys=[],queue=[])=>({users:[{businesses:[{id:business,
  listings:keys.map(imageKey=>({id:listing,imageType:"image/jpeg",imageKey}))}]}],
  mediaDeleteQueue:queue.map(key=>({key,queuedAt:new Date(0).toISOString()}))});
const xml=(keys=[],truncated=false,cursor="")=>`<?xml version="1.0" encoding="UTF-8"?>
<ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
<IsTruncated>${truncated}</IsTruncated>${keys.map(k=>"<Contents><Key>"+k+"</Key></Contents>").join("")}
${cursor?"<NextContinuationToken>"+cursor+"</NextContinuationToken>":""}
</ListBucketResult>`;
const response=(body,status=200)=>({status,body:Readable.from([Buffer.from(body)])});

test("RC20 signed private S3 inventory remains read-only and redacts keys and credentials",async()=>{
  const k=key(),calls=[];
  const transport=async(url,options)=>{calls.push({url,options});
    return response(xml([k]));};
  const result=await auditMarketObjectInventory(db([k]),{media,transport});
  assert.equal(result.status,"inventory_checked_only");
  assert.equal(result.referenced,1);
  assert.equal(result.orphanCandidates,0);
  assert.equal(result.complete,true);
  assert.equal(result.missingCandidates,0);
  assert.equal(result.objectBackupVerified,false);
  assert.equal(result.restoreCertified,false);
  assert.equal(result.noDeletionPerformed,true);
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.method,"GET");
  assert.equal(calls[0].options.redirect,"manual");
  assert.equal(calls[0].options.body,undefined);
  assert.match(calls[0].options.headers.authorization,/AWS4-HMAC-SHA256/);
  assert.match(calls[0].url,/list-type=2/);
  assert.match(calls[0].url,/prefix=marketplace%2F/);
  assert.ok(!JSON.stringify(result).includes(k));
  assert.ok(!JSON.stringify(result).includes(media.secret));
  assert.ok(!JSON.stringify(result).includes(media.origin));
});
test("RC20 separates orphan candidates, queued deletions and missing references, never deletes",async()=>{
  const live=key(),queued=key(),orphan=key(),missing=key();
  const report=await auditMarketObjectInventory(db([live,missing],[queued]),
    {media,transport:async()=>response(xml([live,queued,orphan,"marketplace/unexpected"]))});
  assert.equal(report.status,"attention_required");
  assert.equal(report.referenced,1);
  assert.equal(report.queued,1);
  assert.equal(report.orphanCandidates,1);
  assert.equal(report.unexpectedKeys,1);
  assert.equal(report.missingCandidates,1);
  assert.equal(report.orphanDeletionApproved,false);
  assert.equal(report.noDeletionPerformed,true);
});
test("RC20 pagination is bounded and partial inventory never claims coverage",async()=>{
  const a=key(),b=key();
  const calls=[];
  const transport=async(url,options)=>{
    calls.push({url,options});
    return response(calls.length===1?xml([a],true,"opaque-token"):xml([b]));
  };
  const partial=await auditMarketObjectInventory(db([a,b]),{media,
    transport:async()=>response(xml([a],true,"next")),pages:1});
  assert.equal(partial.status,"partial");
  assert.equal(partial.complete,false);
  assert.equal(partial.missingCandidates,null);
  assert.equal(partial.orphanInventoryVerified,false);
  const complete=await auditMarketObjectInventory(db([a,b]),{media,transport,pages:2});
  assert.equal(complete.complete,true);
  assert.equal(complete.referenced,2);
  assert.equal(calls.length,2);
  assert.match(calls[1].url,/continuation-token=opaque-token/);
  assert.equal(complete.restoreCertified,false);
});
test("RC20 detects reference drift without leaking confidential state",async()=>{
  const k=key();
  const result=await auditMarketObjectInventory(db([k]),{media,
    transport:async()=>response(xml([k])),readCurrent:async()=>db([])});
  assert.equal(result.status,"attention_required");
  assert.equal(result.databaseUnchanged,false);
});
test("RC20 refuses invalid journal and duplicate references before provider calls",async()=>{
  const k=key();
  let calls=0;
  const transport=async()=>{calls++;return response(xml());};
  await assert.rejects(()=>auditMarketObjectInventory(db([k,k]),{media,transport}),
    {code:"media_integrity_duplicate"});
  await assert.rejects(()=>auditMarketObjectInventory(db([k],["../bad"]),{media,transport}),
    {code:"media_inventory_journal_invalid"});
  assert.equal(calls,0);
});
test("RC20 rejects unsafe or incomplete provider inventory and limits reads",async()=>{
  const k=key();
  await assert.rejects(()=>auditMarketObjectInventory(db([k]),{media,
    transport:async()=>response(xml([k],true))}),{code:"media_inventory_cursor_invalid"});
  await assert.rejects(()=>auditMarketObjectInventory(db([k]),{media,
    transport:async()=>response(xml([k],false,""),403)}),{code:"media_inventory_denied"});
  await assert.rejects(()=>auditMarketObjectInventory(db([k]),{media,
    transport:async()=>response("x".repeat(300000))}),{code:"media_inventory_overflow"});
  await assert.rejects(()=>auditMarketObjectInventory(db([k]),{media,
    transport:async()=>response("<!DOCTYPE bad><ListBucketResult/>")}),
    {code:"media_inventory_xml"});
  await assert.rejects(()=>auditMarketObjectInventory(db([k]),{media,
    transport:async()=>response(xml([k])),pages:6}),{code:"media_inventory_options"});
});
