// Checks the REAL public domain after a Git-source production deployment.
// No preview bypasses, no cookies or secrets; 404/401 are failures.
const base=process.env.WAEWEB_BASE_URL||"https://waeweb.onrender.com";
const expected=process.env.WAEWEB_EXPECT_VERSION||"1.0.0-rc.35";
if(new URL(base).protocol!=="https:")throw Error("HTTPS production base required");
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const request=async(path)=>{
  let response;
  try{
    response=await fetch(new URL(path,base),{
      headers:{accept:path.startsWith("/api/")?"application/json":"text/javascript"},
      credentials:"omit",redirect:"manual",signal:AbortSignal.timeout(9000),cache:"no-store"
    });
  }catch(error){return {ok:false,status:0,message:error.name||String(error)};}
  const marker=response.headers.get("x-waeweb-api")==="1";
  const mime=response.headers.get("content-type")||"";
  let body=null;
  try{
    if(mime.includes("application/json"))body=await response.json();
    else body=(await response.text()).slice(0,30000);
  }catch{}
  return {ok:response.ok,status:response.status,marker,mime,body};
};
let ready=false;
for(let i=0;i<20;i++){
  const r=await request("/api/health");
  if(r.ok&&r.marker&&r.body?.status==="ok"&&r.body?.version===expected){
    console.log("LIVE READY",JSON.stringify(r.body));ready=true;break;
  }
  console.log("LIVE WAIT",i+1,JSON.stringify({
    status:r.status,marker:r.marker,version:r.body?.version||null,
    cause:r.status===404?"API route missing":r.status===401?"blocked":r.message||"old revision"
  }));
  if(i<19)await sleep(15000);
}
if(!ready){
  console.error("FAIL: production domain does not serve new WAEWEB /api/health. Check Vercel Git deployment source and function routing.");
  process.exitCode=1;
}else{
  const checks=[
    ["/api/capabilities",r=>r.marker&&r.body?.mapsEnabled===true&&r.body?.previewMode===true],
    ["/api/maps?q=20.6767%2C-103.3475",r=>r.marker&&r.body?.results?.[0]?.precision==="coordinate"],
    ["/api/translate/capabilities",r=>r.marker&&Array.isArray(r.body?.languages)],
    ["/native-map.js",r=>r.mime.includes("javascript")&&typeof r.body==="string"&&r.body.includes("createNativeMap")],
    ["/translator.js",r=>r.mime.includes("javascript")&&typeof r.body==="string"&&r.body.includes("Reconectar")]
  ];
  for(const[path,validate]of checks){
    const r=await request(path);
    const good=r.ok&&validate(r);
    console.log(good?"LIVE PASS":"LIVE FAIL",path,"HTTP",r.status,
      r.marker?"WAEWEB API":"no API marker",r.mime);
    if(!good)process.exitCode=1;
  }
  // Provider readiness must be checked on the deployed runtime, never
  // inferred from local tests or fabricated sample search results.
  const capability=await request("/api/capabilities");
  if(capability.ok&&capability.marker){
    const config={
      web:capability.body?.generalWebSearchConfigured===true,
      brave:capability.body?.braveSearchConfigured===true,
      google:capability.body?.googleSearchConfigured===true,
      youtube:capability.body?.youtubeDataConfigured===true
    };
    console.log("LIVE SEARCH PROVIDERS",JSON.stringify(config));
    if(!config.web){
      const general=await request("/api/search?q=WAEWEB-provider-integrity&type=all");
      const items=general.body?.results;
      const noHits=Array.isArray(items)&&items.length===0&&
        ["limited","specialized"].includes(general.body?.webCoverage);
      const specialist=Array.isArray(items)&&items.length>0&&
        general.body?.webCoverage==="specialized"&&
        items.every(item=>["Hacker News · web abierta","WAE Index local · HN"].includes(item.source)&&
          /^https?:/i.test(item.url||"")&&!/wikimedia|wikipedia|wikidata/i.test(item.source));
      const honest=general.ok&&general.marker&&(noHits||specialist);
      console.log(honest?"LIVE PASS":"LIVE FAIL","general web without general index",
        "HTTP",general.status,"count",items?.length??null,
        "coverage",general.body?.webCoverage);
      if(!honest)process.exitCode=1;
    }
    if(!config.web&&!config.youtube){
      const videos=await request("/api/search?q=YouTube&type=videos");
      const honest=videos.ok&&videos.marker&&videos.body?.mediaCollection==="web"&&
        Array.isArray(videos.body?.results)&&videos.body.results.length===0;
      console.log(honest?"LIVE PASS":"LIVE FAIL","YouTube video without provider",
        "HTTP",videos.status,"count",videos.body?.results?.length??null);
      if(!honest)process.exitCode=1;
    }
  }
  // Verify the deployed knowledge mode, not only fixture-based unit tests.
  // External catalogs may independently fail; the API must still expose
  // honest per-source failures and must never relabel them as general web.
  const knowledge=await request("/api/search?q=inteligencia%20artificial&type=knowledge");
  const knowledgeGood=knowledge.ok&&knowledge.marker&&
    knowledge.body?.type==="knowledge"&&
    knowledge.body?.knowledgeCoverage?.index==="not_general_web"&&
    Array.isArray(knowledge.body?.results)&&
    Array.isArray(knowledge.body?.failedSources)&&
    knowledge.body.results.every(item=>
      typeof item.source==="string"&&/^https?:/i.test(item.url||"")&&
      !/wikimedia commons/i.test(item.source));
  console.log(knowledgeGood?"LIVE PASS":"LIVE FAIL","knowledge federation",
    "HTTP",knowledge.status,"count",knowledge.body?.results?.length??null,
    "sources",knowledge.body?.knowledgeCoverage?.retrievedSources?.length??null);
  if(!knowledgeGood)process.exitCode=1;
  // Exercise the real public translator end to end; capabilities alone do
  // not prove that the provider returns translated text from Render.
  try{
    const response=await fetch(new URL("/api/translate",base),{
      method:"POST",credentials:"omit",cache:"no-store",
      headers:{"content-type":"application/json",accept:"application/json"},
      body:JSON.stringify({text:"Hola mundo",source:"es",target:"en"}),
      signal:AbortSignal.timeout(14000)
    });
    const own=response.headers.get("x-waeweb-api")==="1";
    const body=await response.json();
    const valid=response.status===200&&own&&
      typeof body.translatedText==="string"&&body.translatedText.trim()&&
      body.translatedText.trim().toLowerCase()!=="hola mundo";
    console.log(valid?"LIVE PASS":"LIVE FAIL","POST /api/translate",
      "HTTP",response.status,own?"WAEWEB API":"no API marker",
      "result",valid?"nonempty translation":"provider unavailable");
    if(!valid)process.exitCode=1;
  }catch(error){
    console.log("LIVE FAIL POST /api/translate",error.name||"network error");
    process.exitCode=1;
  }
}
