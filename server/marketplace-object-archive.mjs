// RC20: encrypted, bounded, offline object recovery capsule; no public API.
// Media bytes and object keys exist ONLY inside authenticated ciphertext.
import { randomBytes, createHash, timingSafeEqual, hkdfSync,
  createCipheriv, createDecipheriv } from "node:crypto";
import { presignedMarketImage, MAX_MARKET_MEDIA_BYTES } from "./marketplace-media.mjs";
import { mediaIntegrityManifest } from "./marketplace-integrity-audit.mjs";
import { validImageDigest } from "./marketplace-integrity.mjs";
import { MediaJournalError, validMediaKey } from "./marketplace-lifecycle.mjs";

const TYPE="waeweb-private-media-archive";
const MAX_ITEMS=5,MAX_CIPHER=2*1024*1024;
const fail=code=>{throw new MediaJournalError(code);};
const hash=data=>createHash("sha256").update(data).digest("hex");
const b64=buffer=>Buffer.from(buffer).toString("base64");
const parseB64=(value,max)=>{
  if(typeof value!=="string"||value.length>max*1.4+10||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))
    fail("media_archive_invalid");
  const bytes=Buffer.from(value,"base64");
  if(bytes.length>max||b64(bytes)!==value)fail("media_archive_invalid");
  return bytes;
};
const metadata=archive=>({
  version:archive.version,type:archive.type,
  postgresChecksum:archive.postgresChecksum,
  manifestFingerprint:archive.manifestFingerprint,
  offset:archive.offset,total:archive.total,count:archive.count
});
const derive=(key,salt)=>{
  if(!Buffer.isBuffer(key)||key.length!==32)fail("media_archive_key_required");
  return Buffer.from(hkdfSync("sha256",key,salt,
    Buffer.from("waeweb-private-media-archive-v1"),32));
};
function options(key,checksum,offset,limit){
  if(!Buffer.isBuffer(key)||key.length!==32||
    !validImageDigest(checksum)||!Number.isSafeInteger(offset)||offset<0||
    !Number.isSafeInteger(limit)||limit<1||limit>MAX_ITEMS)
    fail("media_archive_options");
}
async function readVerified(config,record,transport){
  if(!validImageDigest(record.checksum)||!Number.isSafeInteger(record.size)||
    record.size<8||record.size>MAX_MARKET_MEDIA_BYTES)
    fail("media_archive_legacy_unverified");
  const url=presignedMarketImage(config,record.key);
  let response;
  try{response=await transport(url,{method:"GET",redirect:"manual",
    signal:AbortSignal.timeout(12000)});}
  catch{fail("media_archive_provider_unavailable");}
  if(response.status!==200||!response.body)
    fail(response.status===404?"media_archive_missing":"media_archive_provider_unavailable");
  if((response.headers?.get("content-type")||"").split(";")[0].trim().toLowerCase()!=="image/jpeg")
    fail("media_archive_invalid_format");
  const length=response.headers?.get("content-length");
  if(length!==null&&length!==undefined&&
     (!/^(?:0|[1-9]\d*)$/.test(length)||Number(length)!==record.size))
    fail("media_archive_mismatch");
  const chunks=[];let size=0;
  try{
    for await(const chunk of response.body){
      if(!(chunk instanceof Uint8Array))fail("media_archive_provider_unavailable");
      size+=chunk.byteLength;
      if(size>MAX_MARKET_MEDIA_BYTES||size>record.size)
        fail("media_archive_mismatch");
      chunks.push(Buffer.from(chunk));
    }
  }catch(error){
    if(error instanceof MediaJournalError)throw error;
    fail("media_archive_provider_unavailable");
  }
  const bytes=Buffer.concat(chunks,size);
  if(size!==record.size||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||
     bytes.at(-2)!==255||bytes.at(-1)!==217||
     !timingSafeEqual(createHash("sha256").update(bytes).digest(),
       Buffer.from(record.checksum,"hex")))fail("media_archive_mismatch");
  return bytes;
}
export async function createMarketMediaArchive(db,{
  key,postgresChecksum,media,transport=fetch,offset=0,limit=MAX_ITEMS,
  readCurrent=async()=>db
}={}){
  options(key,postgresChecksum,offset,limit);
  if(!media)fail("media_archive_provider_required");
  const manifest=mediaIntegrityManifest(db);
  if(offset>manifest.records.length)fail("media_archive_offset_invalid");
  const records=manifest.records.slice(offset,offset+limit);
  if(!records.length)fail("media_archive_empty_batch");
  const items=[];
  for(const record of records){
    const bytes=await readVerified(media,record,transport);
    items.push({key:record.key,checksum:record.checksum,
      size:record.size,bytes:b64(bytes)});
  }
  const latest=mediaIntegrityManifest(await readCurrent());
  if(latest.fingerprint!==manifest.fingerprint||
     latest.records.length!==manifest.records.length)
    fail("media_archive_database_changed");
  const header={version:1,type:TYPE,postgresChecksum,
    manifestFingerprint:manifest.fingerprint,
    offset,total:manifest.records.length,count:items.length};
  const salt=randomBytes(32),iv=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",derive(key,salt),iv);
  cipher.setAAD(Buffer.from(JSON.stringify(header)));
  const ciphertext=Buffer.concat([cipher.update(Buffer.from(JSON.stringify(items))),
    cipher.final()]);
  const archive={...header,salt:b64(salt),iv:b64(iv),
    tag:b64(cipher.getAuthTag()),ciphertext:b64(ciphertext)};
  return {archive,summary:{mode:"encrypted_private_media_backup",
    checked:items.length,offset,nextOffset:offset+items.length<manifest.records.length?
      offset+items.length:null,total:manifest.records.length,
    manifestFingerprint:manifest.fingerprint,postgresChecksum,
    contentsEncrypted:true,noObjectKeysExposed:true,noDeletionPerformed:true,
    objectBackupVerified:false,restoreCertified:false}};
}
export function openMarketMediaArchive(archive,{
  key,postgresChecksum,manifestFingerprint
}={}){
  if(!archive||archive.type!==TYPE||archive.version!==1||
    !validImageDigest(archive.postgresChecksum)||
    !validImageDigest(archive.manifestFingerprint)||
    !Number.isSafeInteger(archive.offset)||archive.offset<0||
    !Number.isSafeInteger(archive.total)||archive.total<1||
    !Number.isSafeInteger(archive.count)||archive.count<1||
    archive.count>MAX_ITEMS||archive.offset+archive.count>archive.total||
    archive.postgresChecksum!==postgresChecksum||
    archive.manifestFingerprint!==manifestFingerprint)
    fail("media_archive_identity_mismatch");
  const salt=parseB64(archive.salt,32),iv=parseB64(archive.iv,12),
    tag=parseB64(archive.tag,16),ciphertext=parseB64(archive.ciphertext,MAX_CIPHER);
  if(salt.length!==32||iv.length!==12||tag.length!==16)
    fail("media_archive_invalid");
  let items;
  try{
    const decipher=createDecipheriv("aes-256-gcm",derive(key,salt),iv);
    decipher.setAAD(Buffer.from(JSON.stringify(metadata(archive))));
    decipher.setAuthTag(tag);
    const clear=Buffer.concat([decipher.update(ciphertext),decipher.final()]);
    items=JSON.parse(clear.toString("utf8"));
  }catch{fail("media_archive_auth_failed");}
  if(!Array.isArray(items)||items.length!==archive.count)
    fail("media_archive_invalid");
  const seen=new Set();
  for(const item of items){
    if(!validMediaKey(item?.key)||seen.has(item.key)||
       !validImageDigest(item.checksum)||!Number.isSafeInteger(item.size)||
       item.size<8||item.size>MAX_MARKET_MEDIA_BYTES)
      fail("media_archive_invalid");
    seen.add(item.key);
    const bytes=parseB64(item.bytes,MAX_MARKET_MEDIA_BYTES);
    if(bytes.length!==item.size||bytes[0]!==255||bytes[1]!==216||bytes[2]!==255||
      bytes.at(-2)!==255||bytes.at(-1)!==217||
      !timingSafeEqual(createHash("sha256").update(bytes).digest(),
        Buffer.from(item.checksum,"hex")))fail("media_archive_mismatch");
  }
  return {items,summary:{mode:"encrypted_private_media_archive_verify",
    verified:items.length,offset:archive.offset,total:archive.total,
    noObjectKeysExposed:true,objectBackupVerified:false,restoreCertified:false}};
}


