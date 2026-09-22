// RC19: read-only media validation of an offline encrypted PG backup against
// the currently restored PG target. Never writes objects or changes DB rows.
import { openVaultEnvelope } from "./crypto.mjs";
import { mediaIntegrityManifest, auditMediaDigests } from "./marketplace-integrity-audit.mjs";

export class MediaRestoreError extends Error {
  constructor(code) { super(code); this.name="MediaRestoreError"; this.code=code; }
}
const reject=code=>{throw new MediaRestoreError(code);};

export function sameRecoveryData(source,target) {
  if (!source || !target || source.accounts?.envelope !== target.accounts?.envelope)
    return false;
  const a=source.vaults,b=target.vaults;
  if (!Array.isArray(a)||!Array.isArray(b)||a.length!==b.length) return false;
  return a.every((row,i)=>row.vaultHash===b[i]?.vaultHash &&
    row.envelope===b[i]?.envelope);
}

export function backupMediaRecords(source, key) {
  if (source?.accounts?.envelope===null)
    reject("media_recovery_backup_accounts_absent");
  if(typeof source?.accounts?.envelope!=="string"||!Buffer.isBuffer(key)||
    key.length!==32) reject("media_recovery_backup_invalid");
  let db;
  try {
    db=openVaultEnvelope("accounts",
      JSON.parse(source.accounts.envelope),key);
  } catch { reject("media_recovery_backup_invalid"); }
  // This checks every key against its owning business/listing and rejects
  // malformed/duplicate records before contacting the object provider.
  mediaIntegrityManifest(db);
  return db;
}

export async function assessRestoredMarketplaceMedia(source,current,{
  key,media,transport=fetch,offset=0,limit=5,readCurrent=async()=>current
}={}) {
  if(!media)reject("media_recovery_provider_required");
  if(!sameRecoveryData(source,current))
    return {mode:"read_only_restored_media_check",status:"target_mismatch",
      targetSnapshotMatchesBackup:false,restoreCertified:false,
      noDeletionPerformed:true,noObjectKeysExposed:true};
  const db=backupMediaRecords(source,key);
  const audit=await auditMediaDigests(db,{media,transport,offset,limit,
    readCurrent:async()=>{
      const latest=await readCurrent();
      if(!sameRecoveryData(source,latest))
        reject("media_recovery_target_changed");
      return backupMediaRecords(latest,key);
    }});
  // The source bundle is integrity checked by pg-recovery.mjs before this
  // function is called. These flags do not claim that S3 was restored.
  return {
    ...audit, mode:"read_only_restored_media_check",
    status:audit.status==="attention_required"?"attention_required":
      audit.nextOffset!==null?"partial":"matching_target_batch_verified",
    targetSnapshotMatchesBackup:true,
    objectBackupVerified:false,objectVersionsVerified:false,
    orphanInventoryVerified:false,restoreCertified:false,
    noObjectKeysExposed:true,noDeletionPerformed:true
  };
}
