// RC17 operator-only, READ-ONLY media presence reconciliation; no secrets or keys in reports.
import { mediaReferenceManifest, validMediaKey, MediaJournalError } from "./marketplace-lifecycle.mjs";
import { headMarketImage, verifyMarketImageBytes } from "./marketplace-media.mjs";

export function mediaRecoveryKeys(db) {
  const manifest=mediaReferenceManifest(db);
  if(manifest.malformed||manifest.duplicates)
    throw new MediaJournalError("media_recovery_references_invalid");
  const keys=[];
  for(const user of db.users)for(const business of user.businesses||[])
    for(const listing of business.listings||[])
      if(listing.imageKey) {
        if(!validMediaKey(listing.imageKey))throw new MediaJournalError("media_recovery_references_invalid");
        keys.push(listing.imageKey);
      }
  keys.sort();
  return {keys,manifest};
}
export async function probeMediaReferences(db,{
  media,transport=fetch,offset=0,limit=25,readCurrent=async()=>db
}={}) {
  if(!media)throw new MediaJournalError("media_recovery_provider_required");
  if(!Number.isSafeInteger(offset)||offset<0||offset>400000||
     !Number.isSafeInteger(limit)||limit<1||limit>50)
    throw new MediaJournalError("media_recovery_options");
  const {keys,manifest}=mediaRecoveryKeys(db);
  if(offset>keys.length)throw new MediaJournalError("media_recovery_offset_invalid");
  const selected=keys.slice(offset,offset+limit);
  const counts={present:0,missing:0,denied:0,invalid_size:0,unavailable:0};
  for(const key of selected) {
    const result=await headMarketImage(media,key,transport);
    if(!Object.hasOwn(counts,result.state))counts.unavailable++;
    else counts[result.state]++;
  }
  const after=mediaReferenceManifest(await readCurrent());
  const unchanged=after.fingerprint===manifest.fingerprint &&
    after.referenced===manifest.referenced &&
    !after.malformed && !after.duplicates;
  const nextOffset=offset+selected.length<keys.length?offset+selected.length:null;
  const attention=!unchanged||counts.missing||counts.denied||
    counts.invalid_size||counts.unavailable;
  return {
    mode:"read_only_presence_probe",scope:"db_referenced_objects_only",
    status:attention?"attention_required":nextOffset!==null?"partial":"presence_checked_only",
    total:keys.length,offset,checked:selected.length,nextOffset,
    ...counts,manifestFingerprint:manifest.fingerprint,databaseUnchanged:unchanged,
    objectBytesVerified:false,objectBackupVerified:false,objectVersionsVerified:false,
    orphanInventoryVerified:false,restoreCertified:false,noObjectKeysExposed:true,
    noDeletionPerformed:true
  };
}

export function mediaRecoveryEntries(db) {
  const {manifest}=mediaRecoveryKeys(db),entries=[];
  for(const user of db.users)for(const business of user.businesses||[])
    for(const listing of business.listings||[])if(listing.imageKey){
      const sha=listing.imageSha256,bytes=listing.imageBytes;
      entries.push({key:listing.imageKey,
        sha256:typeof sha==="string"&&/^[a-f0-9]{64}$/.test(sha)?sha:null,
        bytes:Number.isSafeInteger(bytes)&&bytes>=8?bytes:null});
    }
  entries.sort((a,b)=>a.key.localeCompare(b.key,"en"));
  return {entries,manifest};
}
export async function verifyMediaIntegrity(db,{
  media,transport=fetch,offset=0,limit=10,readCurrent=async()=>db
}={}) {
  if(!media)throw new MediaJournalError("media_recovery_provider_required");
  if(!Number.isSafeInteger(offset)||offset<0||offset>400000||
     !Number.isSafeInteger(limit)||limit<1||limit>20)
    throw new MediaJournalError("media_integrity_options");
  const {entries,manifest}=mediaRecoveryEntries(db);
  if(offset>entries.length)throw new MediaJournalError("media_recovery_offset_invalid");
  const selected=entries.slice(offset,offset+limit);
  const counts={verified:0,reference_missing:0,missing:0,denied:0,invalid_size:0,
    size_mismatch:0,checksum_mismatch:0,unavailable:0};
  for(const entry of selected){
    if(!entry.sha256||!entry.bytes){counts.reference_missing++;continue;}
    const result=await verifyMarketImageBytes(media,entry.key,{
      expectedSha256:entry.sha256,expectedBytes:entry.bytes,transport
    });
    if(Object.hasOwn(counts,result.state))counts[result.state]++;
    else counts.unavailable++;
  }
  const after=mediaReferenceManifest(await readCurrent());
  const unchanged=after.fingerprint===manifest.fingerprint &&
    after.referenced===manifest.referenced&&!after.malformed&&!after.duplicates;
  const nextOffset=offset+selected.length<entries.length?offset+selected.length:null;
  const attention=!unchanged||Object.entries(counts)
    .some(([name,value])=>name!=="verified"&&value>0);
  return {
    mode:"read_only_byte_integrity",scope:"db_referenced_objects_only",
    status:attention?"attention_required":nextOffset!==null?"partial":"integrity_checked_only",
    total:entries.length,offset,checked:selected.length,nextOffset,...counts,
    manifestFingerprint:manifest.fingerprint,databaseUnchanged:unchanged,
    objectBytesVerified:counts.verified,objectBackupVerified:false,
    objectVersionsVerified:false,orphanInventoryVerified:false,restoreCertified:false,
    noObjectKeysExposed:true,noImageBytesExposed:true,noDeletionPerformed:true
  };
}
