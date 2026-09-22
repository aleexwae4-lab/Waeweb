# WAEWEB RC11 — cierre del fallo del simulacro y privacidad del backup

**Estado:** desarrollo aislado en GitHub. Vercel y Render no se modifican; PR en borrador.

## Hallazgo y corrección

El simulacro de RC10 con trigger de fallo no pasó inicialmente: PostgreSQL
reportó error SQL cerca de `$`. Se corrigió delimitando correctamente
la función PL/pgSQL con una etiqueta dollar-quoted explícita. El job posterior
demostró: fallo de INSERT provocado, rollback íntegro de cuentas y bóvedas,
y restauración exitosa al retirar la inyección.

[Evidencia PostgreSQL PASS: 35722504174](https://github.com/aleexwae4-lab/Waeweb/actions/runs/35722504174).

## Privacidad de los respaldos

RC11 exige un directorio privado real, sin symlinks ni permisos para grupo
u otros en sistemas POSIX. Cada archivo de respaldo debe ser un archivo
normal sin permisos para grupo u otros; `verify` y `restore` rechazan
archivos o carpetas con permisos inseguros. Se rechaza usar como carpeta
de respaldo la raíz del repositorio, `public/`, `.git/` y sus subdirectorios.
El operador debe configurar un volumen de almacenamiento duradero y
separado del proveedor PostgreSQL; el propio programa no provisiona
almacenamiento externo ni programa copias periódicas.

En Linux/macOS, al transferir un backup mediante un canal seguro, fijar
`chmod 700 /secure/waeweb-backups` y `chmod 600 /secure/waeweb-backups/<archivo>`
antes de `npm run pg:verify -- <archivo>`. No incluir claves AES en el
mismo medio.

## Evidencia y NO-GO

El Quality Gate de RC11 y su prueba PostgreSQL han de verificarse sobre el
HEAD de la rama; el PASS del commit anterior no certifica cambios nuevos.
Persisten los bloqueos de producción: recuperación en el proveedor real,
copias fuera de la infraestructura productiva, gestión de claves, migración
de archivos, conciliación Stripe, correo/recovery, tres Render E2E,
controles móviles, privacidad y políticas operativas.

`release-readiness.json` permanece `HOLD` y no se autoriza Vercel.
