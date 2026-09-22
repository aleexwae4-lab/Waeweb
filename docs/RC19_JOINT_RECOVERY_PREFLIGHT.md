# WAEWEB RC19 — preflight conjunto PostgreSQL + fotografías privadas

**PR DRAFT · Vercel HOLD · GitHub solamente.** No conecta ni contrata infraestructura productiva y no modifica objetos durante la verificación.

## Objetivo

RC18 comprobó los bytes actuales de las fotografías contra SHA-256. RC19 une esa comprobación con el procedimiento de recuperación de PostgreSQL: un operador puede autenticar un bundle cifrado de recuperación, exigir que el estado PostgreSQL restaurado coincida exactamente con ese bundle y, solo entonces, comprobar los JPEG privados referenciados.

Esto reduce el riesgo de declarar una recuperación correcta cuando la base restaurada corresponde a otro punto temporal o cuando una fotografía referenciada falta o fue alterada.

## Flujo seguro

1. `pg:backup` genera el snapshot cifrado y su checksum.
2. `pg:verify` autentica estructura, checksum y envelopes antes de cualquier restauración.
3. `pg:restore` continúa requiriendo destino vacío y confirmación offline explícita.
4. Después de restaurar, `pg:verify-media` vuelve a autenticar el backup y toma un snapshot consistente READ ONLY del destino.
5. Si PostgreSQL no coincide exactamente con el bundle, devuelve `target_mismatch` y **no lee fotografías**.
6. Si coincide, verifica en lotes los objetos referenciados mediante GET privado acotado y SHA-256, reutilizando los controles RC18.
7. Una modificación concurrente del destino invalida el lote.

Ejemplo de operador, únicamente en un entorno autorizado:

```bash
WAE_MARKET_MEDIA_AUDIT_ACK=reviewed-read-only-media-audit \
  npm run pg:verify-media -- waeweb-pg-...backup.json

WAE_MARKET_MEDIA_AUDIT_ACK=reviewed-read-only-media-audit \
  npm run pg:verify-media -- waeweb-pg-...backup.json --offset=5
```

Los reportes no imprimen object keys, bytes, URLs firmadas, credenciales ni contenido descifrado.

## Lo que RC19 sí demuestra en CI

Las pruebas unitarias comprueban coincidencia exacta del snapshot, rechazo antes del proveedor cuando el destino difiere, detección de bytes corruptos/ausentes, referencias inválidas, lotes parciales y cambios concurrentes. La suite PostgreSQL mantiene el ensayo de restore atómico en una base local desechable.

## Lo que NO demuestra

`matching_target_batch_verified` **no significa disaster recovery certificado**. RC19 no crea ni restaura una copia del bucket, no enumera huérfanos, no prueba versioning/retención, no valida IAM o proveedor real, no mide RPO/RTO y no demuestra recuperación multirregional. Tampoco sustituye E2E móvil, privacidad, pagos ni auditoría independiente.

Por eso `restoreCertified:false`, `objectBackupVerified:false` y `release-readiness.json` continúa `HOLD`. **No desplegar Vercel todavía.**
