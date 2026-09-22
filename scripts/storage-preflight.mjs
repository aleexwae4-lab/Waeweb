#!/usr/bin/env node
// Operator-only diagnostic. No secrets, DB records or connection strings printed.
import {probeStorageReadiness} from "../server/storage-preflight.mjs";
const result=await probeStorageReadiness();
console.log(JSON.stringify(result,null,2));
if(!result.ready)process.exitCode=1;
