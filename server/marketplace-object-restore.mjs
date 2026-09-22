// RC21: offline, operator-approved recovery of archived JPEGs. No public route.
// Never overwrites a live object, deletes an object or changes PostgreSQL.
import { mediaIntegrityManifest } from "./marketplace-integrity-audit.mjs";
import { openMarketMediaArchive } from "./marketplace-object-archive.mjs";
import { sameRecoveryData, backupMediaRecords } from "./marketplace-restored-audit.mjs";
import { headMarketImage, putMarketImageIfAbsent } from "./marketplace-media.mjs";
import { verifyMarketImageIntegrity } from "./marketplace-integrity.mjs";
import { MediaJournalError } from "./marketplace-lifecycle.mjs";

const fail=code=>{throw new MediaJournalError(code);};
const blocked=(reason,extra={})=>({
  mode:"offline_media_archive_restore",status:"blocked",reason,...extra,
  objectBackupVerified:false,restoreCertified:false,
  noObjectKeysExposed:true,noDeletionPerformed:true,noExistingObjectsOverwritten:true
});

/**
 * The PG backup itself must be authenticated by pg-recovery.mjs before calling.
 * Archive authentication binds its contents to the same snapshot and manifest.
 * A batch can be restored only if ALL destination keys were absent in preflight;
 * conditional signed PUT enforces that requirement again at the storage layer.
 */
export async function restoreArchivedMarketMedia(source,current,archive,{
  key,media,transport=fetch,readCurrent=async()=>current
}={}){
  if(!media)fail("media_restore_provider_required");
  if(!sameRecoveryData(source,current))
    return blocked("target_mismatch",{targetSnapshotMatchesBackup:false});
  const db=backupMediaRecords(source,key);
  const manifest=mediaIntegrityManifest(db);
  const opened=openMarketMediaArchive(archive,{key,
    postgresChecksum:source.checksum,
    manifestFingerprint:manifest.fingerprint});
  const records=manifest.records.slice(archive.offset,archive.offset+archive.count);
  if(records.length!==opened.items.length||
      records.some((record,i)=>record.key!==opened.items[i].key||
        record.checksum!==opened.items[i].checksum||
        record.size!==opened.items[i].size))
    fail("media_restore_reference_mismatch");
  const journal=db.mediaDeleteQueue??[];
  if(!Array.isArray(journal)||opened.items.some(item=>
    journal.some(entry=>entry?.key===item.key)))
    fail("media_restore_queued_reference");
  // Reject partial or drifted snapshots before ANY object write.
  const unchanged=async()=>{
    try{return sameRecoveryData(source,await readCurrent());}
    catch{return false;}
  };
  if(!await unchanged())return blocked("target_changed",
    {targetSnapshotMatchesBackup:false});
  const summary={batch:opened.items.length,offset:archive.offset,
    total:archive.total,checked:0,restored:0,verified:0,
    targetSnapshotMatchesBackup:true,archiveAuthenticated:true,
    objectBackupVerified:false,restoreCertified:false,
    noObjectKeysExposed:true,noDeletionPerformed:true,
    noExistingObjectsOverwritten:true};
  // Two-stage preflight: if even one key exists, is unavailable or is denied,
  // there are ZERO writes. Nothing is auto-deleted or overwritten.
  for(const item of opened.items){
    const state=(await headMarketImage(media,item.key,transport)).state;
    summary.checked++;
    if(state!=="missing")return blocked(state==="present"?
      "destination_not_empty":"destination_not_confirmed_missing",summary);
  }
  if(!await unchanged())return blocked("target_changed",
    {...summary,targetSnapshotMatchesBackup:false});
  for(const item of opened.items){
    if(!await unchanged())
      return {...blocked("target_changed",summary),status:"partial_recovery",
        targetSnapshotMatchesBackup:false};
    try{
      await putMarketImageIfAbsent(media,item.key,
        Buffer.from(item.bytes,"base64"),transport);
    }catch(error){
      return {...blocked(error.code==="media_restore_object_exists"?
        "destination_race_exists":error.code==="media_restore_concurrent_write"?
        "destination_race_conflict":"provider_write_failed",summary),
        status:summary.restored?"partial_recovery":"blocked"};
    }
    summary.restored++;
    const integrity=await verifyMarketImageIntegrity(media,item.key,{
      checksum:item.checksum,size:item.size,transport});
    if(integrity.state!=="verified")
      return {...blocked("post_write_integrity_failed",summary),
        status:"partial_recovery"};
    summary.verified++;
  }
  if(!await unchanged())
    return {...blocked("target_changed",summary),status:"partial_recovery",
      targetSnapshotMatchesBackup:false};
  return {...summary,mode:"offline_media_archive_restore",
    status:"batch_restored_and_verified",
    batchComplete:true,entireDatasetRestored:archive.offset===0&&
      archive.count===archive.total,
    releaseApproval:"not_evaluated"};
}
