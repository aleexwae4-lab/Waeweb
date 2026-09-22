import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, open, lstat, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";
import { EncryptionError, encryptionReady, keyForVault, openVaultEnvelope, sealVault } from "./crypto.mjs";
import { vaultPostgresSelected, vaultPostgresConfig, readVaultPostgres, mutateVaultPostgres } from "./vault-postgres.mjs";
import { requiresDurableStorage } from "./hosting.mjs";

const MAX_DOCS = 80;
const MAX_FILE_BYTES = 3 * 1024 * 1024;
const VAULT_PATTERN = /^[a-z][a-z0-9_-]{2,39}$/;
const ID_PATTERN = /^[a-f0-9]{20}$/;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const queues = new Map();
const digest = value => createHash("sha256").update(value).digest();
const hex = value => createHash("sha256").update(value).digest("hex");

export class VaultError extends Error {
  constructor(code, message) { super(message); this.name = "VaultError"; this.code = code; }
}
function fail(code, message) { throw new VaultError(code, message); }
export function vaultConfig(raw = process.env.WAE_VAULTS_JSON) {
  if (!raw) return null;
  let data;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || Array.isArray(data) || typeof data !== "object") return null;
  const pairs = Object.entries(data);
  if (!pairs.length || pairs.length > 50) return null;
  const tokens = new Set(), values = new Map();
  for (const [id, token] of pairs) {
    if (!VAULT_PATTERN.test(id) || typeof token !== "string" || token.length < 32 ||
      token.length > 256 || !/^[\x21-\x7e]+$/.test(token) || tokens.has(token)) return null;
    tokens.add(token);
    values.set(id, digest(token));
  }
  return values;
}
export function authenticateVault(header, config = vaultConfig()) {
  if (!config) return null;
  if (typeof header !== "string" || !/^Bearer [\x21-\x7e]{32,256}$/.test(header)) return null;
  const supplied = digest(header.slice(7));
  let match = null;
  for (const [id, expected] of config) {
    if (timingSafeEqual(supplied, expected)) match = id;
  }
  return match;
}
export function vaultRoot() {
  const base = process.env.WAE_VAULT_DIR || ".wae-private-vaults";
  if (!base || base.includes("\0")) fail("invalid_storage", "Ruta de almacenamiento inválida.");
  return resolve(base);
}
export function vaultFilePath(id, base = vaultRoot()) {
  if (!VAULT_PATTERN.test(id)) fail("invalid_vault", "Identificador de espacio inválido.");
  return join(base, hex(id) + ".json");
}
function validDocument(doc) {
  if (!doc || typeof doc !== "object" || !ID_PATTERN.test(doc.id || "") ||
    !HASH_PATTERN.test(doc.fingerprint || "") || !/^https:\/\//.test(doc.url || "") ||
    typeof doc.title !== "string" || doc.title.length > 240 ||
    typeof doc.text !== "string" || doc.text.length < 30 || doc.text.length > 18000) return false;
  return hex(doc.text) === doc.fingerprint && doc.id === hex(doc.url).slice(0, 20);
}
function validatedRecords(id, payload) {
  if (!payload || payload.version !== 2 || payload.id !== id ||
    !Array.isArray(payload.documents) || payload.documents.length > MAX_DOCS) {
    fail("corrupt_vault", "Índice inconsistente.");
  }
  const records = new Map();
  for (const doc of payload.documents) {
    if (!validDocument(doc) || records.has(doc.id)) fail("corrupt_vault", "Integridad documental no válida.");
    records.set(doc.id, doc);
  }
  return records;
}
export function decodeEncryptedVault(id, envelope) {
  let payload;
  try { payload = openVaultEnvelope(id, envelope); }
  catch (error) {
    if (error instanceof EncryptionError) fail(error.code, "No se pudo abrir la bóveda cifrada.");
    throw error;
  }
  return validatedRecords(id, payload);
}
export async function readEncryptedFile(id, base = vaultRoot()) {
  const path = vaultFilePath(id, base);
  let bytes;
  try {
    const info = await lstat(path);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) fail("corrupt_vault", "Archivo de índice inválido.");
    bytes = await readFile(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    if (error instanceof VaultError) throw error;
    fail("storage_failure", "No se pudo abrir el almacén de investigación.");
  }
  let content;
  try { content = JSON.parse(bytes.toString("utf8")); }
  catch { fail("corrupt_vault", "Formato del índice inválido."); }
  if (content?.version === 1) {
    fail("migration_required", "Se detectó almacenamiento antiguo sin cifrado. Detén el servicio y migra los documentos fuera de línea.");
  }
  decodeEncryptedVault(id, content);
  return { bytes, envelope: content };
}
export function vaultStorageReady() {
  const mode = process.env.WAE_VAULT_STORE || "file";
  return mode === "postgres" ? Boolean(vaultPostgresConfig()) :
    mode === "file" && !requiresDurableStorage();
}
export async function loadVault(id, base) {
  keyForVault(id); // Missing keys always fail even when storage is empty.
  if (base === undefined && vaultPostgresSelected()) {
    if (!vaultPostgresConfig()) fail("invalid_storage", "PostgreSQL de bóvedas no configurado.");
    let raw;
    try { raw = await readVaultPostgres(id); }
    catch { fail("storage_failure", "No se pudo abrir la bóveda en PostgreSQL."); }
    if (raw === null) return new Map();
    let envelope;
    try { envelope = JSON.parse(raw); }
    catch { fail("corrupt_vault", "Sobre de bóveda no válido."); }
    return decodeEncryptedVault(id, envelope);
  }
  if (base === undefined && !vaultStorageReady())
    fail("invalid_storage", "Almacenamiento persistente de bóvedas no disponible.");
  const entry = await readEncryptedFile(id, base ?? vaultRoot());
  return entry ? decodeEncryptedVault(id, entry.envelope) : new Map();
}
async function writeAtomic(path, bytes) {
  const temporary = path + "." + randomUUID() + ".tmp";
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path);
  } catch {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    fail("storage_failure", "No se pudo guardar el índice cifrado.");
  }
}
async function writeVault(id, records, base) {
  const path = vaultFilePath(id, base);
  await mkdir(base, { recursive: true, mode: 0o700 });
  const envelope = sealVault(id, { version: 2, id, documents: [...records.values()] });
  const bytes = Buffer.from(JSON.stringify(envelope), "utf8");
  if (bytes.length > MAX_FILE_BYTES) fail("vault_full", "El índice supera el límite de almacenamiento.");
  await writeAtomic(path, bytes);
}
export async function storeDocument(id, document, base) {
  if (!validDocument(document)) fail("invalid_document", "Documento sin integridad verificable.");
  if (base === undefined && vaultPostgresSelected()) {
    if (!vaultPostgresConfig()) fail("invalid_storage", "PostgreSQL de bóvedas no configurado.");
    try {
      return await mutateVaultPostgres(id, async raw => {
        let records = new Map();
        if (raw !== null) {
          let envelope;
          try { envelope = JSON.parse(raw); }
          catch { fail("corrupt_vault", "Sobre de bóveda no válido."); }
          records = decodeEncryptedVault(id, envelope);
        } else { keyForVault(id); }
        records.delete(document.id);
        while (records.size >= MAX_DOCS) records.delete(records.keys().next().value);
        records.set(document.id, {
          id: document.id, url: document.url, title: document.title,
          text: document.text, source: "Índice WAE", fingerprint: document.fingerprint,
          fetchedAt: document.fetchedAt
        });
        const envelope = JSON.stringify(sealVault(id, {
          version: 2, id, documents: [...records.values()]
        }));
        if (Buffer.byteLength(envelope) > MAX_FILE_BYTES)
          fail("vault_full", "El índice supera el límite de almacenamiento.");
        return { envelope, result: { record: records.get(document.id), records } };
      });
    } catch (error) {
      if (error instanceof VaultError) throw error;
      fail("storage_failure", "No se pudo guardar la bóveda PostgreSQL.");
    }
  }
  if (base === undefined && !vaultStorageReady())
    fail("invalid_storage", "Almacenamiento persistente de bóvedas no disponible.");
  base ??= vaultRoot();
  const path = vaultFilePath(id, base);
  const prev = queues.get(path) || Promise.resolve();
  const operation = prev.catch(() => {}).then(async () => {
    const records = await loadVault(id, base);
    records.delete(document.id);
    while (records.size >= MAX_DOCS) records.delete(records.keys().next().value);
    records.set(document.id, {
      id: document.id, url: document.url, title: document.title,
      text: document.text, source: "Índice WAE", fingerprint: document.fingerprint,
      fetchedAt: document.fetchedAt
    });
    await writeVault(id, records, base);
    return { record: records.get(document.id), records };
  });
  queues.set(path, operation);
  try { return await operation; }
  finally { if (queues.get(path) === operation) queues.delete(path); }
}
export async function installEncryptedVault(id, envelope, base = vaultRoot()) {
  // Offline restore only. Never overwrite a live vault or infer a migration.
  const records = decodeEncryptedVault(id, envelope);
  const path = vaultFilePath(id, base);
  await mkdir(base, { recursive: true, mode: 0o700 });
  let handle;
  try {
    handle = await open(path, "wx", 0o600);
    await handle.writeFile(Buffer.from(JSON.stringify(envelope), "utf8"));
    await handle.sync();
    await handle.close();
    return { count: records.size };
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
      await unlink(path).catch(() => {});
    }
    if (error.code === "EEXIST") fail("vault_exists", "Ya existe una bóveda. Se rechaza la restauración destructiva.");
    fail("storage_failure", "No se pudo instalar la bóveda recuperada.");
  }
}
export async function vaultStatus(id, base) {
  return (await loadVault(id, base)).size;
}
