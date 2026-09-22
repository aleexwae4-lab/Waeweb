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
}
