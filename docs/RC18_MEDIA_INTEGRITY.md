# WAEWEB RC18 — integridad criptográfica de imágenes del Marketplace

**PR DRAFT · Vercel HOLD · GitHub solamente.** Sin contratar almacenamiento ni operar archivos reales del usuario.

## Mejora
Los JPEG nuevos conservan `imageSha256` y `imageBytes` en el registro cifrado de PostgreSQL, asociados atómicamente con `imageKey` después de un PUT exitoso. En sustitución se encola el objeto previo en RC16; al quitar la foto, se eliminan sus referencias y metadatos. La proyección pública no expone estos campos.

RC17 solo comprobaba presencia (HEAD). RC18 añade GET privado de hasta 250 KiB por fotografía y comparación de tamaño, formato y SHA-256. Las fotografías previas sin metadatos se etiquetan `legacy_unverified`, nunca se declaran verificadas por inferencia.

## Ejecución de operador
Tras autorizar expresamente el acceso a contenido privado con las variables PostgreSQL y S3 verificadas:

```bash
WAE_MARKET_MEDIA_AUDIT_ACK=reviewed-read-only-media-audit npm run marketplace:media:integrity
WAE_MARKET_MEDIA_AUDIT_ACK=reviewed-read-only-media-audit npm run marketplace:media:integrity -- --offset=5
```

Lotes de 5 por defecto y máximo 10 por ejecución. Sin endpoints públicos, uploads, modificaciones, eliminaciones, claves ni bytes en reportes. Salida 2 para anomalías. El operador deberá cotejar `manifestFingerprint` entre lotes: el último lote por sí solo no certifica una revisión integral.

Se comprueba correspondencia de clave con empresa y publicación; se detectan duplicaciones, hashes incorrectos, ausencia, permisos, MIME o formato erróneos, error del proveedor y cambios de referencias/metadatos durante el lote.

## Límites explícitos
Una coincidencia SHA-256 verifica los bytes leídos en ese momento frente al registro cifrado. **No prueba backup, retención, inventario de huérfanos, versionado S3, restauración conjunta PostgreSQL+bucket, IAM real, RPO/RTO ni seguridad externa.** No se migran automáticamente fotografías antiguas ni se propone borrar objetos como resultado de una auditoría. Siguen pendientes E2E móvil, privacidad y pagos.

`release-readiness.json` continúa HOLD. No desplegar Vercel.
