// Explicit, operator-triggered schema bootstrap. No automatic migration of file data.
import { initializeAccountsPostgres, postgresAccountsConfig, closeAccountsPostgres } from "../server/accounts-postgres.mjs";
if (process.argv[2] !== "--confirm-schema") {
  console.error("Se requiere --confirm-schema. No se modificó la base.");
  process.exitCode = 2;
} else if (!postgresAccountsConfig()) {
  console.error("WAE_ACCOUNTS_STORE=postgres, URL y CA verificable requeridos (o modo local de CI).");
  process.exitCode = 2;
} else {
  try {
    await initializeAccountsPostgres();
    console.log("WAEWEB_ACCOUNTS_SCHEMA_READY (no account migration performed)");
  } catch {
    console.error("No fue posible inicializar el esquema de cuentas.");
    process.exitCode = 1;
  } finally { await closeAccountsPostgres(); }
}
