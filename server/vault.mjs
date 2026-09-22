import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, rename, open, stat, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";

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
  const tokens = new Set();
  const values = new Map();
  for (const [id, token] of pairs) {
    if (!VAULT_PATTERN.test(id) || typeof token !== "string" || token.length < 32 ||
      token.length > 256 || tokens.has(token)) return null;
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
function vaultFile(id, base = vaultRoot()) {
  if (!VAULT_PATTERN.test(id)) fail("invalid_vault", "Identificador de espacio inválido.");
  return join(base, hex(id) + ".json");
}
function validDocument(doc) {
  if (!doc || typeof doc !== "object" || !ID_PATTERN.test(doc.id || "") ||
    !HASH_PATTERN.test(doc.fingerprint || "") || !/^https:\/\//.test(doc.url || "") ||
    typeof doc.title !== "string" || doc.title.length > 240 ||
    typeof doc.text !== "string" || doc.text.length < 30 || doc.text.length > 18000) {
    return false;
  }
  return hex(doc.text) === doc.fingerprint && doc.id === hex(doc.url).slice(0, 20);
}
export async function loadVault(id, base = vaultRoot()) {
  const path = vaultFile(id, base);
  let bytes;
  try {
    const info = await stat(path);
    if (!info.isFile() || info.size > MAX_FILE_BYTES) fail("corrupt_vault", "Archivo de índice inválido.");
    bytes = await readFile(path);
  } catch (error) {
    if (error.code === "ENOENT") return new Map();
    if (error instanceof VaultError) throw error;
    fail("storage_failure", "No se pudo abrir el almacén de investigación.");
  }
  let content;
  try { content = JSON.parse(bytes.toString("utf8")); } catch { fail("corrupt_vault", "Formato del índice inválido."); }
  if (!content || content.version !== 1 || content.id !== id || !Array.isArray(content.documents) ||
    content.documents.length > MAX_DOCS) fail("corrupt_vault", "Índice inconsistente.");
  const records = new Map();
  for (const doc of content.documents) {
    if (!validDocument(doc) || records.has(doc.id)) fail("corrupt_vault", "Integridad documental no válida.");
    records.set(doc.id, doc);
  }
  return records;
}
async function writeVault(id, records, base) {
  const path = vaultFile(id, base);
  await mkdir(base, { recursive: true, mode: 0o700 });
  const bytes = JSON.stringify({ version: 1, id, documents: [...records.values()] });
  if (Buffer.byteLength(bytes) > MAX_FILE_BYTES) fail("vault_full", "El índice supera el límite de almacenamiento.");
  const temporary = path + "." + randomUUID() + ".tmp";
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    await rename(temporary, path);
  } catch {
    if (handle) await handle.close().catch(() => {});
    await unlink(temporary).catch(() => {});
    fail("storage_failure", "No se pudo guardar el índice.");
  }
}
export async function storeDocument(id, document, base = vaultRoot()) {
  if (!validDocument(document)) fail("invalid_document", "Documento sin integridad verificable.");
  const key = vaultFile(id, base);
  const prev = queues.get(key) || Promise.resolve();
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
  queues.set(key, operation);
  try { return await operation; }
  finally { if (queues.get(key) === operation) queues.delete(key); }
}
export async function vaultStatus(id, base = vaultRoot()) {
  return (await loadVault(id, base)).size;
}
