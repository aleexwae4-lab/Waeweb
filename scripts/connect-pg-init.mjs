// Operator-only setup of the shared WAEWEB Connect quota/lease tables.
// Does not activate the API, create clients or migrate any other application data.
import { connectAdmissionConfig, initializeConnectPostgres,
  closeConnectPostgres } from "../server/connect-postgres.mjs";
if (process.argv[2]!=="--confirm-schema") {
  console.error("Se requiere --confirm-schema. No se modificó la base.");
  process.exitCode=2;
} else if (!connectAdmissionConfig()) {
  console.error("WAE_CONNECT_ADMISSION_MODE=postgres con conexión TLS verificada requerido.");
  process.exitCode=2;
} else {
  try {
    await initializeConnectPostgres();
    console.log("WAEWEB_CONNECT_QUOTA_SCHEMA_READY (API remains disabled until configured)");
  } catch {
    console.error("No fue posible inicializar el esquema de cuotas WAEWEB Connect.");
    process.exitCode=1;
  } finally { await closeConnectPostgres(); }
}
