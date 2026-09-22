# WAEWEB RC15 — fotografías del Marketplace fuera del registro de cuentas

**DRAFT / HOLD. GitHub solamente. No se ha conectado un proveedor real,
contratado almacenamiento, fusionado el PR ni desplegado Vercel.**

## Arquitectura implementada

- Modo RC13 compatible: las fotos inline existentes permanecen accesibles
  mientras se prepara su migración. Máximo 16 fichas por empresa en ese modo.
- Modo opt-in: S3 compatible con path-style; la imagen JPEG queda en un
  **bucket privado**. El registro cifrado PostgreSQL solo almacena
  `imageKey` (identificador opaco, por empresa/ficha/UUID), tipo y metadatos.
  Este modo amplía el límite lógico a 40 fichas por empresa; sigue vigente
  el límite global de 4 MiB del sobre cifrado, por lo que no hay capacidad
  ilimitada.
- El cliente reduce fotografías a JPEG en canvas. El servidor valida
  Base64 canónico, JPEG SOI/EOI y máximo 250 KiB antes de subir.
  No acepta SVG, URLs de imagen de terceros ni subidas directas del navegador
  con credenciales del proveedor.
- PUT y DELETE se firman en el servidor con AWS Signature V4. Se prohíben
  redirecciones del proveedor y se usa HTTPS fuera de tests locales.
- Un enlace GET firmado dura **120 segundos**. El backend verifica empresa,
  ficha, propietario para borradores y visibilidad/moderación para el público
  ANTES de emitir el enlace. Nunca publica la clave secreta S3.
- El formulario guarda el producto antes de adjuntar la fotografía. Si
  falla la subida, conserva la publicación y permite reintentar sin fingir
  que la imagen se guardó. La actualización de la referencia se confirma
  solo después de PUT exitoso.
- El usuario puede quitar la foto, lo que quita primero la referencia del
  registro cifrado y después intenta borrar el objeto antiguo. Un error
  externo puede dejar un objeto huérfano, pero no una referencia a una imagen
  inexistente. Debe existir limpieza operativa antes de producción.

## Variables privadas del operador

```bash
WAE_ACCOUNTS_STORE=postgres
WAE_MARKET_MEDIA_STORE=s3
WAE_MEDIA_ENDPOINT=https://s3.example.invalid/
WAE_MEDIA_BUCKET=waeweb-private-images
WAE_MEDIA_REGION=us-east-1
WAE_MEDIA_ACCESS_KEY_ID=<secret-in-provider-manager>
WAE_MEDIA_SECRET_ACCESS_KEY=<secret-in-provider-manager>
```

Los valores `example.invalid` y los campos entre corchetes son **marcadores
de documentación, no configuración funcional**. El proveedor, bucket y claves
deben crearse y protegerse explícitamente fuera de GitHub. Nada se conecta
solo, y no se asegura que cualquier proveedor ofrezca plan gratuito.

Para producción deben existir cuenta PostgreSQL cifrada y CA TLS, bucket
PRIVADO (denegar acceso anónimo y `ListBucket` público), IAM de privilegio
mínimo para el prefijo `marketplace/`, versionado/protección de objetos,
retención y recuperación. Se requiere comprobar que el endpoint admite S3
SigV4 y rutas path-style, y desactivar redirecciones. No guardar claves en
`.env.example`, repo ni respuestas públicas.

## Contrato de API

- `POST /api/businesses/:businessId/listings/:listingId/image`:
  sesión del propietario, JSON `{imageDataUrl: "data:image/jpeg;base64,..."}`.
- `GET /api/businesses/:businessId/listings/:listingId/image`:
  sesión del propietario, devuelve enlace GET firmado por 120 segundos.
- `DELETE /api/businesses/:businessId/listings/:listingId/image`:
  sesión del propietario, quita imagen.
- `GET /api/marketplace/images/:businessId/:listingId`:
  solo empresa y ficha públicas no bloqueadas; redirige al enlace temporal,
  con `no-store` y `no-referrer`.

Los enlaces firmados YA emitidos siguen siendo utilizables hasta 120 segundos
aunque una publicación se oculte. No tratar este mecanismo como revocación
instantánea de contenido confidencial.

## Evidencia y límites

- Unitarias: formato/tamaño, SigV4, ausencia de secreto en URLs, permisos de
  propietario, carga fallida, privacidad y eliminación.
- CI: PostgreSQL 16 aislado + servicio local de prueba S3 (no un proveedor
  externo). [Evidencia de integración PASS](https://github.com/aleexwae4-lab/Waeweb/actions/runs/35731684911).
- Las fotografías anteriores Base64 **no se migran automáticamente**.
  Hacer migración por lotes con respaldo, verificación de objetos y rollback
  antes de retirar soporte inline.
- El backup PostgreSQL RC11 guarda solo claves/referencias de objetos en
  RC15: NO copia las fotografías. Recuperación integral implica backup,
  versionado y restore del bucket y reconciliación de referencias.
- El borrado de una empresa/listing sin usar la ruta dedicada puede dejar
  objetos huérfanos; hace falta inventario y limpieza verificable.
- No se implementan procesamiento antivirus externo, detector de contenido
  prohibido, moderación automática ni entrega de artículos vendidos.
- No-Go: proveedor real y pruebas E2E; backups de objetos, políticas de
  privacidad y retención, costos/cuotas, antiabuso, Stripe y Vercel.

`release-readiness.json` permanece `HOLD`; una prueba sintética exitosa
no certifica continuidad, disponibilidad ni seguridad productiva.
