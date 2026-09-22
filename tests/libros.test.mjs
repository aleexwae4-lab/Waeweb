import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import {readFile} from "node:fs/promises";
import {handler} from "../server/index.mjs";
import {priceToCents,royaltyQuote,formatMXN} from "../public/royalties.js";

test("exact author 70% / platform 30% split in MXN cents",()=>{
  const quote=royaltyQuote("199.00");
  assert.deepEqual(quote,{
    priceCents:19900,authorCents:13930,platformCents:5970,
    currency:"MXN",authorPercent:70,platformPercent:30
  });
  for(const price of ["20","199.99","9999.99","10000"]){
    const {priceCents,authorCents,platformCents}=royaltyQuote(price);
    assert.equal(authorCents+platformCents,priceCents,"cannot lose cents");
    assert.equal(platformCents,Math.floor(priceCents*0.3));
  }
  assert.match(formatMXN(19900),/199/);
});
test("rejects negative, zero, abusive, invalid and fractional-cent prices",()=>{
  for(const value of ["0","-30","10","10000.01","9999999","19.99","199.999","1e4","NaN","",null,Infinity]){
    assert.throws(()=>priceToCents(value),value+" must not be accepted");
  }
  assert.equal(priceToCents("20"),2000);
  assert.equal(priceToCents("10000"),1000000);
});
test("homepage removes requested sentence and has a footer author bookstore link",async()=>{
  const html=await readFile(new URL("../public/index.html",import.meta.url),"utf8");
  const hint="Una sola barra para investigar y abrir sitios web. Si una página impide la vista integrada, podrás abrir su sitio original.";
  assert.ok(!html.includes(hint),"requested hero contamination must be absent");
  const footer=html.slice(html.indexOf('<footer class="footer">'));
  assert.match(footer,/<a class="footer-books-link" href="\/libros.html"/);
  assert.ok(footer.indexOf('href="/libros.html"')<footer.indexOf("</footer>"));
  assert.match(html,/data-type="books"/,"research books tab must not be removed");
});
test("editorial page is honest, free to prepare and payments/publishing stay disabled",async()=>{
  const html=await readFile(new URL("../public/libros.html",import.meta.url),"utf8");
  const app=await readFile(new URL("../public/libros.js",import.meta.url),"utf8");
  const css=await readFile(new URL("../public/libros.css",import.meta.url),"utf8");
  for(const id of [
    "catalogo","como-funciona","publicar","book-draft-form","book-manuscript",
    "book-cover","book-save-draft","author-auth-form","book-publish-action",
    "royalty-author","royalty-platform","book-preview-title"
  ])assert.ok(html.includes('id="'+id+'"'),"Missing "+id);
  assert.match(html,/id="book-publish-action"[^>]*disabled/);
  assert.match(html,/70 % para el autor/);
  assert.match(html,/30 % para WAEWEB/);
  assert.match(html,/No mostramos portadas ni reseñas ficticias/);
  assert.match(app,/localStorage\.setItem/);
  assert.match(html,/no se suben ni quedan guardados/,"file-handling disclosure is in HTML");
  assert.match(app,/\/api\/account\/register/);
  assert.match(app,/accountsEnabled===true&&data\.previewMode!==true/);
  assert.match(css,/book-cover-placeholder\.has-cover/);
  assert.doesNotMatch(app,/\/api\/promotions\/|checkout\.stripe/,"cannot borrow business-promotions billing for ebook sales");
});
test("Node serves author page and assets without exposing private pages or enabling preview signup",async()=>{
  const prev=process.env.WAE_PREVIEW_MODE;
  process.env.WAE_PREVIEW_MODE="true";
  const server=http.createServer((req,res)=>{handler(req,res).catch(error=>{
    res.statusCode=500;res.end(error.message);
  });});
  try{
    await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
    const origin="http://127.0.0.1:"+server.address().port;
    for(const [path,content] of [
      ["/libros",/WAEWEB/],
      ["/libros.html",/Mi espacio de autor/],
      ["/libros.css",/book-hero/],
      ["/libros.js",/royaltyQuote/],
      ["/royalties.js",/PLATFORM_BPS/]
    ]){
      const response=await fetch(origin+path);
      assert.equal(response.status,200,path);
      assert.match(await response.text(),content,path);
    }
    const cap=await (await fetch(origin+"/api/capabilities")).json();
    assert.equal(cap.accountsEnabled,false);
    const registration=await fetch(origin+"/api/account/register",{
      method:"POST",headers:{"content-type":"application/json"},
      body:JSON.stringify({email:"preview@example.test",name:"Preview",password:"NotARealPassword123!"})
    });
    assert.equal(registration.status,503);
    assert.equal((await registration.json()).previewMode,true);
    assert.equal((await fetch(origin+"/api/books",{method:"POST"})).status,503,
      "preview must deny any unauthorized ebook publishing writes");
  }finally{
    if(server.listening)await new Promise(resolve=>server.close(resolve));
    if(prev===undefined)delete process.env.WAE_PREVIEW_MODE;
    else process.env.WAE_PREVIEW_MODE=prev;
  }
});
