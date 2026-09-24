# WAEWEB — Informe ejecutivo P0 a P3 (sin APIs de pago)

**Fecha:** 24/09/2026 · **Repositorio:** aleexwae4-lab/Waeweb · **Base auditada:** main, package 1.0.0-rc.35.  
**Alcance:** rama aislada `feat/p0-free-search-poi-20260924`; no se configura un despliegue ni se cambia Vercel. Los adaptadores existentes NO equivalen a proveedores disponibles LIVE.

## Entrega de esta rama
- `server/poi.mjs`: detección acotada de OXXO, bancos, cines, restaurantes, gasolineras, farmacias y supermercados; consultas Overpass limitadas a radio 6.5 km; fichas OSM reales y sin verificación de titularidad; caché de 10 minutos; límite conservador de 150 consultas/día y 3 segundos entre solicitudes **por proceso**.
- `server/maps.mjs`: búsquedas POI mediante el módulo anterior y conserva la búsqueda de localidades con Open-Meteo. Coordenadas siguen siendo compatibles. No se solicita permiso de geolocalización desde el cliente: «cerca de mí» aún requiere integrar consentimiento y envío explícito de ubicación.
- `tests/poi.test.mjs`: prueba de detección, rechazo de coordenadas inválidas, no suposición de ubicación y procedencia de los datos con respuesta simulada. Una prueba con respuesta simulada **no demuestra disponibilidad real** de Overpass.
- No hay incorporación de credenciales de Google Search, Brave Search, openrouteservice ni otros productos de pago.

## Estado y decisiones
| Prioridad | Capacidad | Hallazgo | Criterio de aceptación |
|---|---|---|---|
| P0 | Índice general web | `server/web-providers.mjs` implementa SearXNG opcional; instancia/productivo no acreditados | Instancia controlada, HTTPS, JSON activo, 10 búsquedas representativas y URL canónica real; degradación explícita |
| P0 | Consultas | `parseQuery` implementa site:, fechas, exclusión, frases y source:; faltan corrección, intención avanzada y autocompletado | Falsos positivos medidos y sin reescritura silenciosa |
| P0 | Ranking | `scoreResult` opera por `includes`, bonificaciones por fuente; carece de BM25 real y embeddings | Corpus etiquetado MX, MRR@10, nDCG@10, diversidad y adversarial de spam |
| P0 | Mapas | Antes: Open-Meteo no devuelve negocios. Rama: Overpass comunitario limitado por nombre/categoría, solo México con localidad o coordenadas suministradas | OXXO Zapopan, bancos Guadalajara, cines CDMX y vacío/error honestos en pruebas reales |
| P0 | Traductor | MyMemory o LibreTranslate, con modo único sin verdadero respaldo automático | Probar idioma destino, cuota, circuit breaker, fallos y estado real |
| P0 | Navegación | Electron ya tiene Chromium nativo opcional; iframe web no puede garantizar navegación de cualquier sitio | Abrir sitio original como acción estable; sin prometer iframe universal |
| P1 | Multimedia y ciencia | Hay adaptadores abiertos y especializados; verificar licencias, cuota y exactitud | Fuentes reales, dedupe, fechas y derechos visibles |
| P1 | Cuentas/marketplace | Persistencia y controles parciales documentados en README | Recuperación, tenant isolation, moderación, privacidad y DR E2E |
| P2 | Rendimiento | `Promise.allSettled` espera al proveedor más lento en búsqueda completa | p75 de inicio desde caché <1 s; resultados principales 2–3 s en escenarios medidos |
| P2 | SEO/PWA y API | Requiere validación de metadata, manifest, SW y OpenSearch | Validación técnica y accesibilidad WCAG 2.2 |
| P3 | Answer Engine | Resumen extractivo en `researchBrief`, no síntesis contrastada por LLM | Respuesta citada, fuentes verificables, incertidumbre y seguridad |

## Exclusiones / condiciones de APIs
- **No configurar ni consumir** Google Programmable Search, Brave Search ni openrouteservice por defecto en esta intervención. El código heredado que los soporta no se eliminó para evitar regresiones.
- SearXNG es software abierto, pero una instancia propia requiere servidor y gastos de hosting según la infraestructura elegida. El API JSON exige `search.formats: [html, json]`. Las fuentes federadas están sujetas a políticas y bloqueos del buscador de origen.
- Overpass público es compartido: el límite por proceso no sustituye un rate limit distribuido, cola y caché común. No ofrecer tráfico masivo comercial sobre servidores comunitarios. El paso de producción es réplica/índice propio o proveedor sin cobro obligatorio, con capacidad verificada.
- Los tiles de OSM tienen política independiente. No cachear ni precargar el mundo y mantener atribución © colaboradores de OpenStreetMap.
- Nominatim público **no es autocomplete sin restricciones** y tiene limitación absoluta de 1 petición por segundo; no implementarlo como proxy ilimitado.
- Nunca convertir un resultado del proveedor en una ficha WAE «verificada» sin comprobación documental.

## Gate de liberación
1. `npm run check && npm test` PASS en commit exacto.
2. Pruebas de red **reales** para SearXNG y Overpass, sin asumir que los mocks validan disponibilidad.
3. Pruebas de seguridad SSRF, cuotas distribuidas y protección del historial/ubicación.
4. Prueba UX móvil con accesibilidad y fallos por proveedor.
5. Plan de rollback; aprobar release gate antes de tocar entorno productivo. Un PR abierto no es despliegue.
