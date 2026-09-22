import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  registerAccount, addBusiness, updateBusinessVisibility,
  addMarketListing, setMarketListingVisibility,
  sendMarketInquiry, getMarketInquiries, reportMarketListing,
  getPublicMarketCatalog, browseMarketplace
} from "../server/accounts.mjs";
import { MarketplaceTrustError, validateInquiry, validateReport } from "../server/marketplace-trust.mjs";
const previous={ enabled:process.env.WAE_ACCOUNTS_ENABLED, key:process.env.WAE_ACCOUNTS_KEY };
process.env.WAE_ACCOUNTS_ENABLED="true";
process.env.WAE_ACCOUNTS_KEY="fe".repeat(32);
const person=(name,email)=>({name,email,password:"A-test-password-with-more-than-12-characters"});
const listing={kind:"service",title:"Identidad de marca",category:"Diseño",
  description:"Servicio profesional de identidad visual",price:"1200",availability:"available"};

test("consent-based buyer inquiry is private, encrypted, scoped to owner and deduplicated",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"wae-trust-"));
  try {
    const owner=await registerAccount(person("Comercio","commerce@example.test"),dir);
    const buyer=await registerAccount(person("Cliente","customer@example.test"),dir);
    const outsider=await registerAccount(person("Visitante","other@example.test"),dir);
    const auth=x=>"Bearer "+x.token;
    const business=await addBusiness(auth(owner),{
      name:"Empresa privada",category:"Servicios",city:"Zapopan"},dir);
    const item=await addMarketListing(auth(owner),business.id,listing,dir);
    const request={consent:true,message:"Me interesa recibir una cotización."};
    await assert.rejects(()=>sendMarketInquiry(auth(buyer),business.id,item.id,request,dir),
      {code:"listing_missing"});
    await updateBusinessVisibility(auth(owner),business.id,true,dir);
    await setMarketListingVisibility(auth(owner),business.id,item.id,true,dir);
    await assert.rejects(()=>sendMarketInquiry(auth(owner),business.id,item.id,request,dir),
      {code:"self_inquiry"});
    await assert.rejects(()=>sendMarketInquiry(auth(buyer),business.id,item.id,{
      ...request,consent:false},dir),MarketplaceTrustError);
    const receipt=await sendMarketInquiry(auth(buyer),business.id,item.id,request,dir);
    assert.equal(receipt.received,true);
    assert.equal(receipt.buyerEmail,undefined);
    await assert.rejects(()=>sendMarketInquiry(auth(buyer),business.id,item.id,request,dir),
      {code:"inquiry_duplicate"});
    await assert.rejects(()=>getMarketInquiries(auth(outsider),business.id,dir),
      {code:"business_missing"});
    const inbox=await getMarketInquiries(auth(owner),business.id,dir);
    assert.equal(inbox.items.length,1);
    assert.equal(inbox.items[0].buyerEmail,"customer@example.test");
    const serialized=JSON.stringify(await browseMarketplace({},dir));
    assert.equal(serialized.includes("customer@example.test"),false);
    assert.equal(serialized.includes(request.message),false);
    assert.equal(JSON.stringify(await getPublicMarketCatalog(business.id,dir)).includes(request.message),false);
    const files=await readdir(dir);
    const stored=await readFile(join(dir,files[0]),"utf8");
    assert.equal(stored.includes("customer@example.test"),false);
    assert.equal(stored.includes(request.message),false);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test("reports are authenticated and structured; duplicates and self-report blocked; no auto-removal",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"wae-reports-"));
  try{
    const owner=await registerAccount(person("Comercio","seller@example.test"),dir);
    const buyer=await registerAccount(person("Cliente","reporter@example.test"),dir);
    const auth=x=>"Bearer "+x.token;
    const b=await addBusiness(auth(owner),{
      name:"Tienda empresarial",category:"Productos",city:"Zapopan"},dir);
    const item=await addMarketListing(auth(owner),b.id,listing,dir);
    await updateBusinessVisibility(auth(owner),b.id,true,dir);
    await setMarketListingVisibility(auth(owner),b.id,item.id,true,dir);
    await assert.rejects(()=>reportMarketListing(auth(owner),b.id,item.id,{reason:"fraud"},dir),
      {code:"self_report"});
    await assert.rejects(()=>reportMarketListing(null,b.id,item.id,{reason:"fraud"},dir),
      {code:"not_authenticated"});
    await assert.rejects(()=>reportMarketListing(auth(buyer),b.id,item.id,{reason:"script"},dir),
      MarketplaceTrustError);
    const report=await reportMarketListing(auth(buyer),b.id,item.id,{reason:"misleading"},dir);
    assert.deepEqual(report,{received:true,status:"pending_review"});
    await assert.rejects(()=>reportMarketListing(auth(buyer),b.id,item.id,{reason:"spam"},dir),
      {code:"report_duplicate"});
    const catalog=await browseMarketplace({q:"marca"},dir);
    assert.equal(catalog.total,1,"report must not cause automatic suspension");
    assert.equal(JSON.stringify(catalog).includes("reporter@example.test"),false);
  }finally{await rm(dir,{recursive:true,force:true});}
});
test("invalid consent, multiline injection and invalid reason fail validation",()=>{
  assert.throws(()=>validateInquiry({consent:true,message:"hola\nimporte personal"}),MarketplaceTrustError);
  assert.throws(()=>validateInquiry({consent:false,message:"Consulta profesional"}),MarketplaceTrustError);
  assert.throws(()=>validateReport({reason:"__proto__"}),MarketplaceTrustError);
});
test.after(()=>{
  for(const [env,val] of [["WAE_ACCOUNTS_ENABLED",previous.enabled],["WAE_ACCOUNTS_KEY",previous.key]]){
    if(val===undefined)delete process.env[env];else process.env[env]=val;
  }
});
