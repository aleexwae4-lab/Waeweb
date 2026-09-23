# WAE WEB — Biblioteca Universal 2.0

## Implementación
La categoría Biblioteca WAE consulta en paralelo cinco catálogos públicos con adaptadores de metadatos server-side: Open Library (obras), Google Books (volúmenes, búsqueda para MX), Library of Congress (/books/ de material digitalizado, no catálogo completo), Project Gutenberg por Gutendex (API comunitaria de metadatos) e Internet Archive (índice de textos digitalizados). Ningún resultado se inventa si no hay respuesta verificable.

Se preservan las URLs originales, títulos, autorías y fechas cuando existan; se restringen identificadores y orígenes de portada. WAE proporciona fichas nativas, filtros por biblioteca, contador de registros y diagnóstico de proveedores que no respondieron. Una falla parcial no bloquea los catálogos exitosos. **La UI propia NO implica propiedad sobre contenido o autoría**: cada ficha presenta la procedencia de sus metadatos y un enlace al catálogo de origen.

## Acceso y derechos
Google Books: PARTIAL se presenta como vista parcial en origen; ALL_PAGES no equivale a una autorización de redistribución. Gutenberg: copyright=false solo describe el estado informado en su jurisdicción de referencia, no derecho automático de uso en México. Internet Archive: índice de textos ≠ acceso libre, compra, préstamo o descarga. La Biblioteca no descarga, guarda ni redistribuye libros de terceros. El estudio editorial propio (/libros.html) continúa separado y su módulo de ventas sigue deshabilitado.

## Límites operativos
- Metadatos externos se consultan solo por interacción de usuario; caché de consulta existente de 5 minutos en proceso, sin garantía de persistencia distribuida.
- Timeout por proveedor de 6.2 segundos y límite de 2 MB por respuesta.
- La API de Open Library tiene límites de uso y recomienda volcados para alto tráfico; Gutendex sugiere autohospedaje para uso prolongado. Esta iteración de búsqueda en vivo no sustituye la infraestructura de indexación masiva, caché distribuida o acuerdos/licencias necesarios antes de escalar.
- GOOGLE_BOOKS_API_KEY es opcional y exclusivamente del servidor; independiente de Programmable Search.
- No hay modificación de Vercel/Render ni despliegue productivo. Se conserva la rama feat/wae-native-book-library y PR #3.

## Pruebas
tests/book-federation.test.mjs: búsqueda federada, caída parcial, fuente individual, IDs hostiles, procedencia, fechas, portada y disponibilidad honesta.
tests/book-experience.test.mjs: UI nativa, modal y atribución por proveedor.
tests/search-availability.test.mjs: escenario aislado con source:openlibrary.
