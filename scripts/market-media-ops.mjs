#!/usr/bin/env node
// Explicit, operator-only media maintenance. Never logs object keys or credentials.
import { inspectMarketMediaQueue, drainMarketMediaQueue, auditMarketMediaReferences } from "../server/accounts.mjs";
try {
  if(process.env.WAE_ACCOUNTS_STORE!=="postgres" ||
      process.env.WAE_MARKET_MEDIA_STORE!=="s3")
    throw Error("operator_media_config_required");
  const [, ,action,confirmation]=process.argv;
  if(action==="inspect" && !confirmation){
    const result=await inspectMarketMediaQueue();
    console.log(JSON.stringify({mode:"read_only",...result},null,2));
  }else if(action==="manifest" && !confirmation){
    const result=await auditMarketMediaReferences();
    console.log(JSON.stringify({mode:"read_only",...result},null,2));
  }else if(action==="cleanup" && confirmation==="--confirm-deletion"){
    const result=await drainMarketMediaQueue({confirm:true});
    console.log(JSON.stringify({mode:"manual_cleanup",...result},null,2));
    if(result.failed||result.referenced)process.exitCode=2;
  }else throw Error("invalid_command");
}catch(error){
  console.error(JSON.stringify({status:"blocked",code:error.code||"operator_command_failed"}));
  process.exitCode=1;
}
