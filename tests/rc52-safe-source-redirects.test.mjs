import test from "node:test";
import assert from "node:assert/strict";
import {readPage,sameSiteRedirect} from "../server/reader.mjs";
import {registerWebHits,previewWebHit} from "../server/web-preview.mjs";
const publicDNS=async()=>[{address:"93.184.215.14",family:4}];
const html="<title>Artículo real</title><main>Contenido verdadero de una página pública recuperado únicamente después de comprobar permisos.</main>";
const ok={status:200,body:html,headers:{"content-type":"text/html; charset=utf-8"}};
test("redirect policy allows exact host and www alias but rejects unrelated sites",()=>{
  assert.equal(sameSiteRedirect("https://source.example.org/a",
    "https://www.source.example.org/b"),true);
  assert.equal(sameSiteRedirect("https://source.example.org/a",
    "https://other.example.org/b"),false);
  assert.equal(sameSiteRedirect("https://source.example.org/a",
    "https://source.example.org.evil.org/b"),false);
  assert.throws(()=>sameSiteRedirect("https://source.example.org/a",
    "http://source.example.org/b"),{code:"blocked_url"});
});
test("public reader follows ordinary same-site canonical redirect after per-route robots checks",async()=>{
  const calls=[];
  const url="https://canonical-reader-one.example.org/story";
  const doc=await readPage(url,{resolver:publicDNS,transport:async(u,ip)=>{
    calls.push(u.href);
    assert.equal(ip.address,"93.184.215.14");
    if(u.pathname==="/robots.txt")return {status:200,body:"User-agent: *\nDisallow: /private\nAllow: /story",headers:{}};
    if(u.pathname==="/story")return {status:301,location:"/story/",headers:{}};
    assert.equal(u.pathname,"/story/");
    return ok;
  }});
  assert.equal(doc.url,url+"/");
  assert.match(doc.text,/Contenido verdadero/);
  assert.deepEqual(calls,[
    "https://canonical-reader-one.example.org/robots.txt",
    url,url+"/"
  ]);
});
test("reader re-checks robots and DNS when canonical changes to www",async()=>{
  const calls=[];
  const url="https://canonical-reader-two.example.org/story";
  const doc=await readPage(url,{resolver:async(host,options)=>{
    calls.push("dns:"+host);
    return publicDNS();
  },transport:async(u)=>{
    calls.push(u.href);
    if(u.pathname==="/robots.txt")return {status:200,
      body:"User-agent: *\nAllow: /",headers:{}};
    if(u.hostname==="canonical-reader-two.example.org")
      return {status:302,location:"https://www.canonical-reader-two.example.org/story/",headers:{}};
    return ok;
  }});
  assert.equal(doc.url,"https://www.canonical-reader-two.example.org/story/");
  assert.ok(calls.includes("https://www.canonical-reader-two.example.org/robots.txt"));
  assert.ok(calls.includes("dns:www.canonical-reader-two.example.org"));
});
test("redirect to forbidden path is stopped before requesting its content",async()=>{
  const seen=[];
  await assert.rejects(()=>readPage("https://canonical-reader-three.example.org/article",{
    resolver:publicDNS,transport:async u=>{
      seen.push(u.pathname);
      if(u.pathname==="/robots.txt")return {status:200,body:"User-agent: *\nDisallow: /private",headers:{}};
      if(u.pathname==="/article")return {status:302,location:"/private/account",headers:{}};
      throw Error("Forbidden article must not be fetched");
    }
  }),{code:"robots_disallowed"});
  assert.deepEqual(seen,["/robots.txt","/article"]);
});
test("www redirect with forbidden target robots is stopped before reading page",async()=>{
  const seen=[];
  await assert.rejects(()=>readPage("https://canonical-reader-four.example.org/article",{
    resolver:publicDNS,transport:async u=>{
      seen.push(u.href);
      if(u.pathname==="/robots.txt")return {status:200,
        body:u.hostname.startsWith("www.")?"User-agent: *\nDisallow: /article":"User-agent: *\nAllow: /",headers:{}};
      if(!u.hostname.startsWith("www."))return {status:301,
        location:"https://www.canonical-reader-four.example.org/article",headers:{}};
      throw Error("Forbidden article must not be fetched");
    }
  }),{code:"robots_disallowed"});
  assert.ok(seen.includes("https://www.canonical-reader-four.example.org/robots.txt"));
  assert.ok(!seen.includes("https://www.canonical-reader-four.example.org/article"));
});
test("reader fails closed on private DNS at allowed www redirect",async()=>{
  const seen=[];
  await assert.rejects(()=>readPage("https://canonical-reader-five.example.org/article",{
    resolver:async host=>[{address:host.startsWith("www.")?"127.0.0.1":"93.184.215.14",family:4}],
    transport:async u=>{
      seen.push(u.href);
      if(u.pathname==="/robots.txt")return {status:404,body:"",headers:{}};
      return {status:302,location:"https://www.canonical-reader-five.example.org/article",headers:{}};
    }
  }),{code:"blocked_dns"});
  assert.deepEqual(seen,[
    "https://canonical-reader-five.example.org/robots.txt",
    "https://canonical-reader-five.example.org/article"
  ]);
});
test("redirected preview stays tied to recently searched original URL and discloses actual location",async()=>{
  const original="https://canonical-preview-six.example.org/guide";
  const final="https://www.canonical-preview-six.example.org/guide/";
  registerWebHits([{url:original,title:"Guía pública",source:"Brave Search"}]);
  const preview=await previewWebHit(original,{read:async()=>({
    url:final,title:"Guía canónica",
    text:"Texto recuperado desde la ruta canónica pública comprobada. ".repeat(4),
    fetchedAt:new Date().toISOString()
  })});
  assert.equal(preview.url,original);
  assert.equal(preview.resolvedUrl,final);
  assert.equal(preview.source,"Brave Search");
  assert.match(preview.excerpt,/ruta canónica/);
  await assert.rejects(()=>previewWebHit(original,{read:async()=>({
    url:"https://unrelated-preview-six.example.org/not-same",
    text:"Contenido que no pertenece al sitio original y no debe atribuirse.",
    fetchedAt:new Date().toISOString()
  })}),{code:"redirected"});
});
