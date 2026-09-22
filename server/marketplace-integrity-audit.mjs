// RC18 read-only verification of bytes against encrypted metadata (not a backup audit).
import { createHash } from "node:crypto";
import { validMediaKey, MediaJournalError } from "./marketplace-lifecycle.mjs";
import { verifyMarketImageIntegrity } from "./marketplace-integrity.mjs";

export function mediaIntegrityManifest(db) {
  if(!db||!Array.isArray(db.users))
    throw new MediaJournalError("media_integrity_database_invalid");
  const records=[],unique=new Set();
  for(const user of db.users)for(const business of user.businesses||[])
    for(const listing of business.listings||[]){
      if(!listing.imageKey)continue;
      const key=listing.imageKey;
      if(!validMediaKey(key)||key.split("/")[1]!==business.id?.toLowerCase()||
        key.split("/")[2]!==listing.id?.toLowerCase()||
        listing.imageType!=="image/jpeg")
        throw new MediaJournalError("media_integrity_reference_invalid");
      if(unique.has(key))throw new MediaJournalError("media_integrity_duplicate");
      unique.add(key);
      records.push({key,checksum:listing.imageSha256,size:listing.imageBytes});
    }
  records.sort((a,b)=>a.key.localeCompare(b.key,"en"));
  const fingerprint=createHash("sha256").update(JSON.stringify(records.map(
    r=>[r.key,r.checksum??null,r.size??null]))).digest("hex");
  return {records,fingerprint};
}

export async function auditMediaDigests(db,{
  media,transport=fetch,offset=0,limit=5,readCurrent=async()=>db
}={}){
  if(!media)throw new MediaJournalError("media_integrity_provider_required");
  if(!Number.isSafeInteger(offset)||offset<0||offset>400000||
    !Number.isSafeInteger(limit)||limit<1||limit>10)
    throw new MediaJournalError("media_integrity_options");
  const {records,fingerprint}=mediaIntegrityManifest(db);
  if(offset>records.length)throw new MediaJournalError("media_integrity_offset_invalid");
  const selected=records.slice(offset,offset+limit);
  const counts={verified:0,legacy_unverified:0,metadata_invalid:0,missing:0,
    denied:0,invalid_size:0,invalid_format:0,mismatch:0,unavailable:0};
  for(const record of selected){
    const result=await verifyMarketImageIntegrity(media,record.key,{
      checksum:record.checksum,size:record.size,transport
    });
    if(Object.hasOwn(counts,result.state))counts[result.state]++;
    else counts.unavailable++;
  }
  let unchanged=false;
  try{
    const current=mediaIntegrityManifest(await readCurrent());
    unchanged=current.fingerprint===fingerprint &&
      current.records.length===records.length;
  }catch{unchanged=false;}
  const nextOffset=offset+selected.length<records.length?offset+selected.length:null;
  const attention=!unchanged||Object.entries(counts).some(([key,value])=>
    key!=="verified"&&value>0);
  return {
    mode:"read_only_content_audit",scope:"referenced_hashed_objects_only",
    status:attention?"attention_required":nextOffset!==null?"partial":"batch_verified_only",
    total:records.length,offset,checked:selected.length,nextOffset,
    ...counts,manifestFingerprint:fingerprint,databaseUnchanged:unchanged,
    bytesCompared:selected.length>0&&counts.verified===selected.length,
    entireDatasetVerified:nextOffset===null&&offset===0&&!attention,
    objectBackupVerified:false,objectVersionsVerified:false,
    orphanInventoryVerified:false,restoreCertified:false,
    noObjectKeysExposed:true,noDeletionPerformed:true
  };
}
