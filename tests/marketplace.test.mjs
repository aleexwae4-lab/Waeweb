import test from "node:test";
import assert from "node:assert/strict";
import { createListing, validateListing, searchMarketplace, MarketplaceError } from "../server/marketplace.mjs";

const biz={id:"00000000-0000-4000-8000-000000000001",name:"WAE Studio",city:"Zapopan",visibility:"public",listings:[]};
const base={kind:"service",title:"Diseño de marca",category:"Diseño",description:"Identidad visual empresarial",price:"1290.50",availability:"available"};
test("marketplace listing is private by default and price uses integer cents",()=>{
  const item=createListing(base);
  assert.equal(item.visibility,"owner_only");
  assert.equal(item.priceCents,129050);
  assert.equal(item.currency,"MXN");
  assert.match(item.id,/^[0-9a-f-]{36}$/i);
});
test("catalog search requires public business and explicit public listing",()=>{
  const item={...createListing(base),visibility:"public"};
  const users=[{businesses:[{...biz,listings:[item]}]}];
  const found=searchMarketplace(users,{q:"marca",kind:"service",city:"Zapo",page:1});
  assert.equal(found.total,1);
  assert.equal(found.items[0].businessName,"WAE Studio");
  assert.equal(found.items[0].verification,"self_declared");
  const hidden=searchMarketplace([{businesses:[{...biz,visibility:"owner_only",listings:[item]}]}],{});
  assert.equal(hidden.total,0);
});
test("search pagination is deterministic and bounded",()=>{
  const listings=Array.from({length:23},(_,i)=>({...createListing({...base,title:"Servicio "+i}),visibility:"public",
    createdAt:new Date(Date.UTC(2026,0,1,0,0,i)).toISOString()}));
  const users=[{businesses:[{...biz,listings}]}];
  assert.equal(searchMarketplace(users,{page:1}).items.length,20);
  const second=searchMarketplace(users,{page:2});
  assert.equal(second.items.length,3);assert.equal(second.hasMore,false);
  assert.throws(()=>searchMarketplace(users,{page:31}),MarketplaceError);
});
test("unsafe or oversized inputs and forged images fail closed",()=>{
  assert.throws(()=>validateListing({...base,price:"1.999"}),MarketplaceError);
  assert.throws(()=>validateListing({...base,kind:"other"}),MarketplaceError);
  assert.throws(()=>validateListing({...base,imageDataUrl:"data:image/svg+xml;base64,PHN2Zz4="}),MarketplaceError);
  const fake=Buffer.from("not a jpeg").toString("base64");
  assert.throws(()=>validateListing({...base,imageDataUrl:"data:image/jpeg;base64,"+fake}),MarketplaceError);
});
test("editing without image field preserves existing photo",()=>{
  const png="data:image/png;base64,"+Buffer.from([137,80,78,71,13,10,26,10,0]).toString("base64");
  const previous={...createListing(base),imageDataUrl:png};
  const edited=validateListing({...base,title:"Marca premium"},previous);
  assert.equal(edited.imageDataUrl,png);
});
