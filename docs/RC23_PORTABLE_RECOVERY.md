# WAEWEB RC23 — paquete de recuperación cifrado y portable

**GitHub-only · PR DRAFT · Vercel HOLD.** No se exportan datos reales ni se conecta un proveedor externo durante las pruebas.

## Propósito

RC22 comprueba que las cápsulas cifradas cubren exactamente las imágenes de un respaldo PostgreSQL. RC23 permite reunir ese backup y todas las cápsulas verificadas en un **paquete privado transportable**, con checksums SHA-256 por archivo, y volverlo a verificar **aunque ya no existan los archivos originales**. Esto facilita preparar una copia offline bajo custodia explícita de un operador sin inventar certificaciones de proveedor.

El paquete contiene exclusivamente el backup de PostgreSQL con sus sobres cifrados, las cápsulas AES-256-GCM con JPEGs/claves privadas cifrados y un manifiesto de metadatos/checksums. El nombre del paquete y la salida pública no revelan object keys, imágenes ni credenciales. El manifiesto sí contiene información operativa (número de cápsulas, checksum del backup): sigue siendo material privado.

## Requisitos y comandos

La ruta de destino debe ser **absoluta**, existir como directorio privado `0700` o poder crearse con ese permiso, quedar **fuera del repositorio**, y no coincidir ni anidarse con los directorios del backup PG o las cápsulas originales. No utilices `public/`, GitHub, rutas servidas ni un bucket sin autorización. No se guardan contraseñas ni claves dentro del paquete.

```bash
export WAE_OFFLINE_EXPORT_DIR=/ruta/privada/elegida/por/el/operador
export WAE_PORTABLE_EXPORT_ACK=reviewed-offline-encrypted-copy

npm run pg:export-portable -- \
  <PG_BACKUP_FILENAME> <MEDIA_CAPSULE_0> <MEDIA_CAPSULE_1>

# Tras guardar el packageName, verificar desde esa ruta privada:
npm run pg:verify-portable -- <PACKAGE_NAME>
```

El comando de exportación **rechaza** colecciones incompletas, solapadas o alteradas antes de copiar bytes. Cada archivo del paquete se escribe con creación exclusiva y permisos `0600` dentro de un directorio temporal `0700` y el nombre final se publica mediante rename al completar sus archivos y manifiesto. Ante fallo se descarta solamente la carpeta temporal recién creada; nunca se borra el backup original ni una fotografía.

El comando de verificación no abre los directorios de origen, no requiere conectarse a PostgreSQL ni a S3, comprueba los checksums del paquete y vuelve a autenticar el backup PostgreSQL y **cada** cápsula para exigir cobertura total. Se mantienen necesarias las claves de cifrado del entorno de recuperación. No se escriben objetos ni registros de BD.

## Seguridad y límites

- Hasta 100 cápsulas y un backup PG por paquete. No afirmar cobertura de catálogos que superen el límite de esta versión.
- No se aceptan nombres de paquete con traversal, enlaces simbólicos, archivos inesperados, permisos de lectura de grupo u otros, tamaños mayores al límite ni manifiestos inconsistentes.
- No se sobrescriben paquetes previos. La ubicación de exportación se elige explícitamente fuera de la carpeta fuente y de GitHub.
- Los checksums públicos por sí solos no autentican un manifiesto alterado deliberadamente. La verificación **también** autentica criptográficamente el backup PG y las cápsulas con la clave correspondiente, y compara su identidad y cobertura.
- Una copia en un segundo directorio **no demuestra** que viva en un dispositivo, región, proveedor o dominio de fallo diferente. RC23 NO hace replicación externa, gestión KMS, respaldo automático ni prueba IAM, retención, RPO/RTO o desastre en proveedor real.
- El paquete verificado es una fuente portable para un proceso offline posterior: esta versión no lo importa ni despliega automáticamente, y no ejecuta restauración externa.

Por ello `copyContentVerified:true` puede coexistir correctamente con `independentFailureDomainVerified:false`, `providerRestoreVerified:false`, `restoreCertified:false` y `release-readiness.json: HOLD`. **No desplegar Vercel.**
