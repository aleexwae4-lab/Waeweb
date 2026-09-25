# WAEWEB RC55 — núcleo gratuito de búsqueda y mapas

**Fecha:** 25 de septiembre de 2026  
**Objetivo:** corregir los bloqueadores públicos observados en RC35 sin añadir
APIs de pago ni abrir cuentas, cobros, bóvedas o conectores privados.

## Resultado ejecutivo

RC55 convierte el código candidato en una base pública más honesta y útil:

- entiende y clasifica consultas de forma local;
- calcula y convierte unidades sin consultar terceros;
- mejora el ranking lexical y la diversidad de dominios;
- busca localidades, direcciones y comercios con OpenStreetMap;
- deja de intentar incrustar sitios que el navegador no puede mostrar;
- incorpora redundancia limitada en traducción;
- reduce la contaminación técnica de la interfaz;
- prepara PWA, OpenSearch y metadatos, sin habilitar todavía indexación SEO;
- mantiene el producto comercial en `HOLD` y las mutaciones privadas cerradas.

RC55 no convierte por sí solo a WAEWEB en un índice global. El índice general
depende todavía de que el operador proporcione una instancia propia de SearXNG
o, posteriormente, del índice WAE México.

## Entregado

### 1. Motor de consultas local

- Normalización Unicode NFKC, espacios, acentos y mayúsculas.
- Detección prudente de español, inglés o idioma indeterminado.
- Clasificación de intención: navegación, información, compra, local, noticia,
  imagen, video, investigación y cálculo.
- Corrección ortográfica acotada para términos conocidos; no reescribe
  operadores avanzados.
- Alias y sinónimos deterministas para expansión interna.
- Cálculos aritméticos con parser propio, sin `eval`.
- Conversiones locales de longitud, masa y temperatura.
- Respuesta instantánea para cálculos, sin bloquearse por proveedores.

### 2. Ranking y calidad

- Señal lexical BM25 calculada sobre la colección recuperada.
- Coincidencia exacta de título y prioridad para URLs oficiales declaradas.
- Señales prudentes de autoridad, localidad y spam.
- Diversificación por host y deduplicación existente conservadas.
- La interfaz recibe intención, idioma, aliases, respuesta directa y sugerencia
  «Quizá quisiste decir…».

No se implementó un reranker por embeddings: requeriría un modelo local
versionado, evaluación offline y presupuesto de memoria/CPU. RC55 no simula
semántica que no puede demostrar.

### 3. Mapas y negocios locales

- Nominatim para búsqueda manual de nombres, direcciones y localidades.
- Índice POI nativo WAEWEB, importado de extractos OSM con licencia ODbL,
  como primera opción para comercios cercanos.
- Overpass como respaldo acotado cuando el índice nativo no cubre el punto y
  el usuario aporta coordenadas.
- Sesgo configurable a México mediante `WAE_MAP_COUNTRY_CODES=mx`.
- Caché en memoria, tiempo máximo, resultados acotados y peticiones Nominatim
  serializadas con más de un segundo de separación.
- `User-Agent` identificable y atribución OpenStreetMap.
- Teléfono, web, horario, categoría y distancia sólo cuando el proveedor los
  entrega; no se inventan fichas.
- El estado, cobertura y fecha del índice nativo se publican sin fingir una
  cobertura nacional cuando no se instaló un extracto.

La instancia pública de Nominatim exige como máximo una petición por segundo,
identificación de la aplicación y atribución. Para volumen comercial debe
usarse infraestructura propia o compatible con su política:
https://operations.osmfoundation.org/policies/nominatim/

Overpass permite consultar objetos OpenStreetMap y dispone de instancias
públicas, pero éstas son compartidas y no constituyen un SLA de producción:
https://wiki.openstreetmap.org/wiki/Overpass_API

### 4. Navegación y lector

- En Render, cada sitio HTTPS se abre en su origen como acción principal.
- Se retiró la creación de `iframe` para navegación externa alojada.
- El lector seguro es una acción separada, limitada a resultados descubiertos,
  robots, DNS público y redirecciones del mismo sitio.
- La edición Electron conserva Chromium aislado para navegación integrada
  real.

### 5. Traductor

- Modo `auto` por defecto.
- Primera opción: LibreTranslate controlado por el operador.
- Respaldo: MyMemory gratuito y limitado para textos cortos.
- Circuit breaker independiente por proveedor, `Retry-After`, límites de bytes,
  cancelación y tiempo máximo.
- El texto permanece en el editor cuando todos los motores fallan.
- La interfaz ya no afirma «servicio conectado» antes de traducir.

LibreTranslate es software libre autohospedable; su servicio comercial no se
habilita en RC55: https://github.com/LibreTranslate/LibreTranslate

### 6. Interfaz, PWA y diagnóstico

- Fuentes opcionales «no configuradas» desaparecen del panel principal.
- Los fallos técnicos detallados permanecen disponibles para telemetría del
  servidor.
- Panel de transparencia compacto y colapsable.
- Manifest, OpenSearch, sitemap, canonical, Open Graph y JSON-LD.
- Service worker limitado al shell de primera parte; excluye `/api/`,
  búsquedas, cuentas y medios externos.
- `noindex,nofollow` y `robots.txt` siguen activos mientras el release
  comercial esté en `HOLD`.

## Proveedores y costo de API

| Capacidad | Integración RC55 | Pago agregado |
|---|---|---:|
| Índice federado | Cliente SearXNG, sólo con URL del operador | No |
| Geocodificación | Nominatim con límites y caché | No |
| Comercios/POI | Índice OSM nativo + Overpass acotado como respaldo | No |
| Cartografía | OpenStreetMap con atribución | No |
| Traducción primaria | LibreTranslate autohospedado opcional | No |
| Traducción de respaldo | MyMemory gratuito y limitado | No |
| Cálculos y unidades | Motor local WAEWEB | No |
| Rutas | No activadas; pendiente OSRM propio | No |

SearXNG documenta una API HTTP con salida JSON y puede autohospedarse:
https://docs.searxng.org/dev/search_api.html

OSRM es libre, usa datos OpenStreetMap y queda recomendado para la siguiente
fase de rutas propias: https://project-osrm.org/

Las variables opcionales preexistentes de Brave, Google, YouTube y ORS no se
activan ni se requieren para RC55.

## Evidencia de calidad

- `npm run check`: PASS, incluido `public/sw.js`.
- `npm test`: **508/508 PASS**.
- Pruebas nuevas para query intelligence, cálculo, sugerencias, BM25, mapas
  Nominatim/índice POI nativo/Overpass, traducción con fallback, navegación origin-first,
  recursos PWA y diagnóstico limpio.
- Smoke HTTP local: salud RC55, cálculo `12*8 = 96`, coordenadas, manifest,
  OpenSearch y service worker respondieron correctamente.

## Bloqueadores que permanecen

1. Instancia SearXNG propia y observada; no se eligió una instancia pública
   arbitraria.
2. Índice WAE México con crawler legal, canonicalización, robots y eliminación.
3. OSRM propio, autocompletado propio/Photon y teselas con capacidad comercial.
4. Modelo de reranking semántico local evaluado contra un conjunto de relevancia.
5. Redundancia real de traducción: requiere URL LibreTranslate del operador.
6. Pruebas de carga, Web Vitals de campo, monitoreo y alertas.
7. Correo, recuperación de cuenta, privacidad, moderación, antifraude y
   recuperación real antes de habilitar cuentas/Marketplace.
8. Revisión legal de fuentes, retención, retiro de contenido y promociones.

## Orden de promoción a Render

1. Ejecutar `npm run check`, `npm test` y `git diff --check`.
2. Confirmar que `release-readiness.json` continúa en `HOLD`.
3. Commit y push de RC55 a `main`; Render tiene auto-deploy por commit.
4. Esperar estado `live` y confirmar `/api/health` con versión RC55.
5. Ejecutar smoke público de Web, `Oxxo` en Mapas, cálculo, Traductor,
   Imágenes, Videos, Noticias, lector, Marketplace y cuentas desactivadas.
6. Revisar logs y métricas; revertir el commit si aparece una regresión P0.

RC55 puede promoverse como **preview público aislado**. No autoriza un
lanzamiento comercial completo ni la apertura de datos privados.
