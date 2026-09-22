# WAEWEB RC21 — restauración offline de fotografías cifradas

**GitHub-only · PR DRAFT · Vercel HOLD.** El nuevo código NO restaura objetos de proveedores reales durante CI y no se ejecuta contra datos de usuarios.

## Alcance

RC20 incorporó cápsulas privadas cifradas AES-256-GCM de hasta 5 JPEGs, vinculadas al checksum de un backup PostgreSQL y al manifiesto de referencias SHA-256. RC21 agrega restauración **offline, explícita y sin sobrescritura** desde una cápsula verificable.

La cápsula es un respaldo de los bytes archivados, no una réplica continua. Su escritura local no garantiza supervivencia ante la pérdida del servidor: requiere custodia externa independiente. Cada lote tiene `offset/count/total`: una cápsula parcial no se anuncia como recuperación completa. La clave de la cuenta y el backup PostgreSQL correspondiente son imprescindibles; perderlos impide la recuperación.

## Procedimiento de operador (NO ejecutar en producción hasta autorizar proveedor y ensayo)

1. Detener las instancias de aplicación que escriben en PostgreSQL u objetos. Disponer de backups privados fuera del servidor. Garantizar que el almacenamiento de destino corresponde al entorno correcto.
2. Generar una copia cifrada coherente: `npm run pg:backup`. Con PostgreSQL sin cambios, `WAE_MARK_MEDIA_BACKUP_ACK=reviewed-private-media-backup npm run pg:backup-media -- <PG_BACKUP_FILENAME>`. Repetir `--offset=5`, `--offset=10` según el `nextOffset`.
3. Verificar cada cápsula con `npm run pg:verify-media-backup -- <MEDIA_BACKUP_FILENAME> <PG_BACKUP_FILENAME>`. Guardar copias privadas independientes y las claves fuera de GitHub.
4. Restaurar PostgreSQL **solo en destino vacío y offline**, con el procedimiento RC19.
5. Revisar manualmente destinos, lotes, bitácora de borrado y permisos. La cápsula debe pertenecer al mismo backup y el destino PostgreSQL debe coincidir exactamente.
6. Para cada lote, habilitar la autorización del operador y confirmar explícitamente:

```bash
WAE_MARK_MEDIA_RESTORE_ACK=reviewed-offline-missing-objects-only \
 npm run pg:restore-media -- <MEDIA_BACKUP_FILENAME> <PG_BACKUP_FILENAME> \
 --confirm-offline-media-restore
```

7. Comprobar el resultado y ejecutar `pg:verify-media` por todas las páginas; reconciliar también inventario RC20. No reabrir escrituras hasta finalizar la revisión.

## Garantías implementadas

- Autenticación AES-GCM de la cápsula y vínculo al checksum/manifiesto del backup PostgreSQL.
- Confirmación offline + ACK separados para operación que escribe objetos.
- Coincidencia exacta de cuentas y bóvedas con el backup restaurado; rechazo cerrado si queda cualquier entrada pendiente en el journal de eliminación, que debe reconciliarse manualmente primero.
- Preflight por HEAD para **todos** los objetos del lote: si existe uno solo, no se escribe ninguno.
- Cada PUT lleva `If-None-Match: *` **incluido en AWS SigV4** para que el proveedor impida carreras de sobrescritura incluso después del HEAD.
- Verificación de bytes/tamaño/SHA-256 tras cada escritura.
- Sin DELETE, overwrite intencional, nuevas rutas HTTP públicas ni datos confidenciales en el reporte.

**Fallos a mitad de lote:** los PUT ya aceptados no se deshacen ni se borran automáticamente. Se devuelve `partial_recovery` y se requiere inspección manual. Si el destino ya contiene un objeto, la restauración rechaza el lote completo; nunca salta silenciosamente ni reemplaza ese objeto.

## Límites y NO-GO

No existe una transacción atómica entre PostgreSQL y S3. Las cápsulas tienen capacidad acotada; RC21 no incluye snapshots consistentes automáticos de un bucket completo, catálogo exhaustivo de todos los lotes, custodia externa, gestión KMS, versioning, retención, pruebas sobre un proveedor/credenciales reales, RPO/RTO o recuperación multirregional. No se certifica disponibilidad, retención ni recuperabilidad de fotografías legadas sin SHA-256.

`restoreCertified:false` y `release-readiness.json: HOLD` permanecen. **No desplegar Vercel.**
