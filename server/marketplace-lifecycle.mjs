// RC16 durable encrypted cleanup journal. Never log keys or personal records.
const KEY = /^marketplace\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.jpg$/;
const LIMIT = 1200;
export class MediaJournalError extends Error {
  constructor(code) { super(code); this.name="MediaJournalError"; this.code=code; this.status=503; }
}
export const validMediaKey = key => typeof key === "string" && KEY.test(key);
export function referencedMedia(db, key) {
  return db.users.some(user=>(user.businesses||[]).some(business=>
    (business.listings||[]).some(listing=>listing.imageKey===key)));
}
export function queueMediaDeletion(db,key,{ now=Date.now() }={}) {
  if (!key) return false;
  if (!validMediaKey(key)) throw new MediaJournalError("media_journal_key_invalid");
  db.mediaDeleteQueue ||= [];
  if (db.mediaDeleteQueue.some(entry=>entry.key===key)) return false;
  if (db.mediaDeleteQueue.length >= LIMIT)
    throw new MediaJournalError("media_journal_full");
  db.mediaDeleteQueue.push({key,queuedAt:new Date(now).toISOString()});
  return true;
}
export function pendingMedia(db,{ now=Date.now(),graceMs=5*60*1000,limit=30 }={}) {
  if (!Number.isSafeInteger(limit)||limit<1||limit>100 ||
      !Number.isSafeInteger(graceMs)||graceMs<120000)
    throw new MediaJournalError("media_journal_options");
  if (!Array.isArray(db.mediaDeleteQueue)) return [];
  return db.mediaDeleteQueue.slice(0,LIMIT).filter(entry=>
    validMediaKey(entry?.key) &&
    Number.isFinite(Date.parse(entry.queuedAt)) &&
    now - Date.parse(entry.queuedAt)>=graceMs).slice(0,limit);
}
export function mediaJournalSummary(db,{now=Date.now()}={}) {
  const all=db.mediaDeleteQueue||[];
  if (!Array.isArray(all)||all.length>LIMIT)
    throw new MediaJournalError("media_journal_corrupt");
  const eligible=pendingMedia(db,{now});
  const inUse=all.filter(entry=>validMediaKey(entry?.key) && referencedMedia(db,entry.key)).length;
  return {queued:all.length,eligible:eligible.length,referenced:inUse,
    noDeletionPerformed:true};
}
