import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handler } from "../server/index.mjs";
import { registerAccount, addBusiness, updateBusinessVisibility,
  listOwnerListings, addMarketListing, editMarketListing,
  setMarketListingVisibility, deleteMarketListing, getPublicMarketCatalog,
  browseMarketplace } from "../server/accounts.mjs";
const listing={kind:"product",title:"Bolsa elegante",category:"Moda",
  description:"Bolsa para dama, colección de temporada.",price:"349.50",
  availability:"available"};
test("catalog HTTP and persistence preserve tenant control and public consent",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"wae-market-http-"));
  const keys=["WAE_ACCOUNTS_ENABLED","WAE_ACCOUNTS_KEY","WAE_ACCOUNTS_STORE","WAE_ACCOUNTS_DIR"];
  const prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  Object.assign(process.env,{WAE_ACCOUNTS_ENABLED:"true",WAE_ACCOUNTS_KEY:"ef".repeat(32),
    WAE_ACCOUNTS_STORE:"file",WAE_ACCOUNTS_DIR:dir});
  let server;
  try{
    const a=await registerAccount({name:"Persona Uno",email:"one@example.test",
      password:"Strong-Example-Password-2026-One"},dir);
    const b=await registerAccount({name:"Persona Dos",email:"two@example.test",
      password:"Strong-Example-Password-2026-Two"},dir);
    const company=await addBusiness("Bearer "+a.token,{
      name:"Delia Shop",category:"Moda",city:"Zapopan",whatsapp:"+5213312345678"},dir);
    const mine="Bearer "+a.token,foreign="Bearer "+b.token;
    await assert.rejects(()=>listOwnerListings(foreign,company.id,dir),
      {code:"business_missing"});
    const item=await addMarketListing(mine,company.id,listing,dir);
    assert.equal(item.visibility,"owner_only");
    assert.equal((await browseMarketplace({},dir)).total,0);
    await assert.rejects(()=>setMarketListingVisibility(mine,company.id,item.id,true,dir),
      {code:"business_private"});
    await updateBusinessVisibility(mine,company.id,true,dir);
    await setMarketListingVisibility(mine,company.id,item.id,true,dir);
    assert.equal((await browseMarketplace({q:"bolsa",kind:"product",city:"Zapopan"},dir)).total,1);
    assert.equal((await browseMarketplace({kind:"service"},dir)).total,0);
    const publicItem=(await getPublicMarketCatalog(company.id,dir)).items[0];
    assert.equal(publicItem.email,undefined);
    assert.equal(publicItem.ownerId,undefined);
    assert.equal(publicItem.whatsapp,undefined,"the catalog should not publish contact details");
    await assert.rejects(()=>editMarketListing(foreign,company.id,item.id,listing,dir),
      {code:"business_missing"});
    const modified=await editMarketListing(mine,company.id,item.id,
      {...listing,title:"Bolsa actualizada",price:"500"},dir);
    assert.equal(modified.visibility,"public");
    assert.equal(modified.priceCents,50000);
    await updateBusinessVisibility(mine,company.id,false,dir);
    assert.equal((await browseMarketplace({},dir)).total,0);
    await updateBusinessVisibility(mine,company.id,true,dir);
    await setMarketListingVisibility(mine,company.id,item.id,false,dir);
    assert.equal((await getPublicMarketCatalog(company.id,dir)).items.length,0);
    server=http.createServer((req,res)=>handler(req,res));
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const url="http://127.0.0.1:"+server.address().port;
    const request=async(path,method="GET",body,auth)=>{
      const response=await fetch(url+path,{method,headers:{
        accept:"application/json",...(body?{"content-type":"application/json"}:{}),
        ...(auth?{authorization:auth}:{})},body:body?JSON.stringify(body):undefined});
      return {status:response.status,data:await response.json()};
    };
    const path="/api/businesses/"+company.id+"/listings";
    assert.equal((await request(path)).status,401);
    assert.equal((await request(path,"POST",listing)).status,401);
    assert.equal((await request("/api/marketplace?page=-1")).status,400);
    assert.equal((await request("/api/marketplace?kind=bad")).status,400);
    const created=await request(path,"POST",listing,mine);
    assert.equal(created.status,201);
    assert.equal((await request(path+"/"+created.data.item.id+"/visibility",
      "PATCH",{published:true},mine)).status,200);
    assert.equal((await request("/api/marketplace?q=bolsa")).data.total,1);
    assert.equal((await request("/api/businesses/public/"+company.id+"/listings")).data.items.length,1);
    assert.equal((await request("/api/businesses/public/"+company.id)).data.business.whatsapp,"+5213312345678");
    assert.equal((await request(path+"/"+created.data.item.id,"DELETE",null,mine)).status,200);
    assert.equal((await request("/api/marketplace?q=bolsa")).data.total,0);
    await deleteMarketListing(mine,company.id,item.id,dir);
    const cipher=await readFile(join(dir,"accounts.encrypted.json"),"utf8");
    assert.doesNotMatch(cipher,/Bolsa actualizada|Delia Shop|one@example.test/);
  }finally{
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    for(const [k,v] of Object.entries(prior)){if(v===undefined)delete process.env[k];else process.env[k]=v;}
    await rm(dir,{recursive:true,force:true});
  }
});
