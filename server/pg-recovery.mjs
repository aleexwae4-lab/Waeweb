// Offline encrypted PostgreSQL recovery. Never exposed through HTTP.
// Backups preserve ciphertext, not credentials, plaintext, or encryption keys.
import { createHash, randomUUID } from "node:crypto";
import { mkdir, lstat, readFile, open, unlink, realpath } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { postgresAccountsConfig } from "./accounts-postgres.mjs";
import { accountKey } from "./accounts.mjs";
import { vaultConfig, decodeEncryptedVault } from "./vault.mjs";
import { vaultKeysConfig, encryptionReady, openVaultEnvelope } from "./crypto.mjs";
import { mediaConfig } from "./marketplace-media.mjs";
import { assessRestoredMarketplaceMedia, sameRecoveryData, backupMediaRecords } from "./marketplace-restored-audit.mjs";
import { mediaIntegrityManifest } from "./marketplace-integrity-audit.mjs";
import { createMarketMediaArchive, openMarketMediaArchive } from "./marketplace-object-archive.mjs";
import { restoreArchivedMarketMedia } from "./marketplace-object-restore.mjs";
import { saveMarketMediaArchive, loadMarketMediaArchive } from "./marketplace-object-archive-io.mjs";

const TYPE = "waeweb-encrypted-postgres-recovery";
const MAX_BYTES = 160 * 1024 * 1024;
const MAX_ACCOUNT_BYTES = 4 * 1024 * 1024;
const MAX_VAULT_BYTES = 3 * 1024 * 1024;
const digest = data => createHash("sha256").update(data).digest("hex");
const filenamePattern = /^waeweb-pg-\d{13}-[a-f0-9-]{36}\.backup\.json$/;
export class RecoveryError extends Error {
  constructor(code) { super(code); this.name = "RecoveryError"; this.code = code; }
}
const reject = code => { throw new RecoveryError(code); };
function settings() {
  if (process.env.WAE_ACCOUNTS_STORE !== "postgres" ||
      process.env.WAE_VAULT_STORE !== "postgres" || !accountKey()) reject("recovery_configuration");
  const config = postgresAccountsConfig();
  const ids = vaultConfig(), keys = vaultKeysConfig();
  if (!config || !encryptionReady(ids, keys)) reject("recovery_configuration");
  return { config, ids };
}
function directory() {
  const raw = process.env.WAE_PG_BACKUP_DIR || ".wae-private-pg-backups";
  if (typeof raw !== "string" || !raw || raw.includes("\0")) reject("recovery_directory");
  const result = resolve(raw);
  const forbidden = [resolve("."), resolve("public"), resolve(".git")];
  if (forbidden.some(root => result === root ||
      root !== resolve(".") && result.startsWith(root + sep))) reject("recovery_directory");
  return result;
}
// Refuse symlinked, group-readable or publicly served backup directories.
// A backup may contain personal data even though its envelopes are encrypted.
async function privateDirectory({ create = false } = {}) {
  const root = directory();
  if (create) await mkdir(root, { recursive: true, mode: 0o700 });
  try {
    const info = await lstat(root);
    if (!info.isDirectory() || process.platform !== "win32" && (info.mode & 0o077) !== 0 ||
        await realpath(root) !== root) reject("recovery_directory");
  } catch { reject("recovery_directory"); }
  return root;
}
function backupFile(filename) {
  if (typeof filename !== "string" || !filenamePattern.test(filename))
    reject("recovery_filename");
  return join(directory(), filename);
}
function verifyEnvelope(id, raw, maxBytes) {
  if (typeof raw !== "string" || Buffer.byteLength(raw) > maxBytes)
    reject("recovery_envelope");
  try {
    const envelope = JSON.parse(raw);
    if (id === "accounts") {
      const data = openVaultEnvelope(id, envelope, accountKey());
      if (data?.version !== 1 || !Array.isArray(data.users) || data.users.length > 500)
        reject("recovery_envelope");
      return data.users.length;
    }
    return decodeEncryptedVault(id, envelope).size;
  } catch { reject("recovery_envelope"); }
}
function snapshotContent(snapshot) {
  return { version: snapshot.version, type: snapshot.type, createdAt: snapshot.createdAt,
    accounts: snapshot.accounts, vaults: snapshot.vaults };
}
export function verifyRecoveryBundle(snapshot) {
  const { ids } = settings();
  if (!snapshot || snapshot.version !== 1 || snapshot.type !== TYPE ||
      typeof snapshot.createdAt !== "string" || !Number.isFinite(Date.parse(snapshot.createdAt)) ||
      !snapshot.accounts || !Object.hasOwn(snapshot.accounts, "envelope") ||
      !Array.isArray(snapshot.vaults) || snapshot.vaults.length > ids.size ||
      typeof snapshot.checksum !== "string" || !/^[a-f0-9]{64}$/.test(snapshot.checksum) ||
      digest(JSON.stringify(snapshotContent(snapshot))) !== snapshot.checksum)
    reject("recovery_integrity");
  const allowed = new Map([...ids.keys()].map(id => [digest(id), id]));
  let documents = 0;
  const seen = new Set();
  const accounts = snapshot.accounts.envelope;
  if (accounts !== null) verifyEnvelope("accounts", accounts, MAX_ACCOUNT_BYTES);
  for (const row of snapshot.vaults) {
    const id = allowed.get(row?.vaultHash);
    if (!id || seen.has(row.vaultHash)) reject("recovery_identity");
    seen.add(row.vaultHash);
    documents += verifyEnvelope(id, row.envelope, MAX_VAULT_BYTES);
  }
  return { encrypted: true, accountsPresent: accounts !== null,
    vaults: snapshot.vaults.length, documents, checksum: snapshot.checksum };
}
async function client() {
  const { default: pg } = await import("pg");
  const connection = new pg.Client(settings().config);
  await connection.connect();
  return connection;
}
async function consistentSnapshot() {
  const connection = await client();
  let inTransaction = false;
  try {
    await connection.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    inTransaction = true;
    const { rows: accounts } = await connection.query(
      "SELECT envelope FROM wae_accounts_record WHERE id=1");
    if (accounts.length !== 1) reject("recovery_schema");
    const { rows: vaults } = await connection.query(
      "SELECT vault_hash AS \"vaultHash\", envelope FROM wae_vault_records ORDER BY vault_hash");
    const snapshot = {
      version: 1, type: TYPE, createdAt: new Date().toISOString(),
      accounts: { envelope: accounts[0].envelope },
      vaults
    };
    snapshot.checksum = digest(JSON.stringify(snapshotContent(snapshot)));
    const result = verifyRecoveryBundle(snapshot);
    await connection.query("COMMIT");
    inTransaction = false;
    return { snapshot, result };
  } catch (error) {
    if (inTransaction) await connection.query("ROLLBACK").catch(() => {});
    if (error instanceof RecoveryError) throw error;
    reject("recovery_database");
  } finally { await connection.end().catch(() => {}); }
}
export async function backupPostgres() {
  const { snapshot, result } = await consistentSnapshot();
  const bytes = Buffer.from(JSON.stringify(snapshot));
  if (bytes.length > MAX_BYTES) reject("recovery_size");
  const filename = "waeweb-pg-" + Date.now() + "-" + randomUUID() + ".backup.json";
  await privateDirectory({ create: true });
  const path = backupFile(filename);
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
  } catch {
    if (handle) {
      await handle.close().catch(() => {});
      await unlink(path).catch(() => {});
    }
    reject("recovery_write");
  }
  return { filename, ...result };
}
async function readSnapshot(filename) {
  await privateDirectory();
  const path = backupFile(filename);
  let bytes;
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || stat.size > MAX_BYTES ||
        process.platform !== "win32" && (stat.mode & 0o077) !== 0)
      reject("recovery_file");
    bytes = await readFile(path);
  } catch (error) {
    if (error instanceof RecoveryError) throw error;
    reject("recovery_file");
  }
  let snapshot;
  try { snapshot = JSON.parse(bytes.toString("utf8")); }
  catch { reject("recovery_file"); }
  return { snapshot, result: verifyRecoveryBundle(snapshot) };
}
export async function verifyPostgresBackup(filename) {
  const { result } = await readSnapshot(filename);
  return { filename, ...result };
}
export async function restorePostgresBackup(filename, { offlineConfirmed = false } = {}) {
  if (!offlineConfirmed) reject("recovery_requires_offline_confirmation");
  // Verify ciphertext and tenant identity BEFORE opening a write transaction.
  const { snapshot, result } = await readSnapshot(filename);
  const connection = await client();
  let inTransaction = false;
  try {
    await connection.query("BEGIN");
    inTransaction = true;
    // Exclusive locks make an existing row or a concurrent insert observable.
    // This does not replace stopping all application instances before recovery.
    await connection.query(
      "LOCK TABLE wae_accounts_record, wae_vault_records IN ACCESS EXCLUSIVE MODE");
    const { rows: accounts } = await connection.query(
      "SELECT envelope FROM wae_accounts_record WHERE id=1 FOR UPDATE");
    if (accounts.length !== 1) reject("recovery_schema");
    const { rows: existing } = await connection.query(
      "SELECT COUNT(*)::int AS count FROM wae_vault_records");
    if (accounts[0].envelope !== null || existing[0].count !== 0)
      reject("recovery_target_not_empty");
    if (snapshot.accounts.envelope !== null)
      await connection.query(
        "UPDATE wae_accounts_record SET envelope=$1, revision=revision+1, updated_at=NOW() WHERE id=1",
        [snapshot.accounts.envelope]);
    for (const row of snapshot.vaults)
      await connection.query(
        "INSERT INTO wae_vault_records(vault_hash,envelope) VALUES($1,$2)",
        [row.vaultHash, row.envelope]);
    await connection.query("COMMIT");
    inTransaction = false;
    return { filename, restored: true, ...result };
  } catch (error) {
    if (inTransaction) await connection.query("ROLLBACK").catch(() => {});
    if (error instanceof RecoveryError) throw error;
    reject("recovery_database");
  } finally { await connection.end().catch(() => {}); }
}

/**
 * RC19 operator-only preflight. Verifies an encrypted backup against the
 * current PostgreSQL snapshot and checks each referenced JPEG via bounded GET.
 * NO DB writes, object PUT/DELETE, restore, or public API access.
 * This does not certify object backups or any real disaster recovery.
 */
export async function verifyRestoredMarketplaceMedia(filename,{
  media=mediaConfig(),transport=fetch,offset=0,limit=5
}={}) {
  if(process.env.NODE_ENV!=="test" &&
      process.env.WAE_MARKET_MEDIA_AUDIT_ACK!=="reviewed-read-only-media-audit")
    reject("media_recovery_audit_not_authorized");
  if(!media)reject("media_recovery_provider_required");
  // Always authenticate the offline encrypted bundle before comparing it.
  const {snapshot:source,result}=await readSnapshot(filename);
  const current=(await consistentSnapshot()).snapshot;
  const report=await assessRestoredMarketplaceMedia(source,current,{
    key:accountKey(),media,transport,offset,limit,
    readCurrent:async()=>(await consistentSnapshot()).snapshot
  });
  return { ...report, backupChecksum:result.checksum,
    sourceBackupVerified:true, objectBackupVerified:false,
    restoreCertified:false, releaseApproval:"not_evaluated" };
}


/**
 * RC20: export up to 5 authentic JPEG bytes to an AES-256-GCM sealed private
 * file bound to an authenticated PostgreSQL backup checksum.
 * No object write, no automatic restore, no public API.
 */
export async function backupMarketMediaForPostgres(filename,{
  media=mediaConfig(),transport=fetch,offset=0,limit=5
}={}){
  if(process.env.NODE_ENV!=="test" &&
    process.env.WAE_MARK_MEDIA_BACKUP_ACK!=="reviewed-private-media-backup")
    reject("media_backup_not_authorized");
  if(!media)reject("media_backup_provider_required");
  const {snapshot:source}=await readSnapshot(filename);
  const current=(await consistentSnapshot()).snapshot;
  if(!sameRecoveryData(source,current))reject("media_backup_target_mismatch");
  const db=backupMediaRecords(source,accountKey());
  const {archive,summary}=await createMarketMediaArchive(db,{
    key:accountKey(),postgresChecksum:source.checksum,media,transport,offset,limit,
    readCurrent:async()=>{
      const latest=(await consistentSnapshot()).snapshot;
      if(!sameRecoveryData(source,latest))reject("media_backup_database_changed");
      return backupMediaRecords(latest,accountKey());
    }
  });
  const file=await saveMarketMediaArchive(archive);
  return {...file,...summary,releaseApproval:"not_evaluated"};
}

/** Offline authenticity check only. Does not require any S3 credentials. */
export async function verifyMarketMediaBackup(mediaFilename,postgresFilename){
  const {snapshot:source}=await readSnapshot(postgresFilename);
  const db=backupMediaRecords(source,accountKey());
  const manifest=mediaIntegrityManifest(db);
  const archive=await loadMarketMediaArchive(mediaFilename);
  const result=openMarketMediaArchive(archive,{key:accountKey(),
    postgresChecksum:source.checksum,manifestFingerprint:manifest.fingerprint});
  const expected=manifest.records.slice(archive.offset,archive.offset+archive.count);
  if(expected.length!==result.items.length||expected.some((record,i)=>
      record.key!==result.items[i].key||
      record.checksum!==result.items[i].checksum||
      record.size!==result.items[i].size))
    reject("media_archive_reference_mismatch");
  return {filename:mediaFilename,postgresFilename,
    ...result.summary,referenceMatchesPostgres:true,
    contentsEncrypted:true,releaseApproval:"not_evaluated"};
}


/**
 * RC21 operator-confirmed OFFLINE restore, bounded to one authenticated
 * archive and exactly the PostgreSQL snapshot it was created for.
 */
export async function restoreMarketMediaForPostgres(mediaFilename,postgresFilename,{
  media=mediaConfig(),transport=fetch,offlineConfirmed=false
}={}){
  if(!offlineConfirmed ||
      process.env.NODE_ENV!=="test" &&
      process.env.WAE_MARK_MEDIA_RESTORE_ACK!=="reviewed-offline-missing-objects-only")
    reject("media_restore_not_authorized");
  if(!media)reject("media_restore_provider_required");
  const {snapshot:source}=await readSnapshot(postgresFilename);
  const archive=await loadMarketMediaArchive(mediaFilename);
  const current=(await consistentSnapshot()).snapshot;
  const report=await restoreArchivedMarketMedia(source,current,archive,{
    key:accountKey(),media,transport,
    readCurrent:async()=>(await consistentSnapshot()).snapshot
  });
  return {...report,mediaFilename,postgresFilename,
    sourceBackupVerified:true,releaseApproval:"not_evaluated",
    restoreCertified:false};
}
