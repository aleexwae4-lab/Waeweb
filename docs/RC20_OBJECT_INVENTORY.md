# WAEWEB RC20 — inventario privado y detección de huérfanos

**PR DRAFT · Vercel HOLD · GitHub solamente.** RC20 no borra objetos ni conecta infraestructura productiva.

## Objetivo

RC19 cruza el backup cifrado de PostgreSQL con los bytes referenciados. RC20 añade la vista inversa: pregunta al almacenamiento S3-compatible qué objetos existen bajo `marketplace/` y los compara con las referencias cifradas y el journal de eliminación.

## Clasificación

El inventario solo entrega conteos agregados:

- `referenced`: objeto esperado por una publicación.
- `queued`: objeto que ya está en el journal de eliminación segura.
- `orphanCandidates`: objeto válido que no está referenciado ni en el journal.
- `unexpectedKeys`: entrada fuera del formato privado WAEWEB.
- `missingCandidates`: referencia PostgreSQL que no apareció en un inventario **completo**.

No imprime object keys, credenciales ni URLs del proveedor.

## Seguridad

La consulta usa AWS SigV4 y ListObjectsV2 con prefijo `marketplace/`, máximo 100 objetos por página y entre 1 y 5 páginas por ejecución. El XML tiene límite de 256 KiB, redirecciones desactivadas, timeout, validación estricta de cursor y detección de duplicados/bucles. Un inventario parcial nunca declara cobertura total.

Antes y después del inventario se calcula una huella del manifiesto de referencias + journal. Si PostgreSQL cambia durante la lectura, el resultado requiere atención.

Fuera de CI requiere autorización explícita:

```bash
WAE_MARK_MEDIA_INVENTORY_ACK=reviewed-private-object-inventory \
  npm run marketplace:media:inventory

WAE_MARK_MEDIA_INVENTORY_ACK=reviewed-private-object-inventory \
  npm run marketplace:media:inventory -- --pages=5
```

## Regla de eliminación

**RC20 jamás elimina un huérfano.** `orphanCandidates` significa candidato para revisión, no autorización. El cleanup RC16 continúa separado y solo opera sobre el journal explícito con su propia confirmación.

## Límites

Un inventario correcto no es un backup. RC20 no copia objetos a otro almacenamiento, no restaura un bucket, no prueba versioning/retención, IAM real, replicación, RPO/RTO ni recuperación multirregional. Por ello `objectBackupVerified:false`, `restoreCertified:false` y el release continúa `HOLD`.

**No desplegar Vercel todavía.**
