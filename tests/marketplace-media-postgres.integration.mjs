import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import { loginAccount, listBusinesses, addMarketListing, listOwnerListings,
  setMarketListingVisibility, getPublicMarketCatalog, inspectMarketMediaQueue, drainMarketMediaQueue, auditMarketMediaPresence } from "../server/accounts.mjs";
import { readAccountsPostgres, closeAccountsPostgres } from "../server/accounts-postgres.mjs";
import { handler } from "../server/index.mjs";

const jpeg=Buffer.from([255,216,255,224,0,0,1,2,3,4,255,217]);
const imageDataUrl="data:image/jpeg;base64,"+jpeg.toString("base64");
const desc={kind:"product",title:"Imagen separada",category:"Moda",
  description:"Producto de integración PostgreSQL y almacenamiento externo",
  availability:"available",price:"499.50"};
test("disposable PostgreSQL + local S3 fixture verify encrypted refs, owner and public image access",{
  skip:process.env.WAE_PG_INTEGRATION!=="true"
},async()=>{
  assert.equal(process.env.NODE_ENV,"test");
  assert.equal(process.env.WAE_ACCOUNTS_STORE,"postgres");
  const original=Object.fromEntries(["WAE_MARKET_MEDIA_STORE","WAE_MEDIA_ENDPOINT",
    "WAE_MEDIA_BUCKET","WAE_MEDIA_REGION","WAE_MEDIA_ACCESS_KEY_ID",
    "WAE_MEDIA_SECRET_ACCESS_KEY","WAE_MEDIA_ALLOW_LOCAL_TEST",
    "WAE_MARKET_MEDIA_CLEANUP_ACK"].map(x=>[x,process.env[x]]));
  const photos=new Map();
  const provider=http.createServer(async(req,res)=>{
    const chunks=[];
    for await (const chunk of req) chunks.push(chunk);
    const body=Buffer.concat(chunks);
    if(req.method==="PUT") {
      if(!req.headers.authorization?.startsWith("AWS4-HMAC-SHA256 ") ||
         req.headers["x-amz-content-sha256"]!==
           createHash("sha256").update(body).digest("hex")) {
        res.writeHead(403);return res.end();
      }
      photos.set(req.url,body);res.writeHead(200);return res.end();
    }
    if(req.method==="HEAD") {
      if(!req.headers.authorization?.startsWith("AWS4-HMAC-SHA256 ")) {
        res.writeHead(403);return res.end();
      }
      const bytes=photos.get(req.url);
      if(!bytes){res.writeHead(404);return res.end();}
      res.writeHead(200,{"content-length":String(bytes.length)});
      return res.end();
    }
    if(req.method==="GET") {
      const u=new URL(req.url,"http://localhost");
      if(u.searchParams.get("X-Amz-Expires")!=="120" ||
         !/^[a-f0-9]{64}$/.test(u.searchParams.get("X-Amz-Signature")||"")) {
        res.writeHead(403);return res.end();
      }
      const bytes=photos.get(u.pathname);
      if(!bytes){res.writeHead(404);return res.end();}
      res.writeHead(200,{"content-type":"image/jpeg"});
      return res.end(bytes);
    }
    if(req.method==="DELETE"){
      photos.delete(req.url);res.writeHead(204);return res.end();
    }
    res.writeHead(405);res.end();
  });
  const app=http.createServer((req,res)=>handler(req,res));
  try{
    await new Promise(resolve=>provider.listen(0,"127.0.0.1",resolve));
    Object.assign(process.env,{
      WAE_MARKET_MEDIA_STORE:"s3",
      WAE_MEDIA_ENDPOINT:"http://127.0.0.1:"+provider.address().port+"/",
      WAE_MEDIA_BUCKET:"wae-test-market-media",
      WAE_MEDIA_REGION:"us-east-1",
      WAE_MEDIA_ACCESS_KEY_ID:"EXAMPLE_MEDIA_TEST_ONLY",
      WAE_MEDIA_SECRET_ACCESS_KEY:"ci-only-fake-media-secret-never-production",
      WAE_MEDIA_ALLOW_LOCAL_TEST:"true"
    });
    const owner=await loginAccount({
      email:"postgres-owner@example.test",
      password:"Secure-Test-Password-2026-Account"
    });
    const bearer="Bearer "+owner.token;
    const company=(await listBusinesses(bearer)).businesses
      .find(item=>item.name==="Negocio persistente");
    assert.ok(company,"previous PostgreSQL test must initialize synthetic company");
    const item=await addMarketListing(bearer,company.id,desc);
    assert.equal((await listOwnerListings(bearer,company.id)).limit,40);
    await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));
    const root="http://127.0.0.1:"+app.address().port;
    const endpoint="/api/businesses/"+company.id+"/listings/"+item.id+"/image";
    const api=async(path,method="GET",body,token)=>{
      const response=await fetch(root+path,{
        method,redirect:"manual",headers:{
          accept:"application/json",
          ...(body?{"content-type":"application/json"}:{}),
          ...(token?{authorization:"Bearer "+token}:{})
        },
        body:body?JSON.stringify(body):undefined
      });
      if(response.status===302)return {status:302,location:response.headers.get("location")};
      return {status:response.status,body:await response.json()};
    };
    const caps=await api("/api/capabilities");
    assert.equal(caps.body.marketplaceObjectMedia,true);
    assert.equal((await api(endpoint,"POST",{imageDataUrl})).status,401);
    assert.equal((await api(endpoint,"POST",{imageDataUrl},owner.token)).status,201);
    const saved=(await listOwnerListings(bearer,company.id)).items
      .find(entry=>entry.id===item.id);
    assert.ok(saved.imageKey);
    assert.equal(saved.imageDataUrl,null);
    const encrypted=await readAccountsPostgres();
    assert.equal(encrypted.includes(imageDataUrl),false);
    assert.equal(encrypted.includes(saved.imageKey),false);
    const recovery=await auditMarketMediaPresence({limit:25});
    assert.equal(recovery.status,"presence_checked_only");
    assert.equal(recovery.present,1);
    assert.equal(recovery.restoreCertified,false);
    assert.equal(JSON.stringify(recovery).includes(saved.imageKey),false);
    const privateImage=await api(endpoint,"GET",undefined,owner.token);
    assert.equal(privateImage.status,200);
    assert.equal(privateImage.body.expiresIn,120);
    const publicEndpoint="/api/marketplace/images/"+company.id+"/"+item.id;
    assert.equal((await api(publicEndpoint)).status,404);
    await setMarketListingVisibility(bearer,company.id,item.id,true);
    const publicCatalog=await getPublicMarketCatalog(company.id);
    assert.equal(publicCatalog.items.find(entry=>entry.id===item.id).imageUrl,
      publicEndpoint);
    assert.equal(publicCatalog.items.find(entry=>entry.id===item.id).imageKey,undefined);
    const redirect=await api(publicEndpoint);
    assert.equal(redirect.status,302);
    assert.equal(redirect.location.includes(process.env.WAE_MEDIA_SECRET_ACCESS_KEY),false);
    const bytes=Buffer.from(await (await fetch(redirect.location)).arrayBuffer());
    assert.equal(bytes.equals(jpeg),true);
    await setMarketListingVisibility(bearer,company.id,item.id,false);
    assert.equal((await api(publicEndpoint)).status,404);
    const removed=await api(endpoint,"DELETE",undefined,owner.token);
    assert.equal(removed.status,200);
    assert.equal((await api(endpoint,"GET",undefined,owner.token)).status,404);
    assert.equal(photos.size,1,"image is queued rather than deleted immediately");
    assert.equal((await inspectMarketMediaQueue()).queued,1);
    process.env.WAE_MARKET_MEDIA_CLEANUP_ACK="reviewed-object-deletions";
    const cleaned=await drainMarketMediaQueue({
      confirm:true,now:Date.now()+360000
    });
    assert.equal(cleaned.removed,1);
    assert.equal(cleaned.remaining,0);
    assert.equal(photos.size,0);
  }finally{
    if(app.listening)await new Promise(resolve=>app.close(resolve));
    if(provider.listening)await new Promise(resolve=>provider.close(resolve));
    await closeAccountsPostgres().catch(()=>{});
    for(const [key,value] of Object.entries(original)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
  }
});
