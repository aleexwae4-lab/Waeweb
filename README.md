# WAE WEB

WAE WEB es el buscador federado de WAE OS Enterprise. Aplicación Node.js independiente, sin dependencias externas de npm, con interfaz obsidiana/aurora inspirada en el prototipo visual aportado por el fundador.

**Desarrollo únicamente.** El despliegue existente de Vercel no se utiliza, modifica ni conecta en esta etapa. No hay scripts de despliegue ni hooks de Vercel. Rama de trabajo: feat/wae-web-search-core.

## Inicio local

Se requiere Node.js 20 o superior. Ejecuta npm run check, npm test y npm start. Abre http://localhost:3000. El servidor escucha en PORT o 3000.

## Funcionalidad implementada

| Capacidad | Implementación |
| --- | --- |
| Búsqueda general | Wikipedia + Crossref + OpenAlex + Open Library; Google Programmable Search opcional |
| Investigación | Artículos de Crossref y OpenAlex con URL y atribución |
| Libros | Obras bibliográficas Open Library con metadatos y portadas reales cuando existen |
| Imágenes | Wikimedia Commons; Google opcional |
| Noticias / videos | Resultados de Google Programmable Search solo al configurar API |
| Clima | Geocodificación y datos actuales de Open-Meteo por lugar consultado |
| Mapas | Enlace explícito a OpenStreetMap; aún no cartografía nativa |
| Vista rápida | Fragmento textual atribuido a fuente; no síntesis generativa de IA |
| Voz | Reconocimiento y lectura mediante API nativas si están disponibles |
| UX | Interfaz adaptable, carga/errores/estados vacíos, enlaces compartibles e historial |

Los resultados informan el número efectivamente recibido, sin estimaciones ficticias de páginas indexadas. Fallos de proveedores y ausencia de credenciales aparecen como tales.

## Google Programmable Search (opcional)

Revisa .env.example para conocer variables. Este proyecto no carga archivos .env automáticamente: exporta las variables en el proceso Node o inyéctalas en el entorno que ejecute el servidor. No añadas claves al frontend ni hagas commit de .env.

- GOOGLE_SEARCH_API_KEY: clave Custom Search JSON API.
- GOOGLE_SEARCH_ENGINE_ID: identificador cx del motor, configurado para la cobertura que requiera el producto.

Google puede aplicar cuotas, cobros, límites regionales o restricciones de cobertura. WAE WEB no promete acceso ilimitado al índice de Google.

## API

- GET /api/health: verificación del proceso.
- GET /api/capabilities: proveedores y estado de Google sin exponer credenciales.
- GET /api/search?q=consulta&type=all|research|books|images|news|videos: resultados con fuente, URL y errores parciales.
- GET /api/weather?place=Guadalajara: observaciones y pronóstico desde Open-Meteo.

Plazo máximo por fuente, validación de consulta, allowlist de ficheros públicos, cabeceras de seguridad, limitación básica por IP y renderizado con textContent para evitar HTML remoto en el DOM. Antes de lanzamiento público se necesita revisar protección de datos, políticas de proveedores, monitoreo, caché persistente, pruebas de carga y seguridad adicionales.

## Calidad

npm run check valida sintaxis; npm test ejecuta pruebas con fuentes simuladas únicamente dentro de tests. GitHub Actions ejecuta ambos comandos. No despliega ni configura Vercel.

## Límites declarados

Todavía no es un navegador de pestañas y URL con motor de renderizado propio; es una aplicación de búsqueda web federada. Indexación web general, crawling respetuoso, ranking autónomo, RAG sobre páginas, verificación cruzada, navegación interna y orquestador de IA requieren etapas posteriores y proveedores adecuados.

## WAE Research Core — Fase 2

Operadores de búsqueda, aplicados **sobre los resultados recuperados**:

- site:example.org — dominio exacto o subdominios. Con Google configurado también se transmite la restricción site:.
- after:2025-01-01 y before:2026-01-01 — solo resultados con fecha informada; fecha inicial incluida, final excluida. También admite años completos.
- source:wikipedia, source:crossref, source:openalex, source:openlibrary, source:google, source:wikimedia — proveedor declarado.
- -publicidad — exclusión de un término en título o extracto.
- "frase exacta" — exige frase en título o extracto.

Ejemplo: energía solar site:example.edu after:2024 -publicidad. Los dominios incompletos no son compatibles con el filtro local: utiliza un dominio completo.

El ordenamiento pondera coincidencias con títulos y extractos. No es PageRank ni un índice global de Internet. La caché diferencia consultas con filtros. OpenAlex aporta extractos reconstruidos de la información de resúmenes cuando está disponible.

**Panorama documental:** recopila hasta cuatro extractos atribuidos con URLs y diversidad básica de dominios. No es IA generativa ni corroboración independiente. No atribuye afirmaciones nuevas a las fuentes.

**Biblioteca WAE:** almacenamiento local en el navegador, hasta 100 fuentes, exportación Markdown. Sin cuenta, subida al servidor o sincronización de dispositivos. Si el navegador bloquea la persistencia, usa memoria temporal y muestra una advertencia. En equipos compartidos no guardes información sensible.

Pruebas adicionales: parser, fechas inválidas, filtros por dominio, caché aislada, ranking, extractos con atribución y biblioteca con y sin persistencia local.

### Próximas etapas

- Mayor cobertura de web general sujeta a proveedores, derechos de uso y cuotas.
- Evaluación medible de relevancia, diversidad y frescura.
- Lector protegido contra SSRF, crawling respetando robots e índice propio incremental.
- IA opcional con citas verificables y degradación sin invención de datos.
- QA visual, accesibilidad, seguridad y carga antes del despliegue.

**Vercel permanece desconectado.**
