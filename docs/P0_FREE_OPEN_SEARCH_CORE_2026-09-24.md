# WAEWEB — Informe P0 Free/Open Search Core
Fecha: 2026-09-24

## Regla de implementación
No se añadieron APIs de pago ni claves comerciales nuevas. La ruta P0 usa software/servicios abiertos o keyless y mantiene proveedores comerciales existentes como opcionales, no requeridos.

## Implementado en esta entrega
1. **Mapas sin dependencia de pago**: el buscador de localidades de Open-Meteo fue sustituido en el flujo principal por OpenStreetMap/Nominatim para direcciones, lugares y POI nominales. Caché compartida entre `/api/maps` y `/api/places`, single-flight, limitador de peticiones del proceso, timeout, deduplicación, validación y atribución.
2. **Geocodificación sin clave ORS**: `/api/places` deja de requerir `WAE_ROUTING_API_KEY` para encontrar direcciones/POI. `WAE_NOMINATIM_URL` permite migrar a una instancia propia sin cambiar el contrato del frontend.
3. **Query Core P0**: normalización Unicode, limpieza de caracteres de control, correcciones conservadoras de marcas/errores frecuentes, clasificación de intención (navigation, information, local, shopping, news, images, videos, research).
4. **Ranking P0**: se conserva la relevancia existente y se agregan señales de confianza de dominio, frescura y penalización básica de spam. Continúan diversidad de dominio, filtros site:/after:/before:/exclusiones/frases y priorización de sitios nombrados.
5. **SearXNG**: el repositorio ya tiene adaptador JSON para web e imágenes mediante `WAE_SEARXNG_URL`. No se inventó una instancia pública ni se añadió una API de pago. Para producción debe apuntar a una instancia propia/administrada por WAE.
6. **Overpass POI**: endpoint keyless `/api/poi` para OXXO, bancos, cajeros, cines, restaurantes, gasolineras, farmacias, supermercados, cafeterías, hospitales y hoteles; categoría enumerada, radio máximo 10 km, coordenadas verificadas, caché, límite por cliente, respuesta con distancias, contacto y horarios solo cuando OSM los aporta. Selector y radio integrados en el mapa, activados exclusivamente por interacción del usuario. Configuración opcional `WAE_OVERPASS_URL`.
7. **Pruebas**: fixtures de Nominatim y suite Overpass añadidos; su ejecución final debe confirmarse en GitHub Actions.

## Estado real frente al plan solicitado
| Área | Estado | Nota |
|---|---|---|
| Índice web general | PARCIAL | Adaptador SearXNG ya existe; falta infraestructura propia activa y health/SLA del deployment. |
| Motor de consultas | AVANZADO P0 | Normalización, operadores, corrección conservadora e intención implementados. Falta autocomplete persistente y diccionario estadístico grande. |
| Ranking | AVANZADO P0 | Relevancia léxica + señales de dominio/frescura/spam/diversidad. BM25 de corpus propio y reranker por embeddings requieren índice WAE persistente. |
| Mapas / POI | AVANZADO P0 | Nominatim keyless y Overpass por categoría/radio están conectados. Faltan búsquedas locales automáticas contextualizadas por ciudad, cartografía MapLibre y capacidad operativa propia. |
| Rutas | EXISTENTE / CONDICIONAL | Mantener el motor actual; migrar a OSRM propio/público compatible antes de retirar proveedores con clave. |
| Traductor | PARCIAL | MyMemory público + LibreTranslate configurable ya existen. Falta fallback automático bidireccional, caché y chunking. |
| Imágenes | AVANZADO | Openverse, Wikimedia, Flickr y SearXNG ya están en el backend; Pinterest debe seguir sin scraping/hotlinking no autorizado. |
| Videos | AVANZADO | PeerTube, Wikimedia, Internet Archive y descubrimiento por plataformas ya existen; APIs con cuota/pago no son requisito. |
| Noticias | AVANZADO | GDELT y feeds están presentes; falta clustering de eventos más fuerte. |
| Investigación | AVANZADO | Crossref, OpenAlex, DataCite, Europe PMC y LOC presentes. Falta canonicalización DOI transversal completa y exportadores. |
| Biblioteca | AVANZADO | Open Library, Google Books opcional, Gutenberg, LOC e Internet Archive presentes. |
| Seguridad lector | EN PROGRESO | Mantener SSRF/DNS/redirect guards como gate obligatorio. |
| SEO/PWA | PARCIAL | robots existe; completar canonical dinámico, JSON-LD, sitemap, manifest, service worker y OpenSearch. |

## P0 siguiente — sin APIs de pago
- Desplegar SearXNG propio y configurar `WAE_SEARXNG_URL`; añadir health score, timeout por engine y circuit breaker.
- Operar Overpass propio y limitar globalmente peticiones entre múltiples instancias. El endpoint comunitario no tiene SLA para producción.
- Evitar consultar ambas rutas de Nominatim desde el frontend cuando una sola resuelva el caso; hoy se deduplican en el backend de cada instancia.
- Integrar OSRM como proveedor de rutas libre, preferentemente instancia WAE.
- Crear `WAE Index`: crawler permitido por robots, canonicalización, extracción, dedupe SimHash, BM25 y almacenamiento persistente.
- Añadir reranking semántico local/open-source únicamente cuando exista infraestructura de embeddings sin API de pago.
- Crear autocomplete desde historial anónimo opt-in + entidades WAE + diccionario de consultas, sin enviar pulsaciones a terceros.
- Traductor: LibreTranslate propio como primario y MyMemory como fallback limitado; circuit breaker independiente y caché solo para texto no sensible.

## Gate de producción
No presentar Nominatim público, tiles públicos, Overpass público o una instancia pública de SearXNG como infraestructura ilimitada. El throttle de Nominatim es por proceso, NO distribuido entre workers/serverless. Para volumen real: instancia propia, caché, límites, observabilidad y cumplimiento de políticas de cada proyecto.

## Observabilidad y publicación
- Este informe describe cambios de rama/PR, NO afirma despliegue ni disponibilidad de upstream en producción.
- QA de PR y pruebas de integración requieren estado PASS verificable; bloqueo de Vercel por cuota de builds no prueba fallo del código.
- No se activa pago automático ni se instala proveedor comercial. 
