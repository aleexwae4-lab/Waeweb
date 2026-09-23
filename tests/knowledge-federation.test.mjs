import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {libraryOfCongress,search} from "../server/search.mjs";
import {diversifyKnowledgeResults} from "../server/intelligence.mjs";

test("official Library of Congress provider preserves source records, rejects forged URLs and cleans metadata",async()=>{
  const old=globalThis.fetch;
  globalThis.fetch=async url=>{
    const u=new URL(url);
    assert.equal(u.hostname,"www.loc.gov");
    assert.equal(u.pathname,"/search/");
    assert.equal(u.searchParams.get("fo"),"json");
    assert.equal(u.searchParams.get("at"),"results");
    assert.equal(u.searchParams.get("q"),"Jalisco");
    return new Response(JSON.stringify({results:[
      {id:"https://www.loc.gov/item/123/",title:"Historical <b>document</b>",
        description:["Original <em>catalog</em> entry"],subject:["History","Mexico"],
        date:"1900",image_url:["https://www.loc.gov/static/picture.jpg"]},
      {id:"https://www.loc.gov.evil.test/item/1",title:"Forged"},
      {id:"javascript:alert(1)",title:"Unsafe"},
      {id:"https://www.loc.gov/item/empty",title:""}
    ]}),{status:200});
  };
  try{
    const found=await libraryOfCongress("Jalisco");
    assert.equal(found.length,1);
    assert.equal(found[0].url,"https://www.loc.gov/item/123/");
    assert.equal(found[0].title,"Historical document");
    assert.equal(found[0].source,"Library of Congress");
    assert.match(found[0].snippet,/Original catalog entry/);
  }finally{globalThis.fetch=old;}
});

test("knowledge federation recovers seven independently attributed sources, without turning them into web results",async()=>{
  const old=globalThis.fetch;
  const providers=[];
  globalThis.fetch=async url=>{
    const u=new URL(url);
    providers.push(u.hostname);
    let json;
    if(u.hostname==="es.wikipedia.org")json={query:{search:[
      {title:"Inteligencia artificial",pageid:301,snippet:"Enciclopedia <b>pública</b>"}
    ]}};
    else if(u.hostname==="www.wikidata.org")json={search:[
      {id:"Q11660",label:"Inteligencia artificial",description:"Entidad de conocimiento"}
    ]};
    else if(u.hostname==="api.crossref.org")json={message:{items:[
      {DOI:"10.1000/knowledge-federation",title:["Artificial intelligence research"]}
    ]}};
    else if(u.hostname==="api.openalex.org")json={results:[
      {display_name:"Artificial intelligence overview",id:"https://openalex.org/W123"}
    ]};
    else if(u.hostname==="www.ebi.ac.uk")json={resultList:{result:[
      {id:"12345",source:"MED",title:"Medical AI",pubYear:"2025"}
    ]}};
    else if(u.hostname==="openlibrary.org")json={docs:[
      {key:"/works/OL123W",title:"The science of AI",author_name:["Author"]}
    ]};
    else if(u.hostname==="www.loc.gov")json={results:[
      {id:"https://www.loc.gov/item/123/",title:"Artificial intelligence archive",
        description:["Archival catalog"],date:"2024"}
    ]};
    else throw Error("Unexpected index "+u.hostname);
    return new Response(JSON.stringify(json),{status:200});
  };
  try{
    const data=await search("artificial intelligence knowledge fixture","knowledge",{fresh:true});
    assert.equal(data.type,"knowledge");
    assert.equal(data.knowledgeCoverage.generalWebIndex,undefined);
    assert.equal(data.knowledgeCoverage.index,"not_general_web");
    assert.equal(data.results.length,7);
    assert.equal(new Set(data.results.map(x=>x.source)).size,7);
    assert.equal(data.knowledgeCoverage.retrievedSources.length,7);
    assert.equal(data.brief.kind,"extractive");
    assert.equal(data.brief.notes.length,7);
    assert.equal(data.webCoverage,null);
    assert.equal(data.failedSources.length,0);
    assert.equal(providers.length,7);
    assert.ok(!providers.includes("api.search.brave.com"));
  }finally{globalThis.fetch=old;}
});

test("knowledge source interleaving keeps every result and early visibility for other catalogs",()=>{
  const input=[
    ...Array.from({length:7},(_,i)=>({source:"Wikipedia",title:"Wiki "+i})),
    {source:"Library of Congress",title:"Archive"},
    {source:"Crossref",title:"Research"}
  ];
  const actual=diversifyKnowledgeResults(input);
  assert.equal(actual.length,input.length);
  assert.deepEqual(actual.slice(0,3).map(x=>x.source),
    ["Wikipedia","Library of Congress","Crossref"]);
  assert.equal(actual.filter(x=>x.source==="Wikipedia").length,7);
});

test("knowledge is a separate intentional UI mode, not a silent fallback from Web",()=>{
  const html=readFileSync(new URL("../public/index.html",import.meta.url),"utf8");
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(html,/data-type="knowledge">◈ Conocimiento/);
  assert.match(app,/knowledge:\["Conocimiento verificable"/);
  assert.match(app,/state\.type==="knowledge"/);
  assert.match(app,/knowledge-source-overview/);
  assert.match(app,/performSearch\(state\.query,"knowledge"\)/);
  assert.match(app,/if \(\["research","knowledge","index"\]\.includes\(state\.type\)\)/);
});
