# WAEWEB RC8 — persistencia obligatoria y preflight de almacenamiento

**Desarrollo en GitHub exclusivamente. NO desplegado.** Este control es para
operadores antes de activar cuentas, negocios, promociones, investigación y
WAEWEB Connect. NO autoriza una liberación y no crea bases, claves ni tablas.

## Protección contra pérdida de datos

`server/hosting.mjs` identifica ejecución de producción o alojamiento:
`NODE_ENV=production`, `VERCEL`, `RENDER`, `RENDER_SERVICE_ID`,
`RENDER_EXTERNAL_HOSTNAME`, `AWS_LAMBDA_FUNCTION_NAME`, `K_SERVICE`.

Cuando aparece cualquiera de esas señales, los almacenes `file` de
cuentas y bóvedas quedan **desactivados** en el backend. Las rutas de
registro, perfiles de empresas, promociones e investigación no deben
escribir archivos cifrados en el disco efímero de una instancia.
`/api/capabilities` informa `accountsEnabled:false`,
`readerEnabled:false` e `indexPersistence:"disabled"` en esa condición.
Una variable faltante de PostgreSQL **no** reactiva archivos como fallback.

Los archivos cifrados locales conservan su utilidad para desarrollo
explícitamente local. En servicio alojado, configurar PostgreSQL verificado
por TLS para `WAE_ACCOUNTS_STORE=postgres`,
`WAE_VAULT_STORE=postgres` y
`WAE_CONNECT_ADMISSION_MODE=postgres` (si se usa Connect).
El almacenamiento de PostgreSQL se habilita por configuración;
ningún secreto aparece en GitHub ni en la respuesta pública de salud.

## Preflight de solo lectura

Comando del operador, en un entorno seguro configurado con las variables
reales de ese **único** despliegue:

```bash
npm run storage:preflight
```

Comprueba los siguientes componentes, **sin modificar filas o cuotas**:

| Control | Verificación |
| --- | --- |
| `encrypted_accounts` | Activación y clave válida; esquema existente; sobre cifrado de cuentas autenticable cuando contiene datos |
| `isolated_vaults` | Reader PostgreSQL, credenciales y claves por bóveda; cada sobre existente pertenece a una identidad conocida y se autentica |
| `distributed_connect` | Connect habilitado, tres identidades admitidas, política PostgreSQL y tablas de cuota/lease consultables sin consumir solicitudes |

Si falta configuración, base, tabla, identidad o clave, el comando termina
con código diferente de cero y `ready:false`. Los errores de base de datos
se expresan como `storage_probe_failed`, no muestran URL, contraseñas,
claves, consultas con datos, emails ni texto documental.

`scope:"storage_only"` y `releaseApproval:"not_evaluated"` significan
que **un PASS no autoriza despliegue**. Es una verificación puntual,
no monitoreo permanente. Este preflight tampoco reemplaza pruebas de
migración de archivos, backup/restore, facturación, correo, navegador
móvil ni E2E de los tres Render.

Evidencia en DB aislada de CI:
[PostgreSQL 16 + storage preflight PASS](https://github.com/aleexwae4-lab/Waeweb/actions/runs/35720429537).
[Prueba HTTP de los entornos alojados](../tests/hosted-storage.test.mjs).

**Vercel sigue HOLD:** `release-readiness.json` y
`npm run release:gate` permanecen como autoridad de NO-GO.
