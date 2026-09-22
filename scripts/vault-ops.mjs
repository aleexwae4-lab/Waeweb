#!/usr/bin/env node
import { createBackup, verifyBackup, restoreBackup } from "../server/backup.mjs";
import { encryptionReady, vaultKeysConfig } from "../server/crypto.mjs";
import { vaultConfig } from "../server/vault.mjs";

const [, , command, id, filename, confirmation] = process.argv;
if (!["backup", "verify", "restore"].includes(command) || !/^[a-z][a-z0-9_-]{2,39}$/.test(id || "")) {
  console.error("Uso: node scripts/vault-ops.mjs backup <vault-id> | verify <vault-id> <backup-filename> | restore <vault-id> <backup-filename> --confirm-empty-target");
  process.exitCode = 2;
} else if (!encryptionReady(vaultConfig(), vaultKeysConfig())) {
  console.error("Se requieren WAE_VAULTS_JSON y WAE_VAULT_KEYS_JSON válidos con los mismos IDs; no pasar claves como argumentos.");
  process.exitCode = 2;
} else if (!vaultConfig().has(id)) {
  console.error("Bóveda no configurada.");
  process.exitCode = 2;
} else {
  try {
    let outcome;
    if (command === "backup") outcome = await createBackup(id);
    else if (command === "verify") {
      outcome = await verifyBackup(id, filename);
      delete outcome.envelope; // Never print ciphertext or decrypted content.
    } else {
      if (confirmation !== "--confirm-empty-target") throw Error("Para restaurar, detén la aplicación y añade --confirm-empty-target. Una bóveda existente nunca se sobrescribe.");
      outcome = await restoreBackup(id, filename);
    }
    console.log(JSON.stringify(outcome, null, 2));
  } catch (error) {
    console.error(error.message || "Operación no completada.");
    process.exitCode = 1;
  }
}
