# WAEWEB P0 — implementación sin APIs de pago

Fecha: 2026-09-24. No modificar Vercel ni declarar cambios LIVE sin comprobar despliegue. Fuentes comunitarias sujetas a sus límites.

## Hallazgos verificados en main (1.0.0-rc.35)
- `server/search.mjs` ya integra SearXNG opcional; configurar el servidor y probar formato JSON sigue pendiente. No equivale a un índice operando.
- `server/intelligence.mjs` puntúa por coincidencias de palabras, sin BM25 ni reranking por embeddings.
- `server/maps.mjs` usa Open-Meteo para localidades, no negocios; `server/geocode.mjs` depende de clave openrouteservice cuando se habilita.
- `server/translate.mjs` dispone de MyMemory o LibreTranslate, no de conmutación real entre ambos.
- `server/index.mjs` conecta `/api/maps` con `findPlaces`, por lo que no puede dar comercios locales usando solo Open-Meteo.

## Condiciones de entrega
P0: fuente web general realmente activa; consultas reales, no enlaces fabricados; POI con posición, origen y radio; errores por proveedor sin bloquear resultados independientes; cero cargos obligatorios; QA automatizada; autorización previa a lanzamiento productivo.

No confundir rama, pruebas ni adaptadores con despliegue productivo.
