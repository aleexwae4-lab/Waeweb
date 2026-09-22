# WAEWEB RC32 — Mapas y HTTP 401

## Hechos verificados
- PR #1 sigue en borrador, rama `feat/wae-web-search-core`. `main` todavía mantiene otro SHA.
- `/api/maps` es público en el backend; solo Índice WAE y cuentas tienen permisos propios. Un 401 sin `x-waeweb-api: 1` señala acceso o enrutamiento **antes** del backend.
- La conexión Vercel visible al asistente listó sólo proyectos ajenos a WAEWEB; las consultas de `waeweb.vercel.app` no pudieron completar una prueba HTTP independiente. No se atribuye el fallo a una opción específica de Vercel sin evidencia.

## Correcciones de código
- `public/maps-core.js` analiza coordenadas exactas y acotadas localmente. No consulta el backend ni transforma direcciones dudosas en centros de ciudad.
- `public/app.js` representa inmediatamente mapas por coordenadas sin depender del 401 de `/api/maps`.
- La pestaña Mapas sin búsqueda incluye una vista general **real** de México, expresamente etiquetada como referencia y sin insinuar que identifica al visitante. Si el iframe remoto no se puede incrustar, mantiene enlace a la cartografía original; no hay bypass de las restricciones del proveedor.
- `/diagnostico.html`: prueba manual de las cinco rutas públicas de WAEWEB, muestra marca `x-waeweb-api`, código HTTP, versión publicada y estado de módulos. Nunca solicita credenciales, tokens ni llamadas privadas.
- El error de Mapas enlaza directamente al diagnóstico, además del mapa original.

## Pendiente para resolver producción
1. Confirmar el proyecto y equipo correctos de `waeweb.vercel.app`, la rama de producción y commit desplegado. No equiparar éxito de GitHub Actions con despliegue.
2. Verificar `/api/health` y `/api/maps?q=20.6767,-103.3475`. Si faltan marcas WAEWEB o aparece 401 antes de Node, revisar Deployment Protection y funciones `api/*`. No desactivar protecciones indiscriminadamente en otros proyectos.
3. Comprobar carga real del iframe en Android y HTTPS. OSM puede impedir la incrustación; no hay garantía del tercero. Rutas precisas todavía requieren ORS opcional, cuota y clave servidor.
4. Completar gate de seguridad, confirmar explícitamente el despliegue correcto. Mantener `main` intacto y Vercel sin acciones directas mientras falta evidencia.

Release: **HOLD**.
