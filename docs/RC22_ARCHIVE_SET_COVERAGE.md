# WAEWEB RC22 — auditoría de cobertura total de cápsulas del Marketplace

**GitHub-only · PR DRAFT · Vercel HOLD.** Audita respaldos privados en modo READ ONLY; no lee ni modifica almacenamiento S3, no modifica PostgreSQL y no expone fotografías.

## Problema resuelto

RC20 crea cápsulas cifradas AES-256-GCM de hasta cinco JPEGs y RC21 puede recuperar cada lote en destino vacío sin sobrescritura. Una cápsula exitosa **no prueba** que se respaldaron todas las fotografías del estado PostgreSQL elegido. RC22 verifica que la colección de cápsulas corresponda exactamente a ese estado.

La comprobación usa el backup PostgreSQL autenticado para derivar el manifiesto esperado y abre cada cápsula autenticada con la clave de cuentas. Comprueba su checksum del backup, la huella global de referencias, offsets, recuentos, claves internas, SHA-256, tamaños y bytes de cada JPEG **sin mostrarlos al operador**.

## Uso del operador

```bash
npm run pg:verify-media-set -- \
  <PG_BACKUP_FILENAME> \
  <MEDIA_BACKUP_0> <MEDIA_BACKUP_1> <MEDIA_BACKUP_2>
```

Solo acepta nombres seguros de archivos en el directorio privado de RC20. Puede recibir de 1 a 100 cápsulas por ejecución. Si hay más, se requiere un mecanismo posterior de manifiesto/catálogo global: **no se presenta la verificación de una parte como certificación de todo el inventario**.

La salida devuelve únicamente conteos y huellas globales. `complete_set_verified` exige que cada fotografía referenciada por **ese backup PostgreSQL** aparezca una vez, sin huecos ni solapamientos. `incomplete_set` devuelve faltantes; solapamiento devuelve `attention_required`. Cápsulas duplicadas, corruptas, de otro backup o que contienen referencias alteradas se rechazan. El CLI sale con código 2 cuando no hay cobertura completa.

Un dataset sin fotografías no se presenta artificialmente como un set archivado: no se puede ejecutar una auditoría con cero cápsulas.

## Qué significa y qué NO significa

`completeArchiveSetVerified:true` certifica **cobertura y autenticidad local de las cápsulas suministradas para un backup determinado**. No certifica que existan copias externas independientes, que las claves sigan disponibles en un desastre, que el proveedor real pueda restaurarlas, que el bucket tenga versioning, ni una transacción atómica PostgreSQL+S3. `objectBackupVerified:false` y `restoreCertified:false` son intencionales.

RC22 no borra objetos ni abre nuevas rutas HTTP; `release-readiness.json` continúa **HOLD**. **No desplegar Vercel.**
