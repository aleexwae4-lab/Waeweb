# WAEWEB RC16 — ciclo de vida de fotos y conciliación para recuperación

**PR borrador · Vercel HOLD · no se ha borrado ningún archivo real del usuario.**

## Problema RC15
Una fotografía nueva se guarda como objeto separado del sobre cifrado de cuentas.
Eliminar una publicación/empresa, reemplazar una foto o quitarla del formulario
puede dejar el objeto antiguo sin referencia. Un fallo de DELETE del proveedor
también puede dejar archivos olvidados. El backup PostgreSQL guarda únicamente
las referencias, **no** los bytes del proveedor S3.

## Diario transaccional RC16
En el mismo cambio atómico del registro cifrado, toda sustitución, eliminación
de fotografía, publicación o empresa encola la antigua clave de objeto en
`mediaDeleteQueue`. El diario vive en PostgreSQL cifrado junto con la cuenta,
no en logs, archivos públicos ni localStorage. Si el diario alcanza 1,200
entradas, la operación que necesite encolar más objetos falla cerrada; nunca
abandona silenciosamente una referencia de limpieza.

La foto vieja se deja al menos **5 minutos** para permitir que expiren los
enlaces GET emitidos previamente, de 120 segundos. La UI deja de publicarla
desde el momento en que el estado de la ficha se actualiza. Un enlace temporal
ya emitido puede seguir funcionando hasta su expiración.

## Operación privada
Solo en un entorno PostgreSQL duradero, con el mismo conjunto seguro de
`WAE_ACCOUNTS_*` y `WAE_MEDIA_*` del runtime, ejecutar:

```bash
npm run marketplace:media:inspect
npm run marketplace:media:manifest
# Solo después de revisar inventario, backup y retención:
WAE_MARKET_MEDIA_CLEANUP_ACK=reviewed-object-deletions \
 npm run marketplace:media:cleanup -- --confirm-deletion
```

- `inspect`: conteos del diario, entradas elegibles y referencias activas,
  sin claves ni datos personales; no borra nada.
- `manifest`: conteo de referencias actuales y SHA-256 determinista
  de la lista ordenada de claves, sin revelar las claves. Sirve para
  comparar la base antes y después de una recuperación.
- `cleanup`: requiere confirmación explícita y variable de autorización
  del operador. Relee el estado antes de cada borrado, rechaza claves
  activas y solo quita la entrada del diario después de confirmar éxito
  del DELETE S3. Un fallo del proveedor conserva el pendiente para reintento.
  El resumen muestra conteos, no ubicaciones ni credenciales.

El CLI no expone rutas HTTP de limpieza, no agenda tareas en GitHub Actions,
no elimina objetos sin confirmación ni presupone que existe un bucket real.

## Límites que siguen bloqueando producción

1. No se ha ejecutado un backup/restore conjunto real **PostgreSQL + bucket**.
   El SHA-256 de claves **no prueba que los objetos existan** ni que sean
   recuperables. Deben restaurarse las versiones correctas del bucket junto
   con la base y contrastar las referencias, objetos, integridad y permisos.
2. La cola trata objetos que *antes estaban referenciados*. No captura
   necesariamente un PUT exitoso seguido de fallo de DB **y de la limpieza
   compensatoria**: esos objetos necesitan inventario del proveedor y
   reconciliación manual. Tampoco escanea archivos de versiones anteriores.
3. Borrado asíncrono y reintentos no ofrecen revocación instantánea ni
   garantías de supresión verificable en réplicas, versionado o backups S3.
4. Faltan migración de fotografías Base64 legadas, lifecycle/retención,
   políticas de datos y eliminación, evaluación de proveedor real,
   auditoría de concurrencia, E2E móvil y seguridad externa.
5. La cola cifrada está sujeta al límite del sobre de cuentas de 4 MiB y
   a los límites de 500 usuarios, 20 negocios, 40 anuncios con fotos externas;
   no ofrece escalado ilimitado. El registro será candidato a
   particionarse en tablas por tenant antes de crecer.
6. El contenido público sigue siendo autodeclarado; no hay pagos comprador,
   garantía comercial ni sistema de entrega.

El release general `release-readiness.json` permanece `HOLD`.
