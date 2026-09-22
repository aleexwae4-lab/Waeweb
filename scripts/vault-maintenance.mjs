#!/usr/bin/env node
import { vaultConfig } from "../server/vault.mjs";
import { vaultKeysConfig, encryptionReady } from "../server/crypto.mjs";
import { migrateLegacyVault, rotateVaultKey } from "../server/maintenance.mjs";

const [, , action, id, confirmation] = process.argv;
const valid = /^[a-z][a-z0-9_-]{2,39}$/.test(id || "");
const flag = action === "rotate" ? "--confirm-offline-rotation" : "--confirm-offline-migration";
if (!["rotate", "migrate-v1"].includes(action) || !valid || confirmation !== flag) {
  console.error("Uso: node scripts/vault-maintenance.mjs rotate <id> --confirm-offline-rotation | migrate-v1 <id> --confirm-offline-migration");
  process.exitCode = 2;
} else if (!encryptionReady(vaultConfig(), vaultKeysConfig()) || !vaultConfig().has(id)) {
  console.error("Se necesitan tokens y claves de todas las bóvedas en las variables privadas del proceso.");
  process.exitCode = 2;
} else {
  try {
    const result = action === "rotate"
      ? await rotateVaultKey(id, process.env.WAE_VAULT_NEW_KEY)
      : await migrateLegacyVault(id);
    console.log(JSON.stringify(result, null, 2));
    if (action === "rotate") console.log("Conserva la clave anterior en un almacén secreto para abrir el respaldo; actualiza WAE_VAULT_KEYS_JSON con la nueva clave antes de reabrir la aplicación.");
  } catch (error) {
    console.error(error.message || "No se pudo completar la operación offline.");
    process.exitCode = 1;
  }
}
