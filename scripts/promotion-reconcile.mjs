#!/usr/bin/env node
// Read-only operator report. Never log Stripe objects, account IDs or secrets.
import { auditStripePromotions } from "../server/promotion-reconciliation.mjs";
const report = await auditStripePromotions();
console.log(JSON.stringify(report, null, 2));
if (!report.ready) process.exitCode = 1;
