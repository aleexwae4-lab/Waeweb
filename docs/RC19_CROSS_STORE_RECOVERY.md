# WAEWEB RC19 — preflight de recuperación cruzada PostgreSQL ↔ fotografías

**DRAFT / HOLD. Solo GitHub. No merge, despliegue ni proveedores externos.**

## Problema
El backup cifrado PostgreSQL de RC11 contiene referencias, SHA-256 y tamaño de fotografías, pero **no contiene los JPEG S3**. RC18 compara contenido del almacén actual; eso no prueba que se pueda reconstruir la misma base y recuperar las fotos tras un desastre.

## RC19 implementado
La operación `pg:verify-media` autentica primero un archivo privado de backup (checksum y sobres cifrados). Lee una instantánea de PostgreSQL actual en transacción read-only; compara el sobre de cuentas **y los sobres de todas las bibliotecas/vaults** con los del backup. **No inicia GET del proveedor si el target no coincide con el backup.** Si coincide, descifra exclusivamente en memoria el sobre de cuentas del backup; verifica correspondencia negocio/publicación/clave y consulta, con GET firmado y un límite conservador, los JPEG del almacén configurado. Compara tamaño, JPEG y SHA-256 grabados en el snapshot. Relee el target después del lote; cambios concurrentes dan `attention_required`. Los resultados no imprimen bytes, claves de objeto, credenciales ni URLs.

Ejemplo de operación **solo sobre copia aislada y con proveedor autorizado**:

```bash
npm run pg:backup
npm run pg:verify -- waeweb-pg-<timestamp>-<uuid>.backup.json
# Sobre un target VACÍO offline, sujeto a revisión del operador:
npm run pg:restore -- waeweb-pg-<timestamp>-<uuid>.backup.json --confirm-offline-empty-target
# PREVIEW READ-ONLY; no llama restore ni modifica S3:
WAE_MARKET_MEDIA_AUDIT_ACK=reviewed-read-only-media-audit \
 npm run pg:verify-media -- waeweb-pg-<timestamp>-<uuid>.backup.json
# Si hay más de cinco fotografías, seguir nextOffset y cotejar checksum:
WAE_MARKET_MEDIA_AUDIT_ACK=reviewed-read-only-media-audit \
 npm run pg:verify-media -- waeweb-pg-<timestamp>-<uuid>.backup.json --offset=5
```

**Nunca ejecutar el restore en la base de producción ni borrar una base para hacer una prueba.** La restauración RC11 sigue requiriendo target vacío, ventana offline y confirmación; RC19 no la invoca. El comando de preflight solo lee.

## Evidencia
Las pruebas unitarias crean sobres cifrados sintéticos y prueban mismatch de target, de JPEG, lote, cambio concurrente, referencias inválidas y cero escrituras en verificación. La integración CI crea una ficha y foto sintética en PostgreSQL descartable + proveedor en memoria, crea backup, detecta corrupción del JPEG, comprueba mismatch al vaciar el target, verifica rollback de error forzado, restaura en target vacío y revalida hash del JPEG y cuentas/bibliotecas. **Ningún proveedor real.**

## Lo que NO demuestra
La fotografía sigue existiendo en la misma fixture del test durante la restauración de PostgreSQL: no se ha respaldado ni recreado S3 a partir de una copia independiente. Igualdad de target/backup no prueba por sí misma que se haya ejecutado restore ni que el target esté aislado. Una revisión por lotes no prueba consistencia global si hay escrituras entre lotes. Faltan backup del bucket y restauración desde medio independiente, inventario de huérfanos/versiones, IAM productivo, evaluación de proveedor, simulacro real de pérdida total, RPO/RTO, E2E móvil, privacidad y seguridad externa.

`release-readiness.json` sigue **HOLD**; NO autorizar Vercel.
