#!/usr/bin/env node
import { readFile } from "node:fs/promises";

export function assessVercelRelease(manifest, version) {
  const required = [
    "web-runtime", "durable-storage", "identity-and-abuse",
    "monetization", "web-e2e-and-security", "privacy-and-operations"
  ];
  const checks = Array.isArray(manifest?.checks) ? manifest.checks : [];
  const ids = checks.map(check => check?.id);
  const blockers = [];
  if (manifest?.target !== "vercel-public-web") blockers.push("Destino de despliegue desconocido.");
  if (manifest?.approval !== "GO") blockers.push("La aprobacion de lanzamiento permanece en HOLD.");
  if (typeof version !== "string" || /(?:^|[-.])(?:rc|beta|alpha)(?:[-.]|$)/i.test(version))
    blockers.push("La version es una release candidate, no una version final.");
  for (const id of required) {
    const matches = checks.filter(check => check?.id === id);
    if (matches.length !== 1) { blockers.push("Falta o se duplica el control: " + id); continue; }
    const check = matches[0];
    if (check.status !== "passed" || typeof check.evidence !== "string" ||
        !/^https:\/\/[^\s]+$/.test(check.evidence))
      blockers.push(id + ": " + (check.reason || "sin evidencia verificable"));
  }
  if (checks.length !== required.length || new Set(ids).size !== required.length)
    blockers.push("El manifiesto contiene controles inesperados o duplicados.");
  return { approved: blockers.length === 0, blockers, version, target: "vercel-public-web" };
}

const invoked = process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href;
if (invoked) {
  const manifest = JSON.parse(await readFile(new URL("../release-readiness.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const result = assessVercelRelease(manifest, pkg.version);
  console.log(JSON.stringify(result, null, 2));
  if (!result.approved) process.exitCode = 1;
}
