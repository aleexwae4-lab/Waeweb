# WAEWEB RC12 — conciliación de promociones pagadas

**DRAFT / HOLD. GitHub solamente. No desplegar, fusionar ni conectar pagos reales.**

## Contrato comercial
El registro de negocios continúa siendo gratuito. El plan Promocionar utiliza
Stripe Checkout y solo concede el bloque marcado **Patrocinado** tras un evento
firmado, una suscripción activa con precio configurado y factura pagada. La
conciliación RC12 es una verificación adicional **sin escrituras**: NO cobra,
cancela, renueva, acredita ni desactiva una suscripción, y no crea publicaciones.

## Huella verificable de compra
En un checkout confirmado, el registro cifrado conserva `attemptId` además
del ID de suscripción, su estado y vencimiento. Con esto, la auditoría puede
comparar `account_id`, `business_id` y `attempt_id` de la suscripción
actual contra el negocio exacto. Las promociones anteriores que no incluyen
`attemptId` quedan marcadas `legacy_binding_unverifiable`; nunca se les
inventa una identidad ni se autoaprueban.

## Ejecución privada
En un entorno seguro, configurar los mismos secretos privados que habilitan
Stripe y la conexión PostgreSQL cifrada: `WAE_ACCOUNTS_STORE=postgres`,
`WAE_ACCOUNTS_KEY`, `WAE_ACCOUNTS_DATABASE_URL`,
`WAE_ACCOUNTS_PG_CA`, `WAE_PROMOTIONS_ENABLED`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_PROMOTION_PRICE_ID` y `WAE_PUBLIC_ORIGIN`.

Ejecutar **solo desde consola privada**:

```bash
npm run promotions:audit
```

La operación lee el sobre AES-GCM en PostgreSQL y consulta individualmente
el estado vigente de Stripe. Contrasta modo prueba/producción, identidad,
precio del plan, factura pagada, período, estado local y visibilidad pública.
Un fallo del proveedor se clasifica como `provider_unavailable`, no como
confirmación positiva ni motivo automático para cancelar pagos.

El resultado contiene **únicamente conteos y códigos de clasificación**,
sin correo, IDs de clientes, referencias Stripe, credenciales ni datos de
facturas. `ready:false` produce salida de proceso distinta de cero. Un
`ready:true` valida ese punto de observación, no autoriza despliegue.

| Resultado | Significado |
| --- | --- |
| `matched` | Estado y titularidad corroborados en ambos lados |
| `entitlement_drift` | Estado, vigencia o precio no coincide |
| `owner_binding_mismatch` | La suscripción no corresponde a la cuenta/negocio/compra |
| `legacy_binding_unverifiable` | Falta la huella de compra en datos anteriores |
| `duplicate_subscription` | Dos negocios locales comparten suscripción |
| `provider_unavailable` | Stripe no pudo confirmar el estado |
| `invalid_local_record` | Registro comercial inconsistente |
| `audit_unavailable` | No se pudo completar la verificación |

## Límites y trabajo aún pendiente
- El control es una **auditoría a demanda**; no hace polling, no consume
  webhooks, no muta Stripe y no automatiza reclamaciones ni ajustes de cobro.
- No equivale a conciliación contable de facturas, reembolsos, contracargos,
  impuestos o saldo de Stripe. Debe existir reconciliación operativa y
  pruebas E2E con Stripe en modo test antes de habilitar cobros públicos.
- `release-readiness.json` sigue en `HOLD` hasta que pagos, identidad,
  recuperación de proveedor y seguridad completen sus propias evidencias.
