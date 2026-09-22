import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { handler } from "../server/index.mjs";

test("HTTP contact and report enforce buyer consent, authenticated reports and owner-only inbox",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"wae-interactions-"));
  const keys=["WAE_ACCOUNTS_ENABLED","WAE_ACCOUNTS_KEY","WAE_ACCOUNTS_STORE","WAE_ACCOUNTS_DIR"];
  const prev=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
  Object.assign(process.env,{WAE_ACCOUNTS_ENABLED:"true",WAE_ACCOUNTS_KEY:"df".repeat(32),
    WAE_ACCOUNTS_STORE:"file",WAE_ACCOUNTS_DIR:dir});
  const server=http.createServer((req,res)=>handler(req,res));
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const root="http://127.0.0.1:"+server.address().port;
    const call=async(path,method="GET",body,token)=>{
      const resp=await fetch(root+path,{method,headers:{
        accept:"application/json",...(body?{"content-type":"application/json"}:{}),
        ...(token?{authorization:"Bearer "+token}:{})},
        body:body?JSON.stringify(body):undefined});
      return {status:resp.status,data:await resp.json()};
    };
    const signup=async(email)=>{
      const r=await call("/api/account/register","POST",{
        name:"Usuario Prueba",email,password:"Safe-and-long-2026-test-password"});
      assert.equal(r.status,201);return r.data.token;
    };
    const seller=await signup("seller-interactions@example.test");
    const buyer=await signup("buyer-interactions@example.test");
    const company=await call("/api/businesses","POST",{
      name:"Empresa WAE",category:"Servicios",city:"Zapopan"},seller);
    assert.equal(company.status,201);
    const id=company.data.business.id;
    assert.equal((await call("/api/businesses/"+id,"PATCH",{published:true},seller)).status,200);
    const article=await call("/api/businesses/"+id+"/listings","POST",{
      kind:"service",title:"Diseño de marca",category:"Diseño",
      description:"Diseño de identidad corporativa",availability:"available",price:"500"},seller);
    assert.equal(article.status,201);
    const listing=article.data.item.id;
    assert.equal((await call("/api/businesses/"+id+"/listings/"+listing+"/visibility",
      "PATCH",{published:true},seller)).status,200);
    const contact="/api/marketplace/"+id+"/"+listing+"/inquiries";
    const request={message:"¿Cuánto dura el proceso?",consent:true};
    assert.equal((await call(contact,"POST",request)).status,401);
    assert.equal((await call(contact,"POST",{...request,consent:false},buyer)).status,422);
    assert.equal((await call(contact,"POST",request,buyer)).status,201);
    assert.equal((await call(contact,"POST",request,buyer)).status,409);
    assert.equal((await call("/api/businesses/"+id+"/inquiries","GET",undefined,buyer)).status,404);
    const inbox=await call("/api/businesses/"+id+"/inquiries","GET",undefined,seller);
    assert.equal(inbox.status,200);
    assert.equal(inbox.data.items[0].buyerEmail,"buyer-interactions@example.test");
    const publicResponse=await call("/api/marketplace?q=marca");
    assert.equal(publicResponse.status,200);
    assert.equal(publicResponse.data.total,1);
    assert.equal(JSON.stringify(publicResponse.data).includes("buyer-interactions@example.test"),false);
    const report="/api/marketplace/"+id+"/"+listing+"/reports";
    assert.equal((await call(report,"POST",{reason:"fraud"})).status,401);
    assert.equal((await call(report,"POST",{reason:"fraud"},buyer)).status,201);
    assert.equal((await call(report,"POST",{reason:"spam"},buyer)).status,409);
    assert.equal((await call("/api/marketplace?q=marca")).data.total,1);
  }finally{
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    for(const [key,value] of Object.entries(prev)){
      if(value===undefined)delete process.env[key];else process.env[key]=value;
    }
    await rm(dir,{recursive:true,force:true});
  }
});
