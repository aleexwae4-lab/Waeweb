import { createHash, randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { mkdir, open, lstat, readFile, unlink } from "node:fs/promises";
import { decodeEncryptedVault, installEncryptedVault, readEncryptedFile, vaultRoot, VaultError } from "./vault.mjs";

const sha = value => createHash("sha256").update(value).digest("hex");
const MAX_BACKUP = 4 * 1024 * 1024;
export class BackupError extends Error {
  constructor(code, message) { super(message); this.name = "BackupError"; this.code = code; }
}
function fail(code, message) { throw new BackupError(code, message); }
export function backupRoot() {
  const base = process.env.WAE_BACKUP_DIR || ".wae-private-backups";
  if (!base || base.includes("\0")) fail("invalid_backup_dir", "Ruta de respaldos inválida.");
  const path = resolve(base);
  if (path === vaultRoot() || path.startsWith(vaultRoot() + "/") || vaultRoot().startsWith(path + "/")) {
    fail("invalid_backup_dir", "El directorio de respaldo debe estar separado de las bóvedas.");
  }
  return path;
}
function backupPath(id, filename, base = backupRoot()) {
  const prefix = sha(id);
  if (typeof filename !== "string" || !new RegExp("^" + prefix + "\\.\\d{13}\\.[a-f0-9-]{36}\\.backup\\.json$").test(filename)) {
    fail("invalid_backup_name", "Nombre de respaldo no válido para esta bóveda.");
  }
  return join(base, filename);
}
export async function createBackup(id, vaultBase = vaultRoot(), backupBase = backupRoot()) {
  const current = await readEncryptedFile(id, vaultBase);
  if (!current) fail("missing_vault", "No existe una bóveda cifrada para respaldar.");
  const records = decodeEncryptedVault(id, current.envelope);
  const encrypted = JSON.stringify(current.envelope);
  const name = sha(id) + "." + Date.now() + "." + randomUUID() + ".backup.json";
  const bundle = {
    version: 1, type: "wae-vault-encrypted-backup", vault: sha(id),
    createdAt: new Date().toISOString(), checksum: sha(encrypted),
    envelope: current.envelope
  };
  const bytes = Buffer.from(JSON.stringify(bundle), "utf8");
  if (bytes.length > MAX_BACKUP) fail("backup_too_large", "Respaldo fuera del límite permitido.");
  await mkdir(backupBase, { recursive: true, mode: 0o700 });
  const path = backupPath(id, name, backupBase);
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
    fail("backup_write_failed", "No se pudo crear el respaldo.");
  }
  return { filename: name, documents: records.size, checksum: bundle.checksum, encrypted: true };
}
export async function verifyBackup(id, filename, backupBase = backupRoot()) {
  const path = backupPath(id, filename, backupBase);
  let bytes;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > MAX_BACKUP) fail("invalid_backup", "Respaldo inválido o demasiado grande.");
    bytes = await readFile(path);
  } catch (error) {
    if (error instanceof BackupError) throw error;
    fail("backup_missing", "No se pudo leer el respaldo.");
  }
  let bundle;
  try { bundle = JSON.parse(bytes.toString("utf8")); }
  catch { fail("invalid_backup", "JSON de respaldo inválido."); }
  if (!bundle || bundle.version !== 1 || bundle.type !== "wae-vault-encrypted-backup" ||
    bundle.vault !== sha(id) || !/^[a-f0-9]{64}$/.test(bundle.checksum || "") ||
    !bundle.envelope || bundle.checksum !== sha(JSON.stringify(bundle.envelope))) {
    fail("backup_integrity", "La integridad del respaldo no coincide.");
  }
  const records = decodeEncryptedVault(id, bundle.envelope);
  return { filename, documents: records.size, checksum: bundle.checksum, encrypted: true, envelope: bundle.envelope };
}
export async function restoreBackup(id, filename, vaultBase = vaultRoot(), backupBase = backupRoot()) {
  const verified = await verifyBackup(id, filename, backupBase);
  const restored = await installEncryptedVault(id, verified.envelope, vaultBase);
  return { filename, restoredDocuments: restored.count, encrypted: true };
}
