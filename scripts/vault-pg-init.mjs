// Explicit schema initialization for encrypted, tenant-separated vault records.
// Never migrates or overwrites local files.
import { vaultPostgresConfig, initializeVaultPostgres, closeVaultPostgres } from "../server/vault-postgres.mjs";

if (process.argv[2] !== "--confirm-schema") {
  console.error("Se requiere --confirm-schema. No se modificó la base.");
  process.exitCode = 2;
} else if (!vaultPostgresConfig()) {
  console.error("WAE_VAULT_STORE=postgres y conexión PostgreSQL verificada requeridos.");
  process.exitCode = 2;
} else {
  try {
    await initializeVaultPostgres();
    console.log("WAEWEB_VAULT_SCHEMA_READY (no file migration performed)");
  } catch {
    console.error("No fue posible inicializar el esquema de bóvedas.");
    process.exitCode = 1;
  } finally { await closeVaultPostgres(); }
}
