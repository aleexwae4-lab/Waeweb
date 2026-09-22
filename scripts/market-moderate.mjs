#!/usr/bin/env node
// Operator-only. Do not expose as HTTP or accept secrets in command arguments.
import { listMarketReports, reviewMarketReport } from "../server/accounts.mjs";
try {
  if(process.env.WAE_ACCOUNTS_STORE!=="postgres")
    throw Error("postgres_required");
  const [, ,action,id,decision,confirmation]=process.argv;
  let output;
  if(action==="list" && !id && !decision && !confirmation)
    output=await listMarketReports();
  else if(action==="review" && id && ["dismiss","hide"].includes(decision) &&
      confirmation==="--confirm-manual-review")
    output=await reviewMarketReport(id,decision,{manualConfirmed:true});
  else throw Error("invalid_command");
  console.log(JSON.stringify(output,null,2));
}catch(error){
  console.error(JSON.stringify({status:"blocked",code:error.code||"operator_command_failed"}));
  process.exitCode=1;
}
