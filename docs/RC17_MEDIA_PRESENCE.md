# WAEWEB RC17 — auditoría de presencia de fotografías (SIN despliegue)

**Borrador / HOLD. Solo GitHub. No se conectó ningún S3 real ni se desplegó Vercel.**

## Continuidad desde RC16

RC16 agregó cola transaccional de eliminación y manifiesto SHA-256 de referencias cifradas. RC17 agrega una comprobación **de solo lectura** contra el almacén S3-compatible configurado por el operador mediante HEAD firmado (SigV4). Esto detecta fotografías referenciadas pero ausentes, permisos rechazados, tamaños inválidos y fallos del proveedor, sin publicar ubicaciones de objetos, claves, fotografías ni credenciales.

### Uso del operador (solo cuando exista PostgreSQL persistente y S3 autorizado)
```bash
npm run marketplace:media:manifest
npm run marketplace:media:probe
npm run marketplace:media:probe -- --offset=25
```
Cada lote revisa máximo 25 referencias (límite interno 50). `nextOffset` permite continuar; si se modifican fotos entre lotes, comparar `manifestFingerprint` y volver a empezar. Ningún informe parcial autoriza producción. El resultado `attention_required` produce exit code 2; errores de configuración producen exit code 1.

**No ejecutar `cleanup` como parte de la auditoría.** Este comando no realiza PUT, GET de bytes ni DELETE. El servicio nunca expone un endpoint público para auditar claves privadas.

## Lo que sí se comprueba

- Que cada clave referenciada en la base tenga formato válido y no exista duplicación.
- Que el proveedor responda a HEAD con 200 y longitud JPEG entre 8 y 250 KiB; 404, 401/403, redirecciones, errores de red y tamaños inválidos se contabilizan sin exponer la clave.
- Que el manifiesto completo de referencias permanezca inalterado entre el comienzo y el fin de cada lote.
- Que la auditoría no dependa de un proveedor comercial: las pruebas CI utilizan PostgreSQL descartable y un servidor S3 sintético local.

## Lo que NO se certifica

HEAD comprueba presencia/tamaño, **no que los bytes sean la imagen correcta**, integridad SHA-256, número de versión, bucket privado real, inventario de huérfanos, backup del bucket, versionado, recuperación conjunta de PostgreSQL+bucket, consistencia a través de varios lotes, copias fuera de sitio, RPO/RTO, IAM productivo ni borrado en réplicas. Un HEAD 200 tampoco demuestra que un usuario pueda recuperar la fotografía mediante GET.

Los respaldos y restauraciones reales de PostgreSQL y archivos siguen siendo una condición de **NO-GO**. No solicitar credenciales ni mover datos de clientes a GitHub o logs; no introducir un proveedor o compromiso económico sin autorización.

PR #1 permanece DRAFT, `main` intacta y `release-readiness.json` continúa `HOLD`.
