import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {imageIntent,imageOrientation,imageKind,imageCanonical,rankImageResults} from "../server/image-intelligence.mjs";
import {openverseImages,wikimediaImages,googleSearch,braveSearch,search} from "../server/search.mjs";

test("image intent and facets derive from query and authentic metadata, not claimed computer vision",()=>{
  assert.equal(imageIntent("bolsas para dama"),"productos");
  assert.equal(imageIntent("logo de mi marca"),"logotipos");
  assert.equal(imageIntent("Museo Soumaya arquitectura"),"lugares");
  assert.equal(imageIntent("diagrama de base de datos"),"diagramas");
  assert.equal(imageIntent("sin indicación"),"general");
  assert.equal(imageOrientation({width:1600,height:900}),"horizontal");
  assert.equal(imageOrientation({width:900,height:1600}),"vertical");
  assert.equal(imageOrientation({width:1080,height:1100}),"cuadrada");
  assert.equal(imageOrientation({}),"desconocida");
  assert.equal(imageKind({title:"Logo de compañía",mime:"image/png"}),"logo");
  assert.equal(imageKind({title:"Registro",mime:"image/jpeg"}),"foto");
  assert.equal(imageKind({title:"Registro"}),"sin_clasificar");
});
test("image ranking prioritizes match, retains distinct assets and deduplicates size variants",()=>{
  const base={url:"https://gallery.example.org/soumaya",source:"Wikimedia Commons",snippet:"Museo en México"};
  const images=[
    {...base,title:"Otro monumento",image:"https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Soumaya.jpg/520px-Soumaya.jpg",
      fullImage:"https://upload.wikimedia.org/wikipedia/commons/a/ab/Soumaya.jpg",
      width:1200,height:800},
    {...base,title:"Museo Soumaya arquitectura",image:"https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/Soumaya.jpg/720px-Soumaya.jpg",
      fullImage:"https://upload.wikimedia.org/wikipedia/commons/a/ab/Soumaya.jpg",
      width:1600,height:900},
    {...base,title:"Museo Soumaya segundo ángulo",image:"https://upload.wikimedia.org/wikipedia/commons/a/ab/Soumaya_2.jpg",
      fullImage:"https://upload.wikimedia.org/wikipedia/commons/a/ab/Soumaya_2.jpg",width:1000,height:1600},
    {...base,title:"Sin enlace",image:"javascript:alert(1)"}
  ];
  const ranked=rankImageResults(images,"Museo Soumaya");
  assert.equal(ranked.intent,"lugares");
  assert.equal(ranked.results.length,2);
  assert.equal(ranked.duplicatesRemoved,1);
  assert.equal(ranked.results[0].title,"Museo Soumaya arquitectura");
  assert.equal(ranked.results[1].orientation,"vertical");
  assert.equal(imageCanonical(images[0].image),imageCanonical(images[1].image));
  assert.equal(imageCanonical("https://example.org/a.jpg?q=one"),
    "https://example.org/a.jpg?q=one","meaningful asset params remain");
});
test("Openverse and Commons carry only provider-supplied dimensions, full images and licenses",async()=>{
  const before=globalThis.fetch;
  globalThis.fetch=async input=>{
    const u=new URL(input);
    if(u.hostname==="api.openverse.org"){
      assert.equal(u.searchParams.get("page_size"),"30");
      return new Response(JSON.stringify({results:[{
        title:"Bolsa beige",source:"flickr",foreign_landing_url:"https://flickr.example/123",
        url:"https://assets.example.org/bag.jpg",thumbnail:"https://assets.example.org/bag-small.jpg",
        creator:"Autora",license:"by",width:1800,height:1200,filetype:"jpg"
      }]}),{status:200});
    }
    if(u.hostname==="commons.wikimedia.org"){
      assert.equal(u.searchParams.get("gsrlimit"),"48");
      assert.match(u.searchParams.get("iiprop"),/size/);
      return new Response(JSON.stringify({query:{pages:{"1":{
        title:"File:Bolsa azul.jpg",imageinfo:[{
          mime:"image/jpeg",width:2000,height:1300,
          url:"https://upload.wikimedia.org/blue.jpg",
          thumburl:"https://upload.wikimedia.org/blue-small.jpg",
          descriptionurl:"https://commons.wikimedia.org/wiki/File:Bolsa_azul.jpg",
          extmetadata:{LicenseShortName:{value:"CC BY-SA 4.0"}}
        }]
      }}}}),{status:200});
    }
    throw Error("Unexpected "+u);
  };
  try{
    const open=await openverseImages("bolsas");
    assert.equal(open[0].width,1800);
    assert.equal(open[0].fullImage,"https://assets.example.org/bag.jpg");
    assert.equal(open[0].license,"by");
    const commons=await wikimediaImages("bolsas");
    assert.equal(commons[0].height,1300);
    assert.equal(commons[0].license,"CC BY-SA 4.0");
    assert.equal(commons[0].source,"Wikimedia Commons");
  }finally{globalThis.fetch=before;}
});
test("image search blends non-paid real providers and retains same landing page with different images",async()=>{
  const old=globalThis.fetch;
  const keys=["BRAVE_SEARCH_API_KEY","GOOGLE_SEARCH_API_KEY","GOOGLE_SEARCH_ENGINE_ID"];
  const saved=keys.map(k=>process.env[k]);keys.forEach(k=>delete process.env[k]);
  globalThis.fetch=async input=>{
    const u=new URL(input);
    if(u.hostname==="api.openverse.org")
      return new Response(JSON.stringify({results:[
        {title:"Museo Soumaya arquitectura vista uno",source:"flickr",
          foreign_landing_url:"https://gallery.example.org/album",
          thumbnail:"https://images.example.org/museum1.jpg",width:1500,height:1200},
        {title:"Museo Soumaya arquitectura vista dos",source:"flickr",
          foreign_landing_url:"https://gallery.example.org/album",
          thumbnail:"https://images.example.org/museum2.jpg",width:900,height:1600}
      ]}),{status:200});
    if(u.hostname==="commons.wikimedia.org")
      return new Response(JSON.stringify({query:{pages:{"1":{
        title:"File:Soumaya_III.jpg",imageinfo:[{mime:"image/jpeg",width:1800,height:1200,
        url:"https://upload.wikimedia.org/museum3.jpg",
        thumburl:"https://upload.wikimedia.org/museum3-small.jpg",
        descriptionurl:"https://commons.wikimedia.org/wiki/File:Soumaya_III.jpg"}]
      }}}}),{status:200});
    throw Error("Unexpected "+u);
  };
  try{
    const found=await search("Museo Soumaya arquitectura","images",{fresh:true});
    assert.equal(found.results.length,3,"multiple images from one album remain distinct");
    assert.equal(found.imageDiscovery.intent,"lugares");
    assert.equal(found.imageDiscovery.dimensionsKnown,3);
    assert.equal(found.imageDiscovery.visualModelUsed,false);
    assert.equal(found.mediaCoverage.commonsAvailable,true);
    assert.equal(found.mediaCoverage.webIndex,false);
    assert.equal(found.results[0].kind,"sin_clasificar");
    assert.equal(found.message,null);
  }finally{
    globalThis.fetch=old;
    keys.forEach((k,i)=>saved[i]===undefined?delete process.env[k]:process.env[k]=saved[i]);
  }
});
test("general indexes keep actual source landing pages, original image and source metadata",async()=>{
  const previous=globalThis.fetch;
  const google=process.env.GOOGLE_SEARCH_API_KEY,cx=process.env.GOOGLE_SEARCH_ENGINE_ID,
    brave=process.env.BRAVE_SEARCH_API_KEY;
  process.env.GOOGLE_SEARCH_API_KEY="unit-key";
  process.env.GOOGLE_SEARCH_ENGINE_ID="unit-engine";
  process.env.BRAVE_SEARCH_API_KEY="unit-brave";
  globalThis.fetch=async input=>{
    const u=new URL(input);
    if(u.hostname==="www.googleapis.com")return new Response(JSON.stringify({items:[{
      title:"Bolsa artesanal",link:"https://media.example.org/item-original.jpg",
      image:{contextLink:"https://shop.example.org/producto",thumbnailLink:"https://media.example.org/thumb.jpg",
        width:2000,height:1500}
    }]}),{status:200});
    if(u.hostname==="api.search.brave.com")return new Response(JSON.stringify({results:[{
      title:"Bolsa azul",url:"https://shop.example.org/bolsa",
      thumbnail:{src:"https://img.example.org/bolsa-small.jpg"},
      properties:{width:1600,height:1100,url:"https://img.example.org/bolsa.jpg"}
    }]}),{status:200});
    throw Error("unexpected "+u);
  };
  try{
    const g=await googleSearch("bolsa","images");
    assert.equal(g[0].url,"https://shop.example.org/producto");
    assert.equal(g[0].fullImage,"https://media.example.org/item-original.jpg");
    assert.equal(g[0].width,2000);
    const b=await braveSearch("bolsa","images");
    assert.equal(b[0].width,1600);
    assert.equal(b[0].fullImage,"https://img.example.org/bolsa.jpg");
  }finally{
    globalThis.fetch=previous;
    google===undefined?delete process.env.GOOGLE_SEARCH_API_KEY:process.env.GOOGLE_SEARCH_API_KEY=google;
    cx===undefined?delete process.env.GOOGLE_SEARCH_ENGINE_ID:process.env.GOOGLE_SEARCH_ENGINE_ID=cx;
    brave===undefined?delete process.env.BRAVE_SEARCH_API_KEY:process.env.BRAVE_SEARCH_API_KEY=brave;
  }
});
test("premium gallery exposes functional original source, facets, load more and a truthful similar-title action",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  const css=readFileSync(new URL("../public/styles.css",import.meta.url),"utf8");
  assert.match(app,/Encuentra la imagen indicada/);
  assert.match(app,/state\.imageKind=kind;state\.imageVisibleCount=24;renderData\(data\)/);
  assert.match(app,/state\.imageOrientation=orientation;state\.imageVisibleCount=24;renderData\(data\)/);
  assert.match(app,/item\.width\)>=1200&&Number\(item\.height\)>=800/);
  assert.match(app,/state\.imageVisibleCount\+=24;renderData\(data\)/);
  assert.match(app,/Buscar por título similar/);
  assert.match(app,/↗ Fuente original/);
  assert.match(app,/workspace\.add\(item\)/);
  assert.match(css,/\.wae-image-search-head/);
  assert.match(css,/\.image-tile-placeholder/);
});
