# WAEWEB — vista previa aislada para Vercel

**Estado:** código candidato a preview en `feat/wae-web-search-core`. Este documento **no demuestra que exista un deployment ni un dominio operativo**. `release-readiness.json` permanece HOLD para producción.

## Qué se puede probar

La portada, interfaz, buscador, búsqueda federada y clima siguen accesibles. El navegador integrado en la web usa iframes sandboxed y algunos sitios pueden impedirse mediante `X-Frame-Options` o CSP: el botón de abrir externamente es el plan alternativo; una web pública no puede convertirse en un navegador de escritorio completo.

El Marketplace muestra un catálogo de preview vacío, sin registros sintéticos presentados como empresas reales. Cuentas, login, negocio, consultas privadas, Connect, carga de fotos, publicaciones y Stripe están expresamente bloqueados antes de cualquier handler privado o de escritura. Aparece un aviso inequívoco «VISTA PREVIA».

## Aislamiento de la publicación

Publicar **solo** un Preview Deployment conectado a esta rama. No asignar el dominio de producción, no promover la vista previa a `Production` y no fusionar `main`. `VERCEL_ENV=preview` activa automáticamente la barrera; `WAE_PREVIEW_MODE=true` permite reproducirla en pruebas locales. La vista previa no requiere ni debe heredar secretos/credenciales de producción, tokens de Connect, claves Stripe, claves de cifrado ni conexiones PostgreSQL/S3.

Comprobar en el deployment real antes de compartir su URL:
- `GET /api/health` devuelve `previewMode:true` y versión esperada.
- `GET /api/capabilities` indica cuentas, pagos, Connect y lector privado desactivados.
- `GET /`, CSS/JS, búsqueda `/api/search` y navegación funcionan.
- `POST /api/account/register`, `POST /api/promotions/webhook`, `POST /api/read` y `GET /api/connect/...` responden 503 sin efectos.
- `GET /api/marketplace` devuelve catálogo vacío y `previewMode:true`.
- Verificar logs, rutas serverless, CSP, accesibilidad móvil y enlace de abrir sitios que rechazan iframe.

Si los endpoints privados funcionaran o `previewMode` fuera false, no compartir ese deployment y no considerarlo una preview segura. El estado HOLD sigue aplicando a pagos, cuentas, información real y lanzamiento público.

## Bloqueo observado en esta sesión

La cuenta Vercel conectada listó otros dos proyectos de WAE OS, **no WAEWEB**, y la acción de despliegue de su conexión informó «Tool deploy_to_vercel not found». No existe una URL de preview verificable de WAEWEB obtenida en esta sesión. No utilizar otro proyecto como sustituto.
