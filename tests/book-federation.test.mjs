import test from "node:test";
import assert from "node:assert/strict";
import {search} from "../server/search.mjs";
import {googleBooks, projectGutenberg, congressBooks, internetArchiveBooks} from "../server/book-providers.mjs";
import {parseQuery} from "../server/intelligence.mjs";

const response = data => new Response(JSON.stringify(data), {status:200});

test("four catalog adapters normalize genuine works and reject forged identifiers", async () => {
  const previous=globalThis.fetch, urls=[];
  globalThis.fetch=async request=>{
    const url=new URL(request);urls.push(url);
    switch(url.hostname){
      case "www.googleapis.com":
        assert.equal(url.searchParams.get("country"),"MX");
        return response({items:[
          {id:"Book_23",volumeInfo:{title:"Diccionario de arte",
            authors:["Autora"],publishedDate:"2019-07-16",
            imageLinks:{thumbnail:"https://books.google.com/books/content?img=123"}},
            accessInfo:{viewability:"PARTIAL"}},
          {id:"../../evil",volumeInfo:{title:"Falso"}}
        ]});
      case "gutendex.com":
        return response({results:[
          {id:123,title:"Clásico",authors:[{name:"Autor"}],copyright:false,
            formats:{"image/jpeg":"https://www.gutenberg.org/cache/epub/123/pg123.cover.medium.jpg"}},
          {id:-1,title:"Falso"}
        ]});
      case "www.loc.gov":
        assert.equal(url.pathname,"/books/");
        return response({results:[
          {id:"https://www.loc.gov/item/123/",title:"Libro histórico",contributor:["Archivo"],date:"1885"},
          {id:"https://www.loc.gov.evil.test/item/123",title:"Falso"}
        ]});
      case "archive.org":
        assert.equal(url.searchParams.get("output"),"json");
        assert.equal(url.searchParams.getAll("fl[]").length,7);
        assert.match(url.searchParams.get("q"),/mediatype:texts/);
        return response({response:{docs:[
          {identifier:"real-book_1",title:"Historia digitalizada",creator:"Institución",year:"1950",mediatype:"texts"},
          {identifier:"../forged",title:"Falso"},
          {identifier:"moving-image",title:"Video",mediatype:"movies"}
        ]}});
      default: throw Error("unexpected external origin: "+url.origin);
    }
  };
  try {
    const [google,gutenberg,loc,archive]=await Promise.all([
      googleBooks("arte"),projectGutenberg("arte"),congressBooks("arte"),internetArchiveBooks("arte")
    ]);
    assert.equal(google.length,1);
    assert.equal(google[0].url,"https://books.google.com/books?id=Book_23");
    assert.equal(google[0].date,"2019");
    assert.equal(google[0].bookAccess,"Vista previa parcial en origen");
    assert.equal(gutenberg.length,1);
    assert.equal(gutenberg[0].source,"Project Gutenberg");
    assert.match(gutenberg[0].bookAccess,/derechos aplicables/);
    assert.equal(gutenberg[0].date,null);
    assert.equal(loc.length,1);
    assert.equal(loc[0].date,"1885");
    assert.equal(archive.length,1);
    assert.equal(archive[0].url,"https://archive.org/details/real-book_1");
    assert.ok(!archive[0].bookAccess,"archive indexing does not promise free access");
    assert.equal(urls.length,4);
  } finally {globalThis.fetch=previous;}
});

test("WAE Biblioteca federates five catalogs and remains available through partial outage",async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=async request=>{
    const u=new URL(request);
    if(u.hostname==="openlibrary.org")return response({docs:[{key:"/works/OL999W",title:"Libro uno",author_name:["Uno"]}]});
    if(u.hostname==="www.googleapis.com")return response({items:[{id:"Google22",volumeInfo:{title:"Libro dos"}}]});
    if(u.hostname==="www.loc.gov")return response({results:[{id:"https://www.loc.gov/item/111/",title:"Libro tres"}]});
    if(u.hostname==="gutendex.com")throw Error("provider unavailable");
    if(u.hostname==="archive.org")return response({response:{docs:[{identifier:"book_five",title:"Libro cinco"}]}});
    throw Error("unexpected provider: "+u.hostname);
  };
  try{
    const out=await search("wae-biblioteca-multifuentetest-unique","books",{fresh:true});
    assert.equal(out.results.length,4);
    assert.equal(out.bookCoverage.configuredSources.length,5);
    assert.deepEqual(out.failedSources,["Project Gutenberg"]);
    assert.equal(out.bookCoverage.retrievedSources.length,4);
    assert.equal(new Set(out.results.map(x=>x.source)).size,4);
    assert.equal(out.bookCoverage.resultCountBySource["Google Books"],1);
    assert.equal(out.webCoverage,null);
    const isolated=await search("wae-biblioteca-multifuentetest-unique source:googlebooks","books",{fresh:true});
    assert.deepEqual(isolated.results.map(x=>x.source),["Google Books"]);
    assert.deepEqual(isolated.bookCoverage.retrievedSources,["Google Books"]);
    assert.equal(parseQuery("literatura source:gutenberg").source,"gutenberg");
    assert.equal(parseQuery("arte source:internetarchive").source,"internetarchive");
    assert.equal(parseQuery("medicina source:loc").source,"loc");
  } finally {globalThis.fetch=previous;}
});
