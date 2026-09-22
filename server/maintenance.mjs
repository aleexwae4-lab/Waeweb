import { createHash, randomUUID } from "node:crypto";
import { open, readFile, lstat, unlink, rename } from "node:fs/promises";
import { vaultFilePath, readEncryptedFile, decodeEncryptedVault, loadVault, VaultError } from "./vault.mjs";
import { keyForVault, sealVault, openVaultEnvelope } from "./crypto.mjs";
import { createBackup, verifyBackup } from "./backup.mjs";

const hex = value => createHash("sha256").update(value).digest("hex");
const MAX_BYTES = 3 * 1024 * 1024;
export class MaintenanceError extends Error {
  constructor(code, message) { super(message); this.name = "MaintenanceError"; this.code = code; }
}
function fail(code, message) { throw new MaintenanceError(code, message); }
function validateNewKey(raw, oldKey) {
  if (typeof raw !== "string" || !/^[a-fA-F0-9]{64}$/.test(raw)) {
    fail("invalid_new_key", "La nueva clave debe ser hex de 64 caracteres.");
  }
  const bytes = Buffer.from(raw, "hex");
  if (bytes.equals(oldKey)) fail("same_key", "La nueva clave debe ser distinta.");
  return bytes;
}
async function replaceAtomically(path, object) {
  const bytes = Buffer.from(JSON.stringify(object), "utf8");
  if (bytes.length > MAX_BYTES) fail("too_large", "Bóveda cifrada fuera del límite.");
  const temporary = path + "." + randomUUID() + ".tmp";
  let file;
  try {
    file = await open(temporary, "wx", 0o600);
    await file.writeFile(bytes);
    await file.sync();
    await file.close();
    file = null;
    await rename(temporary, path);
  } catch {
    if (file) await file.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    fail("write_failed", "No se pudo reemplazar la bóveda.");
  }
}
export async function rotateVaultKey(id, newKeyHex, { vaultBase, backupBase } = {}) {
  const oldKey = keyForVault(id);
  const newKey = validateNewKey(newKeyHex, oldKey);
  const base = vaultBase;
  const source = await readEncryptedFile(id, base);
  if (!source) fail("missing_vault", "No existe bóveda cifrada para rotar.");
  const records = decodeEncryptedVault(id, source.envelope);
  const snapshot = await createBackup(id, base, backupBase);
  await verifyBackup(id, snapshot.filename, backupBase);
  const updated = sealVault(id, { version: 2, id, documents: [...records.values()] }, newKey);
  const reopened = openVaultEnvelope(id, updated, newKey);
  if (reopened.documents.length !== records.size) fail("verification_failed", "No se pudo verificar la re-encriptación.");
  await replaceAtomically(vaultFilePath(id, base), updated);
  return { id, documents: records.size, oldKeyBackup: snapshot.filename,
    encrypted: true, requiresConfigChange: true };
}
export async function migrateLegacyVault(id, { vaultBase } = {}) {
  const path = vaultFilePath(id, vaultBase);
  const key = keyForVault(id);
  let source;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > MAX_BYTES) fail("invalid_legacy", "Archivo legacy inválido.");
    source = await readFile(path);
  } catch (error) {
    if (error instanceof MaintenanceError) throw error;
    fail("missing_legacy", "No se pudo abrir la bóveda original.");
  }
  let old;
  try { old = JSON.parse(source.toString("utf8")); }
  catch { fail("invalid_legacy", "JSON legacy inválido."); }
  if (!old || old.version !== 1 || old.id !== id || !Array.isArray(old.documents) ||
    old.documents.length > 80) fail("invalid_legacy", "La bóveda no es un archivo v1 válido para este espacio.");
  const newEnvelope = sealVault(id, { version: 2, id, documents: old.documents }, key);
  const verified = openVaultEnvelope(id, newEnvelope, key);
  // Reuse the complete v2 record fingerprint and URL integrity validation.
  const validated = decodeEncryptedVault(id, newEnvelope);
  if (verified.documents.length !== validated.size) fail("migration_integrity", "Los documentos legacy no superaron validación.");
  await replaceAtomically(path, newEnvelope);
  return { id, migratedDocuments: validated.size, encryption: "AES-256-GCM",
    warning: "La migración offline reemplazó el archivo legacy; comprueba tus respaldos seguros externos." };
}
