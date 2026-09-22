// RC23: private portable recovery package (encrypted source material ONLY).
// Operators select a separate private directory; GitHub / public/ / provider
// stores are never destinations. No DB or S3 writes and no plaintext exports.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, lstat, realpath, open, readFile, readdir,
  rename, rm } from "node:fs/promises";
import { resolve, join, sep, isAbsolute } from "node:path";
import { MediaJournalError } from "./marketplace-lifecycle.mjs";

const reject=code=>{throw new MediaJournalError(code);};
const digest=bytes=>createHash("sha256").update(bytes).digest("hex");
const TYPE="waeweb-portable-encrypted-recovery-v1";
const PG_MAX=160*1024*1024;
const MEDIA_MAX=2*1024*1024+4096;
const MANIFEST_MAX=32768;
const MAX_FILES=100;
const PACKAGE=/^waeweb-recovery-\d{13}-[a-f0-9-]{36}$/;
const SHA=/^[a-f0-9]{64}$/;

function packageRoot(raw,{sourceRoots=[]}={}){
  if(typeof raw!=="string"||!isAbsolute(raw)||raw.includes("\0"))
    reject("portable_directory_required");
  const dir=resolve(raw),repo=resolve(process.cwd());
  const forbidden=[repo,...sourceRoots.filter(Boolean).map(path=>resolve(path))];
  if(forbidden.some(root=>dir===root||dir.startsWith(root+sep)||
     root.startsWith(dir+sep)))reject("portable_directory_unsafe");
  return dir;
}
async function privateDir(root,create=false){
  if(create)await mkdir(root,{recursive:true,mode:0o700});
  let info;
  try{info=await lstat(root);}
  catch{reject("portable_directory_missing");}
  if(!info.isDirectory()||(process.platform!=="win32"&&(info.mode&0o077)!==0)||
      await realpath(root)!==root)
    reject("portable_directory_unsafe");
}
async function privateFile(path,max){
  let info;
  try{info=await lstat(path);}
  catch{reject("portable_file_missing");}
  if(!info.isFile()||info.size<1||info.size>max||
     (process.platform!=="win32"&&(info.mode&0o077)!==0))
    reject("portable_file_unsafe");
  const bytes=await readFile(path);
  if(bytes.length!==info.size)reject("portable_file_changed");
  return bytes;
}
async function writePrivate(path,bytes){
  let handle;
  try{
    handle=await open(path,"wx",0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();handle=null;
  }catch{
    if(handle)await handle.close().catch(()=>{});
    reject("portable_write_failed");
  }
}
const mediaName=index=>"media-"+String(index).padStart(3,"0")+".backup.json";
const metadata=(snapshot,archives)=>({
  version:1,type:TYPE,
  postgresChecksum:snapshot.checksum,
  mediaCount:archives.length,
  files:[]
});
/**
 * Caller MUST verify the PG envelope and FULL archive coverage first.
 * We reserialize authenticated JSON into a private offline package.
 * Only original-source-independent bytes and no encryption keys are written.
 */
export async function exportPortableRecovery(snapshot,archives,{
  root,sourceRoots=[]
}={}){
  if(!snapshot||!SHA.test(snapshot.checksum||"")||
      !Array.isArray(archives)||archives.length<1||archives.length>MAX_FILES)
    reject("portable_package_options");
  const dir=packageRoot(root,{sourceRoots});
  await privateDir(dir,true);
  const name="waeweb-recovery-"+Date.now()+"-"+randomUUID();
  let staging;
  try{
    staging=await mkdtemp(join(dir,".wae-staging-"));
    const manifest=metadata(snapshot,archives);
    const parts=[["postgres.backup.json",Buffer.from(JSON.stringify(snapshot))],
      ...archives.map((archive,i)=>[mediaName(i),Buffer.from(JSON.stringify(archive))])];
    for(let i=0;i<parts.length;i++){
      const [filename,bytes]=parts[i];
      if(bytes.length<1||bytes.length>(i===0?PG_MAX:MEDIA_MAX))
        reject("portable_package_size");
      await writePrivate(join(staging,filename),bytes);
      manifest.files.push({name:filename,bytes:bytes.length,sha256:digest(bytes)});
    }
    const manifestBytes=Buffer.from(JSON.stringify(manifest));
    if(manifestBytes.length>MANIFEST_MAX)reject("portable_package_size");
    await writePrivate(join(staging,"manifest.json"),manifestBytes);
    // A unique random final directory makes an accidental overwrite
    // vanishingly unlikely; refuse existing names rather than replace them.
    try{await lstat(join(dir,name));reject("portable_package_exists");}
    catch(error){
      if(error.code!=="ENOENT")throw error;
    }
    await rename(staging,join(dir,name));
    staging=null;
    return {mode:"portable_encrypted_recovery_export",status:"package_created",
      packageName:name,archivedFiles:archives.length,postgresChecksum:snapshot.checksum,
      archiveBytes:manifest.files.reduce((n,f)=>n+f.bytes,0),
      containsOnlyEncryptedSourceMaterial:true,noObjectKeysExposed:true,
      independentFailureDomainVerified:false,restoreCertified:false,
      releaseApproval:"not_evaluated"};
  }catch(error){
    if(error instanceof MediaJournalError)throw error;
    reject("portable_export_failed");
  }finally{
    // Only abandon a staging folder newly created by this invocation.
    if(staging)await rm(staging,{recursive:true,force:true}).catch(()=>{});
  }
}
/**
 * Read independently from a selected package. No source backup directories,
 * original archive filenames, PG connection, provider, or network required.
 * High-level caller must also authenticate PG and capsule contents.
 */
export async function readPortableRecovery(packageName,{
  root,sourceRoots=[]
}={}){
  if(typeof packageName!=="string"||!PACKAGE.test(packageName))
    reject("portable_package_name");
  const dir=packageRoot(root,{sourceRoots});
  await privateDir(dir);
  const path=join(dir,packageName);
  await privateDir(path);
  const raw=await privateFile(join(path,"manifest.json"),MANIFEST_MAX);
  let manifest;
  try{manifest=JSON.parse(raw.toString("utf8"));}
  catch{reject("portable_manifest_invalid");}
  if(manifest?.version!==1||manifest.type!==TYPE||
    !SHA.test(manifest.postgresChecksum||"")||
    !Number.isSafeInteger(manifest.mediaCount)||
    manifest.mediaCount<1||manifest.mediaCount>MAX_FILES||
    !Array.isArray(manifest.files)||
    manifest.files.length!==manifest.mediaCount+1)
    reject("portable_manifest_invalid");
  const required=["postgres.backup.json",
    ...Array.from({length:manifest.mediaCount},(_,i)=>mediaName(i)),
    "manifest.json"];
  const names=await readdir(path);
  if(names.length!==required.length||names.some(n=>!required.includes(n)))
    reject("portable_unexpected_file");
  const archives=[];let snapshot;
  for(let i=0;i<manifest.files.length;i++){
    const entry=manifest.files[i],name=required[i],max=i===0?PG_MAX:MEDIA_MAX;
    if(entry?.name!==name||!Number.isSafeInteger(entry.bytes)||
       entry.bytes<1||entry.bytes>max||!SHA.test(entry.sha256||""))
      reject("portable_manifest_invalid");
    const bytes=await privateFile(join(path,name),max);
    if(bytes.length!==entry.bytes||digest(bytes)!==entry.sha256)
      reject("portable_checksum_mismatch");
    let data;
    try{data=JSON.parse(bytes.toString("utf8"));}
    catch{reject("portable_json_invalid");}
    if(i===0)snapshot=data;else archives.push(data);
  }
  if(snapshot?.checksum!==manifest.postgresChecksum)
    reject("portable_identity_mismatch");
  return {snapshot,archives,manifest};
}
