// RC20: conservative read-only S3 ListObjectsV2 inventory. Never deletes or exposes object keys.
import { createHash, createHmac } from "node:crypto";
import { mediaIntegrityManifest } from "./marketplace-integrity-audit.mjs";
import { validMediaKey, MediaJournalError } from "./marketplace-lifecycle.mjs";

const hex=x=>createHash("sha256").update(x).digest("hex");
const hmac=(key,x)=>createHmac("sha256",key).update(x).digest();
const esc=x=>encodeURIComponent(x).replace(/[!'()*]/g,c=>"%"+c.charCodeAt(0).toString(16).toUpperCase());
const fail=code=>{throw new MediaJournalError(code);};
const MAX_XML=256*1024;

function xmlText(xml,tag,required=false) {
  const found=xml.match(new RegExp("<(?:[A-Za-z0-9_-]+:)?"+tag+">([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?"+tag+">","g"));
  if(!found||found.length!==1){if(required)fail("media_inventory_xml");return null;}
  const value=found[0].replace(/^<[^>]+>/,"").replace(/<[^>]+>$/,"");
  if(/<|&(?!(?:amp|lt|gt|quot|apos|#(?:[0-9]+|x[0-9a-fA-F]+));)/.test(value))
    fail("media_inventory_xml");
  return value.replace(/&(amp|lt|gt|quot|apos|#(?:[0-9]+|x[0-9a-fA-F]+));/g,(_,entity)=>{
    const named={amp:"&",lt:"<",gt:">",quot:'"',apos:"'"};
    if(named[entity])return named[entity];
    const number=entity.startsWith("#x")?parseInt(entity.slice(2),16):Number(entity.slice(1));
    if(!Number.isSafeInteger(number)||number<=0||number>0x10ffff)
      fail("media_inventory_xml");
    return String.fromCodePoint(number);
  });
}
function parseList(xml){
  if(!/^<\?xml[^>]*>\s*<ListBucketResult(?:\s|>)/.test(xml) &&
     !/^<ListBucketResult(?:\s|>)/.test(xml))fail("media_inventory_xml");
  const truncated=xmlText(xml,"IsTruncated",true);
  if(!["true","false"].includes(truncated))fail("media_inventory_xml");
  const blocks=[...xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)];
  if(blocks.length>100)fail("media_inventory_overflow");
  const keys=blocks.map(block=>xmlText(block[1],"Key",true));
  const cursor=xmlText(xml,"NextContinuationToken");
  if(truncated==="true"&&(!cursor||cursor.length>2048))fail("media_inventory_cursor_invalid");
  return {keys,truncated:truncated==="true",cursor};
}
async function limitedText(response){
  if(!response.body)fail("media_inventory_unavailable");
  const chunks=[];let size=0;
  for await(const chunk of response.body){
    size+=chunk.byteLength;
    if(size>MAX_XML)fail("media_inventory_overflow");
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks,size).toString("utf8");
}
async function listPage(config,cursor,transport,now){
  if(!config)fail("media_inventory_provider_required");
  const {amz,day}=(()=>{const date=new Date(now).toISOString()
    .replace(/[-:]/g,"").replace(/\.\d{3}Z$/,"Z");
    return {amz:date,day:date.slice(0,8)};})();
  const scope=day+"/"+config.region+"/s3/aws4_request";
  const query=[["list-type","2"],["max-keys","100"],["prefix","marketplace/"]];
  if(cursor)query.push(["continuation-token",cursor]);
  const qs=query.map(([k,v])=>[esc(k),esc(v)]).sort((a,b)=>
    a[0]<b[0]?-1:a[0]>b[0]?1:0).map(pair=>pair.join("=")).join("&");
  const path="/"+esc(config.bucket),hostname=new URL(config.origin).host;
  const empty=hex(Buffer.alloc(0));
  const headers="host:"+hostname+"\nx-amz-content-sha256:"+empty+
    "\nx-amz-date:"+amz+"\n";
  const signed="host;x-amz-content-sha256;x-amz-date";
  const canonical="GET\n"+path+"\n"+qs+"\n"+headers+"\n"+signed+"\n"+empty;
  const signedText="AWS4-HMAC-SHA256\n"+amz+"\n"+scope+"\n"+hex(canonical);
  let signing=hmac("AWS4"+config.secret,day);
  for(const part of [config.region,"s3","aws4_request"])signing=hmac(signing,part);
  const signature=createHmac("sha256",signing).update(signedText).digest("hex");
  let response;
  try{
    response=await transport(config.origin+path+"?"+qs,{method:"GET",
      headers:{"x-amz-content-sha256":empty,"x-amz-date":amz,
        authorization:"AWS4-HMAC-SHA256 Credential="+config.accessKey+"/"+scope+
          ", SignedHeaders="+signed+", Signature="+signature},
      redirect:"manual",signal:AbortSignal.timeout(12000)});
  }catch{fail("media_inventory_unavailable");}
  if(response.status!==200)fail(response.status===403||response.status===401?
    "media_inventory_denied":"media_inventory_unavailable");
  return parseList(await limitedText(response));
}
export async function auditMarketObjectInventory(db,{
  media,transport=fetch,readCurrent=async()=>db,pages=2,now=Date.now()
}={}){
  if(!Number.isSafeInteger(pages)||pages<1||pages>5)
    fail("media_inventory_options");
  const manifest=mediaIntegrityManifest(db);
  const referenced=new Set(manifest.records.map(r=>r.key));
  const journal=db.mediaDeleteQueue??[];
  if(!Array.isArray(journal)||journal.length>1200)fail("media_inventory_journal_invalid");
  const queued=new Set();
  for(const entry of journal){
    if(!validMediaKey(entry?.key)||queued.has(entry.key)||
       !Number.isFinite(Date.parse(entry.queuedAt)))
      fail("media_inventory_journal_invalid");
    queued.add(entry.key);
  }
  const fingerprint=hex(JSON.stringify([manifest.fingerprint,
    [...queued].sort()]));
  const counts={referenced:0,queued:0,orphanCandidates:0,unexpectedKeys:0};
  const seen=new Set(),tokens=new Set();
  let cursor=null,complete=false,readPages=0;
  for(let i=0;i<pages;i++){
    const page=await listPage(media,cursor,transport,now);
    readPages++;
    for(const key of page.keys){
      if(!validMediaKey(key)){counts.unexpectedKeys++;continue;}
      if(seen.has(key))fail("media_inventory_duplicate_object");
      seen.add(key);
      if(referenced.has(key))counts.referenced++;
      else if(queued.has(key))counts.queued++;
      else counts.orphanCandidates++;
    }
    if(!page.truncated){complete=true;break;}
    if(tokens.has(page.cursor))fail("media_inventory_cursor_loop");
    tokens.add(page.cursor);
    cursor=page.cursor;
  }
  let unchanged=false;
  try{
    const latest=await readCurrent();
    const fresh=mediaIntegrityManifest(latest);
    const freshQueue=latest.mediaDeleteQueue??[];
    unchanged=Array.isArray(freshQueue)&&
      hex(JSON.stringify([fresh.fingerprint,freshQueue.map(x=>x.key).sort()]))===fingerprint;
  }catch{unchanged=false;}
  const missingCandidates=complete?referenced.size-counts.referenced:null;
  const attention=!unchanged||counts.orphanCandidates>0||counts.unexpectedKeys>0||
    (missingCandidates!==null&&missingCandidates>0);
  return {mode:"read_only_s3_inventory",scope:"marketplace_prefix_only",
    status:attention?"attention_required":complete?"inventory_checked_only":"partial",
    pages:readPages,maxPages:pages,scanned:seen.size+counts.unexpectedKeys,
    ...counts,missingCandidates,complete,manifestFingerprint:fingerprint,
    databaseUnchanged:unchanged,orphanInventoryVerified:complete&&unchanged,
    orphanDeletionApproved:false,objectBytesVerified:false,
    objectBackupVerified:false,restoreCertified:false,
    noObjectKeysExposed:true,noDeletionPerformed:true};
}
