import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const HEX_KEY = /^[a-fA-F0-9]{64}$/;
const HEX_HASH = /^[a-f0-9]{64}$/;
const B64 = /^[A-Za-z0-9+/]+={0,2}$/;
const digest = value => createHash("sha256").update(value).digest("hex");

export class EncryptionError extends Error {
  constructor(code, message) { super(message); this.name = "EncryptionError"; this.code = code; }
}
function fail(code, message) { throw new EncryptionError(code, message); }
export function vaultKeysConfig(raw = process.env.WAE_VAULT_KEYS_JSON) {
  if (!raw) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const pairs = Object.entries(parsed);
  if (!pairs.length || pairs.length > 50) return null;
  const keys = new Map(), used = new Set();
  for (const [id, rawKey] of pairs) {
    if (!/^[a-z][a-z0-9_-]{2,39}$/.test(id) || typeof rawKey !== "string" ||
      !HEX_KEY.test(rawKey) || used.has(rawKey.toLowerCase())) return null;
    used.add(rawKey.toLowerCase());
    keys.set(id, Buffer.from(rawKey, "hex"));
  }
  return keys;
}
export function encryptionReady(vaults, keys = vaultKeysConfig()) {
  if (!(vaults instanceof Map) || !(keys instanceof Map) || vaults.size !== keys.size) return false;
  return [...vaults.keys()].every(id => keys.has(id));
}
export function keyForVault(id, keys = vaultKeysConfig()) {
  const key = keys?.get(id);
  if (!Buffer.isBuffer(key) || key.length !== 32) fail("key_unavailable", "Clave de cifrado no configurada para la bóveda.");
  return key;
}
function aad(id) { return Buffer.from("WAE-WEB-V2:" + id, "utf8"); }
export function sealVault(id, payload, key = keyForVault(id)) {
  if (typeof id !== "string" || !/^[a-z][a-z0-9_-]{2,39}$/.test(id)) fail("invalid_vault", "Bóveda no válida.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  cipher.setAAD(aad(id));
  const plaintext = Buffer.from(JSON.stringify(payload), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: 2, algorithm: "AES-256-GCM", vault: digest(id),
    iv: iv.toString("base64"), tag: cipher.getAuthTag().toString("base64"),
    ciphertext: encrypted.toString("base64")
  };
}
function decodeB64(value, minBytes, maxBytes) {
  if (typeof value !== "string" || !B64.test(value) || value.length > Math.ceil(maxBytes / 3) * 4 + 4) {
    fail("invalid_envelope", "Sobre cifrado inválido.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.length < minBytes || bytes.length > maxBytes || bytes.toString("base64") !== value) {
    fail("invalid_envelope", "Codificación de sobre inválida.");
  }
  return bytes;
}
export function openVaultEnvelope(id, envelope, key = keyForVault(id)) {
  if (!envelope || envelope.version !== 2 || envelope.algorithm !== "AES-256-GCM" ||
    typeof envelope.vault !== "string" || !HEX_HASH.test(envelope.vault) || envelope.vault !== digest(id)) {
    fail("invalid_envelope", "Formato o identidad de bóveda no válidos.");
  }
  const iv = decodeB64(envelope.iv, 12, 12), tag = decodeB64(envelope.tag, 16, 16);
  const encrypted = decodeB64(envelope.ciphertext, 1, 3 * 1024 * 1024);
  let plaintext;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    decipher.setAAD(aad(id));
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  } catch { fail("decrypt_failed", "No se pudo autenticar el contenido cifrado."); }
  try { return JSON.parse(plaintext.toString("utf8")); }
  catch { fail("invalid_payload", "Contenido de bóveda inválido."); }
}
