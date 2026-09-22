# RC34 — Recuperación del despliegue Git de WAEWEB

## Diagnóstico confirmado por el usuario
- La producción `waeweb.vercel.app` provenía de Vercel Drop, mientras Git `main` sólo contenía README y la aplicación completa permanecía en `feat/wae-web-search-core`.
- El usuario comprobó en producción que `/api/health` y `/api/capabilities` devolvían `404 NOT_FOUND` de Vercel, no JSON ni el header `x-waeweb-api: 1`.
- En Deployment Protection el usuario mostró Standard Protection, que no autoriza interpretar el 404 como necesidad de desproteger la app. No desconectar Git ni publicar desde Vercel Drop para la corrección.
- El conector Vercel accesible al asistente no mostró el proyecto WAEWEB, así que no se pueden inspeccionar/modificar los parámetros del proyecto o el resultado final desde ese conector.

## Reparación controlada
1. El código completo incluye `public/`, `api/`, `server/`, `package.json` y `vercel.json` en el **mismo commit Git**. La interfaz estática y las funciones API se despliegan conjuntamente al activar el flujo Git de `main`.
2. `GET /api/health` publica versión, modo aislado y revisión de git (cuando el hosting la entrega); el diagnóstico frontend sigue en `/diagnostico.html`.
3. Mientras `release-readiness.json` esté HOLD, `VERCEL_ENV=production` también se ejecuta en modo público aislado: sólo búsqueda, clima, mapas, información, traductor y rutas públicas, sin cuentas, datos privados, cobros ni conectores. Una variable `WAE_PUBLIC_FULL_RELEASE=GO` NO puede omitir el manifiesto HOLD.
4. `.github/workflows/live-public-smoke.yml` consulta **el dominio real** después de push a `main`: espera la versión esperada, verifica marca API propia y solicita endpoints y scripts esenciales. Si persiste el 404/401, la automatización **falla** y exige intervención en Git → deployments / función / dominio de Vercel.
5. Ningún test local ni la palabra Ready certifican que `waeweb.vercel.app` reciba la versión; únicamente un GET real con JSON de WAEWEB lo demuestra.

## Verificaciones de llegada
- `https://waeweb.vercel.app/api/health` debe mostrar `version: 1.0.0-rc.34`, `previewMode:true`, `publicMode:isolated` y encabezado `x-waeweb-api: 1`.
- `/api/capabilities`, `/api/maps?q=20.6767,-103.3475`, `/api/translate/capabilities` deben devolver JSON propio.
- `/native-map.js` y `/translator.js` deben existir en el **mismo dominio**.
- Después, prueba manual en Android: búsqueda, imágenes, video, navegador, traductor y geografía; el navegador web embebido no puede forzar páginas que prohíban iframe; el visor geográfico propio no incluye calles/satélite ni se inventarán traducciones.
- ORS sigue apagado hasta clave autorizada; motor local de traducción depende del navegador; MyMemory gratuito tiene cuota y requiere salida de red.

## Si la automatización falla
- Revisa la producción de Vercel: que se haya creado un deployment originado en Git `main` del commit RC34, Root Directory vacío/raíz del repo, Framework Other y Output Directory `public`.
- Si no se disparó, revisa los eventos de integración Git; si salió `READY` pero `/api/health` da 404, revisar `api/health.js`, Build Logs y Functions, rutas y asignación del dominio.
- No desactives Standard Protection a ciegas; no pegues secretos en GitHub, capturas ni chat.
- Antes del siguiente cambio destructivo conservar SHA del commit anterior de `main`; Vercel Drop previo puede estar disponible como rollback en Deployments, pero no se afirma sin inspección del proyecto.

**El manifiesto del lanzamiento completo permanece HOLD.** La promoción Git sólo habilita una prueba pública aislada.