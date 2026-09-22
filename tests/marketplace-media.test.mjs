import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  mediaConfig, mediaSelected, decodeMarketPhoto, makeMediaKey, presignedMarketImage,
  putMarketImage, MarketMediaError, MAX_MARKET_MEDIA_BYTES
} from "../server/marketplace-media.mjs";
import {
  registerAccount, addBusiness, updateBusinessVisibility,
  addMarketListing, setMarketListingVisibility, listOwnerListings,
  uploadMarketPhoto, getMarketPhotoLink, getPublicMarketPhotoLink,
  removeMarketPhoto, deleteBusiness, inspectMarketMediaQueue, drainMarketMediaQueue, deleteMarketListing, auditMarketMediaReferences
} from "../server/accounts.mjs";

const media={origin:"https://storage.example.test",bucket:"wae-market-photos",
  region:"us-east-1",accessKey:"EXAMPLE_ACCESS_2026",
  secret:"synthetic-only-secret-do-not-use-in-production"};
const jpeg=Buffer.from([255,216,255,224,0,0,1,2,3,4,255,217]);
const imageDataUrl="data:image/jpeg;base64,"+jpeg.toString("base64");
const listing={kind:"product",title:"Bolsa elegante",category:"Moda",
  description:"Bolsa de calidad para dama",price:"349.50",availability:"available"};
const prev=Object.fromEntries(["NODE_ENV","WAE_ACCOUNTS_ENABLED","WAE_ACCOUNTS_KEY",
  "WAE_MARKET_MEDIA_STORE"].map(k=>[k,process.env[k]]));
process.env.NODE_ENV="test";
process.env.WAE_ACCOUNTS_ENABLED="true";
process.env.WAE_ACCOUNTS_KEY="be".repeat(32);

test("S3 opt-in rejects invalid endpoints and absent credentials",()=>{
  assert.equal(mediaConfig({WAE_MARKET_MEDIA_STORE:"s3",
    WAE_MEDIA_ENDPOINT:"http://169.254.169.254/",WAE_MEDIA_BUCKET:"wae-market-photos",
    WAE_MEDIA_REGION:"us-east-1",WAE_MEDIA_ACCESS_KEY_ID:media.accessKey,
    WAE_MEDIA_SECRET_ACCESS_KEY:media.secret}),null);
  assert.equal(mediaConfig({WAE_MARKET_MEDIA_STORE:"s3",
    WAE_MEDIA_ENDPOINT:"https://storage.example.test/private",
    WAE_MEDIA_BUCKET:"wae-market-photos",WAE_MEDIA_REGION:"us-east-1",
    WAE_MEDIA_ACCESS_KEY_ID:media.accessKey,WAE_MEDIA_SECRET_ACCESS_KEY:media.secret}),null);
  assert.equal(mediaSelected({}),false);
  assert.equal(mediaConfig({}),null);
  const configured=mediaConfig({WAE_MARKET_MEDIA_STORE:"s3",
    WAE_MEDIA_ENDPOINT:"https://storage.example.test/",
    WAE_MEDIA_BUCKET:"wae-market-photos",WAE_MEDIA_REGION:"us-east-1",
    WAE_MEDIA_ACCESS_KEY_ID:media.accessKey,WAE_MEDIA_SECRET_ACCESS_KEY:media.secret});
  assert.equal(configured.bucket,media.bucket);
});
test("photo decoder rejects SVG, corrupt JPEG and oversized input",()=>{
  assert.equal(decodeMarketPhoto(imageDataUrl).equals(jpeg),true);
  assert.throws(()=>decodeMarketPhoto("data:image/svg+xml;base64,PHN2Zz4="),
    MarketMediaError);
  assert.throws(()=>decodeMarketPhoto("data:image/jpeg;base64,"+
    Buffer.from("bad").toString("base64")),MarketMediaError);
  assert.throws(()=>decodeMarketPhoto("data:image/jpeg;base64,"+
    Buffer.alloc(MAX_MARKET_MEDIA_BYTES+1,255).toString("base64")),MarketMediaError);
});
test("SigV4 PUT and expiring GET never embed the secret; no redirects",async()=>{
  const key=makeMediaKey("00000000-0000-4000-8000-000000000001",
    "00000000-0000-4000-8000-000000000002");
  let calls=0;
  const transport=async(url,options)=>{
    calls++;
    assert.equal(options.method,"PUT");
    assert.equal(options.redirect,"manual");
    assert.equal(options.headers["content-type"],"image/jpeg");
    assert.equal(options.headers["x-amz-content-sha256"],
      createHash("sha256").update(jpeg).digest("hex"));
    assert.match(options.headers.authorization,/AWS4-HMAC-SHA256 Credential=/);
    assert.equal(options.body.equals(jpeg),true);
    assert.equal(url.includes(media.secret),false);
    return {status:200};
  };
  const stored=await putMarketImage(media,key,jpeg,transport,
    Date.parse("2026-09-22T12:00:00.000Z"));
  assert.equal(calls,1);
  assert.equal(stored.key,key);
  const url=presignedMarketImage(media,key,Date.parse("2026-09-22T12:00:00.000Z"));
  const parsed=new URL(url);
  assert.equal(parsed.protocol,"https:");
  assert.equal(parsed.searchParams.get("X-Amz-Expires"),"120");
  assert.match(parsed.searchParams.get("X-Amz-Signature"),/^[0-9a-f]{64}$/);
  assert.equal(url.includes(media.secret),false);
  assert.throws(()=>presignedMarketImage(media,"marketplace/../secret.jpg"),
    MarketMediaError);
  await assert.rejects(()=>putMarketImage(media,key,jpeg,async()=>({status:302})),
    {code:"media_provider_unavailable"});
});
test("owner-only upload stages object, stores only key, blocks private public URL and supports removal",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"wae-media-unit-"));
  let puts=0,deletes=0;
  const transport=async(_url,request)=>{
    if(request.method==="PUT") {puts++;return {status:200};}
    if(request.method==="DELETE") {deletes++;return {status:204};}
    throw Error("unexpected_request");
  };
  const owner=await registerAccount({
    name:"Dueña de tienda",email:"photo-owner@example.test",
    password:"Safe-test-passphrase-2026-for-owner"
  },dir);
  const stranger=await registerAccount({
    name:"Visitante",email:"photo-buyer@example.test",
    password:"Safe-test-passphrase-2026-for-buyer"
  },dir);
  const bearer="Bearer "+owner.token;
  try {
    const company=await addBusiness(bearer,{
      name:"Boutique",category:"Moda",city:"Zapopan"},dir);
    const item=await addMarketListing(bearer,company.id,listing,dir);
    await assert.rejects(()=>uploadMarketPhoto("Bearer "+stranger.token,
      company.id,item.id,{imageDataUrl},dir,{media,transport}),{code:"business_missing"});
    assert.equal(puts,0,"must authorize before uploading bytes");
    const saved=await uploadMarketPhoto(bearer,company.id,item.id,{imageDataUrl},
      dir,{media,transport});
    assert.equal(puts,1);
    assert.equal(saved.uploaded,true);
    const [record]=(await listOwnerListings(bearer,company.id,dir)).items;
    assert.ok(record.imageKey.startsWith("marketplace/"+company.id+"/"+item.id+"/"));
    assert.equal(record.imageDataUrl,null);
    const raw=await readFile(join(dir,(await readdir(dir))[0]),"utf8");
    assert.equal(raw.includes(record.imageKey),false,"encrypted DB must not store raw key");
    assert.equal(raw.includes(imageDataUrl),false);
    await assert.rejects(()=>getPublicMarketPhotoLink(company.id,item.id,dir,
      {media}),{code:"listing_missing"});
    const own=await getMarketPhotoLink(bearer,company.id,item.id,dir,{media});
    assert.match(own.url,/X-Amz-Expires=120/);
    assert.equal(own.expiresIn,120);
    await updateBusinessVisibility(bearer,company.id,true,dir);
    await setMarketListingVisibility(bearer,company.id,item.id,true,dir);
    assert.ok((await getPublicMarketPhotoLink(company.id,item.id,dir,{media})).url);
    await setMarketListingVisibility(bearer,company.id,item.id,false,dir);
    await assert.rejects(()=>getPublicMarketPhotoLink(company.id,item.id,dir,{media}),
      {code:"listing_missing"});
    const removed=await removeMarketPhoto(bearer,company.id,item.id,dir,{media,transport});
    assert.equal(removed.removed,true);
    assert.equal(removed.objectQueued,true);
    assert.equal(deletes,0);
    assert.equal((await inspectMarketMediaQueue(dir)).queued,1);
    assert.equal((await listOwnerListings(bearer,company.id,dir)).items[0].imageKey,null);
    await assert.rejects(()=>getMarketPhotoLink(bearer,company.id,item.id,dir,{media}),
      {code:"media_not_found"});
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test("provider failure never leaves a photo reference in account record",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"wae-media-fail-"));
  try {
    const owner=await registerAccount({
      name:"Empresa segura",email:"photo-fail@example.test",
      password:"Safe-test-passphrase-2026-for-fail"
    },dir);
    const bearer="Bearer "+owner.token;
    const company=await addBusiness(bearer,{
      name:"Comercio seguro",category:"Moda",city:"Zapopan"},dir);
    const item=await addMarketListing(bearer,company.id,listing,dir);
    await assert.rejects(()=>uploadMarketPhoto(bearer,company.id,item.id,
      {imageDataUrl},dir,{media,transport:async()=>({status:500})}),
      {code:"media_provider_unavailable"});
    assert.equal((await listOwnerListings(bearer,company.id,dir)).items[0].imageKey,undefined);
  }finally {await rm(dir,{recursive:true,force:true});}
});

test("encrypted journal survives photo replacement, delete listing and delete business; cleanup retries safely",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"wae-media-journal-"));
  const previousAck=process.env.WAE_MARKET_MEDIA_CLEANUP_ACK;
  const objects=new Set();
  let failDelete=true;
  const transport=async(url,request)=>{
    const key=new URL(url).pathname;
    if(request.method==="PUT"){objects.add(key);return {status:200};}
    if(request.method==="DELETE"){
      if(failDelete)return {status:503};
      objects.delete(key);return {status:204};
    }
    throw Error("unexpected_method");
  };
  try {
    const owner=await registerAccount({
      name:"Negocio",email:"journal-owner@example.test",
      password:"Safe-test-passphrase-2026-for-journal"
    },dir);
    const bearer="Bearer "+owner.token;
    const business=await addBusiness(bearer,{
      name:"Empresa",category:"Moda",city:"Zapopan"},dir);
    const first=await addMarketListing(bearer,business.id,listing,dir);
    await uploadMarketPhoto(bearer,business.id,first.id,{imageDataUrl},dir,{media,transport});
    await uploadMarketPhoto(bearer,business.id,first.id,{imageDataUrl},dir,{media,transport});
    assert.equal(objects.size,2);
    assert.equal((await inspectMarketMediaQueue(dir)).queued,1);
    const second=await addMarketListing(bearer,business.id,listing,dir);
    await uploadMarketPhoto(bearer,business.id,second.id,{imageDataUrl},dir,{media,transport});
    await deleteMarketListing(bearer,business.id,second.id,dir);
    await deleteBusiness(bearer,business.id,dir);
    assert.equal((await inspectMarketMediaQueue(dir)).queued,3);
    const manifest=await auditMarketMediaReferences(dir);
    assert.equal(manifest.referenced,0);
    assert.equal(manifest.providerObjectsVerified,false);
    assert.equal(manifest.objectBackupVerified,false);
    assert.equal(manifest.fingerprint.length,64);
    assert.equal(JSON.stringify(manifest).includes("marketplace/"),false);
    const envelope=await readFile(join(dir,"accounts.encrypted.json"),"utf8");
    for(const key of objects)assert.equal(envelope.includes(key),false);
    await assert.rejects(()=>drainMarketMediaQueue({base:dir,media,transport,
      confirm:true,now:Date.now()+360000}),{code:"media_cleanup_not_authorized"});
    process.env.WAE_MARKET_MEDIA_CLEANUP_ACK="reviewed-object-deletions";
    const failed=await drainMarketMediaQueue({base:dir,media,transport,confirm:true,
      now:Date.now()+360000});
    assert.equal(failed.failed,3);
    assert.equal(failed.remaining,3);
    assert.equal(objects.size,3);
    failDelete=false;
    const completed=await drainMarketMediaQueue({base:dir,media,transport,confirm:true,
      now:Date.now()+360000});
    assert.equal(completed.removed,3);
    assert.equal(completed.remaining,0);
    assert.equal(objects.size,0);
    assert.equal((await inspectMarketMediaQueue(dir)).queued,0);
  } finally {
    if(previousAck===undefined)delete process.env.WAE_MARKET_MEDIA_CLEANUP_ACK;
    else process.env.WAE_MARKET_MEDIA_CLEANUP_ACK=previousAck;
    await rm(dir,{recursive:true,force:true});
  }
});

test.after(()=>{
  for(const [key,val] of Object.entries(prev)){
    if(val===undefined)delete process.env[key];else process.env[key]=val;
  }
});
