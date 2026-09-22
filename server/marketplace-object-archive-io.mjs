// RC20 offline encrypted media-archive files. No routes, no plaintext files.
// Keep key management separate from archive bytes.
import { randomUUID } from "node:crypto";
import { mkdir, lstat, realpath, open, readFile, unlink } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { MediaJournalError } from "./marketplace-lifecycle.mjs";

const fail=code=>{throw new MediaJournalError(code);};
const MAX_FILE=2*1024*1024+4096;
const PATTERN=/^waeweb-media-\d{13}-[a-f0-9-]{36}\.backup\.json$/;
function directory(){
  const raw=process.env.WAE_MEDIA_BACKUP_DIR||".wae-private-media-backups";
  if(typeof raw!=="string"||!raw||raw.includes("\0"))
    fail("media_archive_directory");
  const path=resolve(raw);
  if([resolve("."),resolve("public"),resolve(".git")].some(root=>
    path===root||(root!==resolve(".")&&path.startsWith(root+sep))))
    fail("media_archive_directory");
  return path;
}
async function privateDir(create=false){
  const dir=directory();
  if(create)await mkdir(dir,{recursive:true,mode:0o700});
  try{
    const stat=await lstat(dir);
    if(!stat.isDirectory()||(process.platform!=="win32"&&(stat.mode&0o077)!==0)||
      await realpath(dir)!==dir)fail("media_archive_directory");
  }catch{fail("media_archive_directory");}
  return dir;
}
export async function saveMarketMediaArchive(archive){
  const bytes=Buffer.from(JSON.stringify(archive));
  if(bytes.length>MAX_FILE)fail("media_archive_size");
  const dir=await privateDir(true);
  const filename="waeweb-media-"+Date.now()+"-"+randomUUID()+".backup.json";
  const path=join(dir,filename);
  let handle;
  try{
    handle=await open(path,"wx",0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();handle=null;
  }catch{
    if(handle){await handle.close().catch(()=>{});await unlink(path).catch(()=>{});}
    fail("media_archive_write");
  }
  return {filename,encrypted:true,noObjectKeysExposed:true,restoreCertified:false};
}
export async function loadMarketMediaArchive(filename){
  if(typeof filename!=="string"||!PATTERN.test(filename))
    fail("media_archive_filename");
  const path=join(await privateDir(),filename);
  let bytes;
  try{
    const stat=await lstat(path);
    if(!stat.isFile()||stat.size>MAX_FILE||
      (process.platform!=="win32"&&(stat.mode&0o077)!==0))
      fail("media_archive_file");
    bytes=await readFile(path);
  }catch(error){
    if(error instanceof MediaJournalError)throw error;
    fail("media_archive_file");
  }
  try{return JSON.parse(bytes.toString("utf8"));}
  catch{fail("media_archive_invalid");}
}
