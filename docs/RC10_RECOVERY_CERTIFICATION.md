# WAEWEB RC10 — recuperación verificable en CI aislado

**Sin merge ni despliegue. Vercel continúa HOLD.**

## Propósito
RC9 agregó snapshots coherentes y cifrados de cuentas, empresas, promociones
y bóvedas de investigación. RC10 conecta el simulacro PostgreSQL 16 a GitHub
Actions y refuerza una condición esencial: ningún test que vacíe una tabla puede
apuntar por accidente a un proveedor real.

## Comprobaciones RC10
- El workflow `.github/workflows/postgres.yml` ejecuta las pruebas de
  cuentas, bóvedas, cuotas Connect, preflight de solo lectura y **al final**
  `npm run test:pg:recovery`.
- La prueba destructiva solo avanza si `NODE_ENV=test`, conexión PostgreSQL
  local sin TLS, host `127.0.0.1`, usuario y base `wae_test`, autorización
  `WAE_PG_RECOVERY_CI_ACK=disposable-wae-test-only`.
- El archivo cifrado se verifica y se rechaza si se altera, se rechaza
  restaurar sobre un destino que ya contiene cuentas o bóvedas.
- Prueba de inyección de fallo: un trigger exclusivo del CI impide insertar
  una bóveda después de actualizar la cuenta; se comprueba **rollback de
  ambas tablas**, se retira el trigger y finalmente se restaura.
- El contenido del registro de cuentas y de las bóvedas después del restore
  debe coincidir exactamente con el snapshot, sin exponer plaintext en logs.

## Evidencia y límites
[Primer simulacro PostgreSQL RC10 aprobado (antes de inyección de fallo)](https://github.com/aleexwae4-lab/Waeweb/actions/runs/35721587184).

El ensayo con inyección tiene que mostrar PASS en GitHub Actions antes de
atribuirle esa garantía. Incluso con PASS en CI, este ensayo **no valida**
la base real del proveedor, copia externa o retención, gestión de secretos,
RPO/RTO, importación de archivos, Stripe, restauración de cuotas Connect o
despliegues de los tres Render. Es obligatorio el ensayo supervisado
sobre una base nueva del proveedor con snapshots protegidos. Sin eso, el
control durable-storage de release-readiness.json sigue bloqueado.
