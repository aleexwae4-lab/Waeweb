#!/usr/bin/env node
// Operator-only: never accept DB credentials, keys or backup JSON on the command line.
import { backupPostgres, verifyPostgresBackup, restorePostgresBackup, verifyRestoredMarketplaceMedia } from "../server/pg-recovery.mjs";
const [, , action, filename, confirmation] = process.argv;
try {
  let result;
  if (action === "backup" && !filename && !confirmation) result = await backupPostgres();
  else if (action === "verify" && filename && !confirmation)
    result = await verifyPostgresBackup(filename);
  else if (action === "verify-media" && filename &&
      (!confirmation || /^--offset=(0|[1-9]\d{0,5})$/.test(confirmation))) {
    const offset=confirmation?Number(confirmation.slice("--offset=".length)):0;
    result=await verifyRestoredMarketplaceMedia(filename,{offset});
    if(result.status==="attention_required" || result.status==="target_mismatch")process.exitCode=2;
  }
  else if (action === "restore" && filename &&
      confirmation === "--confirm-offline-empty-target")
    result = await restorePostgresBackup(filename, { offlineConfirmed: true });
  else throw Error("usage");
  console.log(JSON.stringify({ status: "passed", scope: "storage_recovery_only",
    releaseApproval: "not_evaluated", ...result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: "blocked", code:
    error.code || "invalid_recovery_command", releaseApproval: "not_evaluated" }));
  process.exitCode = 1;
}
