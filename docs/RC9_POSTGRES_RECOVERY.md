# WAEWEB RC9 — recuperación cifrada de PostgreSQL (solo operador)

**DRAFT / HOLD. No despliegue, merge ni credenciales de producción.** Esta función
cubre el registro cifrado de cuentas, empresas y promociones y las bóvedas cifradas
de investigación. No incluye las tablas de cuotas/leases de Connect ni el estado
externo de Stripe; deben reconstruirse o reconciliarse mediante un procedimiento
separado antes de abrir el servicio.

## Preparación

- Solo desde un equipo de operaciones seguro: WAE_ACCOUNTS_STORE=postgres,
  WAE_VAULT_STORE=postgres, WAE_ACCOUNTS_KEY, WAE_VAULTS_JSON,
  WAE_VAULT_KEYS_JSON y URL + CA PostgreSQL correctas.
- Definir WAE_PG_BACKUP_DIR en un volumen **duradero, privado, no público y
  preferiblemente separado** del proveedor de la base; nunca en public/ o Git.
- Conservar las claves AES de las cuentas y de cada bóveda en un gestor de
  secretos independiente del archivo. El respaldo es inservible si se pierden.
- Los accesos al volumen, copias fuera del proveedor, retención y alertas quedan
  bajo control operativo. El programa no crea servicios externos ni backups
  automáticos.

## Copia puntual coherente

```bash
npm run pg:backup
npm run pg:verify -- <waeweb-pg-....backup.json>
```

Una única transacción PostgreSQL REPEATABLE READ READ ONLY lee los sobres de
cuentas y bóvedas de un mismo punto lógico. El contenido se valida por tenant,
AES-256-GCM y checksum SHA-256; el archivo se crea exclusivamente con permiso
0600. El resultado de consola **no imprime el contenido cifrado, claves,
credenciales ni datos personales**. Un checksum es integridad accidental;
la autenticación de los documentos depende de AES-GCM y de guardar las claves
correctas por separado.

## Ensayo de restauración: nunca sobreescribir

1. Detener **todas** las instancias y escritores, incluyendo procesos de pago,
   indexación y Connect. Bloquear tráfico antes de continuar.
2. Provisionar una base nueva, aislada, con esquema aprobado e inicializado:
   una fila accounts id=1 con envelope NULL y ninguna fila de bóvedas.
   No utilizar una base que pudiera contener cuentas, empresas o promociones.
3. Restaurar usando **las claves originales** y el volumen con respaldo:
   `npm run pg:restore -- <filename> --confirm-offline-empty-target`
4. Verificar lectura de cuentas y documentos, claves por organización, auditoría
   de pagos y cuotas Connect; finalizar un simulacro de rollback y recuperación
   de servicio antes de abrir tráfico.

La transacción toma locks exclusivos sobre ambas tablas, verifica destino
vacío y hace commit o rollback conjunto. **No sobrescribe registros existentes**.
El flag CLI confirma que el operador ya detuvo el servicio; no es una
detección automática de escritores externos. El propio sistema no borra el
destino ni importa cuentas locales sin un procedimiento dedicado.

## Alcance de las pruebas

- Unitarias: alteración de ciphertext, checksum falso, identidad de tenant
  desconocida y restauración sin confirmación.
- Integración: base PostgreSQL descartable poblada con cuentas y bóvedas;
  copia, verificación, corrupción, rechazo de restauración no vacía,
  limpieza intencionada SOLO en CI, restauración y lectura de datos.
- Para correr el simulacro aislado: `npm run test:pg:recovery` bajo
  WAE_PG_INTEGRATION=true con la base y la configuración **descartables**.

Este control es `storage_recovery_only`, no certifica la recuperación
productiva, RPO/RTO, proveedor externo, compensación de pagos ni autorización
de Vercel. `release-readiness.json` sigue HOLD.
