import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {wikidataOfficialSites,navigationalName} from "../server/site-discovery.mjs";

const entity={entities:{Q741:{
  labels:{en:{value:"National Research Council"},es:{value:"Consejo Nacional de Investigación"}},
  aliases:{es:[{value:"Consejo Nacional de Investigación"}]},
  descriptions:{es:{value:"Institución científica"}},
  claims:{P856:[{rank:"normal",mainsnak:{datavalue:{value:"https://research.example.org/"}}}]}
}}};
function json(value){return new Response(JSON.stringify(value),{
  status:200,headers:{"content-type":"application/json"}
});}

test("English label index recovers source-backed site when Spanish name search has zero hits",async()=>{
  const previous=globalThis.fetch,queries=[];
  globalThis.fetch=async input=>{
    const url=new URL(input),mode=url.searchParams.get("action");
    queries.push(url);
    if(mode==="wbsearchentities")return json({
      search:url.searchParams.get("language")==="en"?[{id:"Q741"}]:[]
    });
    return json(entity);
  };
  try{
    const matches=await wikidataOfficialSites("National Research Council");
    assert.equal(matches.length,1);
    assert.equal(matches[0].url,"https://research.example.org/");
    assert.equal(matches[0].linkBasis,"wikidata_P856");
    assert.equal(matches[0].provenanceUrl,"https://www.wikidata.org/wiki/Q741");
    assert.deepEqual(queries.slice(0,2).map(x=>x.searchParams.get("language")),["es","en"]);
    assert.equal(queries[2].searchParams.get("ids"),"Q741");
  }finally{globalThis.fetch=previous;}
});
test("one Wikidata language outage does not lose the other language result",async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=async input=>{
    const url=new URL(input);
    if(url.searchParams.get("action")==="wbsearchentities"){
      if(url.searchParams.get("language")==="es")throw Error("spanish index down");
      return json({search:[{id:"Q741"}]});
    }
    return json(entity);
  };
  try{
    const matches=await wikidataOfficialSites("National Research Council");
    assert.equal(matches[0].url,"https://research.example.org/");
  }finally{globalThis.fetch=previous;}
});
test("dual outage remains a real provider failure; unknown name never creates a domain",async()=>{
  const previous=globalThis.fetch;
  globalThis.fetch=async()=>new Response("unavailable",{status:503});
  try{
    await assert.rejects(()=>wikidataOfficialSites("Unknown institution"),
      /wikidata_sites_search_unavailable/);
  }finally{globalThis.fetch=previous;}
  assert.equal(navigationalName("página oficial de National Research Council"),
    "national research council");
});
test("coverage label differentiates configured-but-failing from unconfigured",()=>{
  const app=readFileSync(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(app,/const diagnosis=coverage\?\.generalIndexDiagnosis/);
  assert.match(app,/results:"Índice web · resultados recuperados"/);
  assert.match(app,/empty:"Índices consultados · sin coincidencias"/);
  assert.match(app,/unavailable:"Índices web sin respuesta"/);
  assert.match(app,/"Índice web general no configurado"/);
  assert.match(app,/El directorio y Wikidata no sustituyen un índice web general/);
});
