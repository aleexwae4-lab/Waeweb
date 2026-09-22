// RC22: offline read-only completeness check for bounded encrypted media capsules.
// Only an authenticated PG snapshot defines the expected media set.
// No provider requests, writes, deleted objects, plaintext or object keys in output.
import { openMarketMediaArchive } from "./marketplace-object-archive.mjs";
import { mediaIntegrityManifest } from "./marketplace-integrity-audit.mjs";
import { MediaJournalError } from "./marketplace-lifecycle.mjs";

const fail=code=>{throw new MediaJournalError(code);};
export const MAX_ARCHIVE_SET_FILES=100;

/**
 * Archive arrays are bounded to 100 files per invocation. The caller must
 * authenticate the PostgreSQL snapshot and decrypt its accounts envelope
 * before supplying db and checksum; archive identity is cryptographically
 * tied to the checksum, manifest and authenticated JPEG bytes.
 */
export function auditMarketMediaArchiveSet(db, archives, {
  key,postgresChecksum
}={}) {
  if(!Array.isArray(archives)||archives.length<1||
     archives.length>MAX_ARCHIVE_SET_FILES)
    fail("media_archive_set_options");
  const manifest=mediaIntegrityManifest(db);
  const expected=manifest.records;
  const seen=new Set();
  let checked=0,overlap=0,unexpected=0;
  const coverage=new Uint8Array(expected.length);
  const spans=[];
  for(const archive of archives){
    // Reject corrupt ciphertext, wrong PG identity, changed manifest, legacy
    // metadata and invalid JPEG bytes before recording any coverage.
    const result=openMarketMediaArchive(archive,{key,postgresChecksum,
      manifestFingerprint:manifest.fingerprint});
    if(archive.total!==expected.length)
      fail("media_archive_set_total_mismatch");
    const span=archive.offset+":"+archive.count;
    if(seen.has(span))fail("media_archive_set_duplicate");
    seen.add(span);
    spans.push({offset:archive.offset,count:archive.count});
    for(let i=0;i<result.items.length;i++){
      const index=archive.offset+i,item=result.items[i],record=expected[index];
      if(!record||item.key!==record.key||
         item.checksum!==record.checksum||item.size!==record.size)
        fail("media_archive_set_reference_mismatch");
      if(coverage[index])overlap++;
      else {coverage[index]=1;checked++;}
    }
  }
  spans.sort((a,b)=>a.offset-b.offset);
  const missing=expected.length-checked;
  const status=overlap?"attention_required":
    missing?"incomplete_set":"complete_set_verified";
  return {
    mode:"offline_private_media_archive_set_audit",
    status,archivedFiles:archives.length,total:expected.length,
    covered:checked,missing,overlap,unexpected,
    contiguous:missing===0&&overlap===0,
    emptyDataset:false,
    manifestFingerprint:manifest.fingerprint,
    postgresChecksum,
    bytesAndReferencesAuthenticated:true,
    completeArchiveSetVerified:status==="complete_set_verified",
    // This certifies only private local archive coverage for ONE PG snapshot.
    // It does not prove independent copies or live-provider recoverability.
    independentCopyVerified:false,providerRestoreVerified:false,
    objectBackupVerified:false,restoreCertified:false,
    noObjectKeysExposed:true,noDeletionPerformed:true,
    releaseApproval:"not_evaluated"
  };
}
