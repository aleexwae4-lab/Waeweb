# WAE WEB

WAE WEB es el buscador federado de WAE OS Enterprise. Aplicación Node.js independiente, sin dependencias externas de npm, con interfaz obsidiana/aurora inspirada en el prototipo visual aportado por el fundador.

**Desarrollo únicamente.** El despliegue existente de Vercel no se utiliza, modifica ni conecta en esta etapa. No hay scripts de despliegue ni hooks de Vercel. Rama de trabajo: feat/wae-web-search-core.



## Estado actual — Fase 6 (v0.6): WAE WEB Business + Vault Maintenance

**Experiencia de cuenta y negocios:** la página de inicio muestra un acceso a «Mi cuenta / Negocios», además del acceso en la navegación. Los usuarios pueden crear una cuenta con nombre, correo y contraseña, iniciar/cerrar sesión y gestionar **hasta 20 fichas de negocio privadas por cuenta** (nombre comercial, sector, ciudad, descripción y sitio web HTTPS opcional). Las fichas son **autodeclaradas**; registrar una empresa NO supone verificar su identidad, documentación, dirección o situación legal. No hay directorio público ni edición colaborativa en esta fase.

**Activación real — desactivada por defecto:** el proceso Node debe tener WAE_ACCOUNTS_ENABLED=true, WAE_ACCOUNTS_KEY con **una clave hexadecimal aleatoria propia de 64 caracteres**, y WAE_ACCOUNTS_DIR apuntando a un directorio privado y persistente. Nunca reutilices la clave de investigación, una contraseña de usuario o un ejemplo de prueba. Sin ambas variables de activación y clave, la interfaz informa que el registro está desactivado; no simula usuarios o empresas. La clave perdida impide abrir el archivo cifrado y no existe recuperación de cuenta automatizada.

**API de cuentas:**

- POST /api/account/register: { "name": "...", "email": "...", "password": "..." }. Requiere una contraseña entre 12 y 128 caracteres. Devuelve usuario público y token opaco para esa sesión.
- POST /api/account/login: { "email": "...", "password": "..." }. Compara un verificador scrypt salado; no guarda contraseñas en claro.
- GET /api/account/me: requiere Authorization: Bearer TOKEN.
- POST /api/account/logout: revoca esa sesión en el servidor.
- GET /api/businesses: únicamente las fichas de la cuenta autorizada.
- POST /api/businesses: { "name": "...", "category": "...", "city": "...", "description": "...", "website": "https://..." }.
- DELETE /api/businesses/:id: elimina únicamente la ficha perteneciente al usuario autorizado.

**Separación de credenciales:** las sesiones de cuenta y las credenciales de la bóveda de investigación son **distintas**. Una cuenta recién creada no da acceso a las bóvedas preexistentes; esto evita conceder acceso privado a otra empresa por asociación implícita. El token de sesión se mantiene solo en memoria de la pestaña; al recargar se requiere iniciar sesión de nuevo. Las sesiones guardadas en el servidor son hashes SHA-256 de tokens aleatorios de 256 bits, con expiración de 7 días; las contraseñas usan scrypt con sal aleatoria y el archivo de usuarios, sesiones y negocios está cifrado con AES-256-GCM y una clave de cuentas independiente.

**Límites expresos:** se restringe la creación de cuentas e intentos de acceso por IP con estado local del proceso; no sustituye un WAF ni un control distribuido. La base de cuentas es un archivo atómico de **un solo proceso**, limitada a 500 usuarios y 20 negocios por usuario: no es una solución multi-réplica. No hay confirmación de email, recuperación de contraseña, MFA, directorio público, revisión documental, reclamo de negocios existentes, OAuth ni administración de roles. Nunca habilitar públicamente sin TLS, protección antiabuso durable, política de privacidad y tratamiento legal de datos, copias de seguridad de cuentas, observabilidad y pruebas E2E. No se han configurado registros reales, claves productivas ni despliegues.

**Mantenimiento premium de bóvedas (offline; detener el servidor antes de comenzar):**

- Rotación de clave: genera una nueva clave hexadecimal de 32 bytes fuera de GitHub y expórtala solo en WAE_VAULT_NEW_KEY para el CLI. Ejecuta `npm run vault:rotate -- org_alpha --confirm-offline-rotation`. Se crea y verifica un respaldo CIFRADO con la clave anterior antes de sustituir el archivo activo por uno cifrado con la nueva clave. Conserva la clave anterior en un almacén seguro para poder recuperar ese respaldo. Configura después WAE_VAULT_KEYS_JSON con la clave nueva para abrir el índice.
- Migración legacy v1 sin cifrar: guarda primero una copia de seguridad PRIVADA externa del archivo antiguo (nunca en el repositorio), detén el proceso y ejecuta `npm run vault:migrate -- org_alpha --confirm-offline-migration`. Comprueba la huella de cada documento, cifra el contenido y reemplaza el archivo mediante cambio de nombre atómico. No hay migración automática ni endpoint público para estas operaciones.
- La rotación no cambia las claves de las cuentas; son sistemas de almacenamiento separados. Ni la rotación ni la migración tienen un gestor KMS, un planificador automático o protección frente a múltiples procesos que escriban al mismo tiempo.

## Estado actual — Fase 5 (v0.5): WAE Encrypted Research Vault

La versión actual combina búsqueda web federada, lector de páginas públicas bajo demanda y memoria de investigación **cifrada en reposo** por bóveda. La lectura/indexación no está habilitada sin configuración explícita. Los apartados v0.3 y v0.4 más abajo son un historial de desarrollo; esta sección describe el comportamiento vigente.

**Seguridad de datos:** cada bóveda utiliza una clave simétrica AES-256-GCM independiente de su token de acceso. Se genera un IV aleatorio de 12 bytes en cada escritura; se valida una etiqueta de autenticación de 16 bytes y se vincula criptográficamente el ID de bóveda como dato adicional autenticado. El archivo de disco contiene únicamente el sobre cifrado, sin texto de artículos ni credenciales. El índice en memoria durante una petición, la biblioteca opcional de localStorage del navegador y las respuestas de API no están cifrados extremo a extremo.

**Configurar en entorno de desarrollo aislado (fuera de GitHub):**

- WAE_READER_ENABLED=true activa el lector bajo demanda.
- WAE_VAULTS_JSON asocia IDs de bóveda con tokens independientes de acceso de 32 a 256 caracteres ASCII imprimibles.
- WAE_VAULT_KEYS_JSON asocia exactamente los mismos IDs con una clave hexadecimal de 64 caracteres (32 bytes) por bóveda; no repetir claves ni usar los tokens como claves. Ambas variables son necesarias; sin una de ellas el lector y el índice responden 503.
- Genera cada token y cada clave por separado con un generador criptográfico. Con Node.js local, una clave se genera con node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))". No copies el resultado en Git, tickets o logs.
- WAE_VAULT_DIR y WAE_BACKUP_DIR apuntan a dos directorios privados, persistentes y separados, fuera de public/. Por defecto: .wae-private-vaults y .wae-private-backups. No uses un sistema de archivos efímero si necesitas conservar información.
- Este proyecto no carga automáticamente archivos .env. Configura las variables por el mecanismo seguro del proceso anfitrión.

**Respaldos operados fuera de línea con el mismo mapa de claves:**

1. npm run vault:backup -- org_alpha — crea una copia CIFRADA, devuelve el nombre y suma SHA-256, nunca el texto de los documentos.
2. npm run vault:verify -- org_alpha NOMBRE_DEL_ARCHIVO — verifica suma, etiqueta AES-GCM y estructura del índice con la clave correspondiente.
3. Detén el servidor; restaura **solo en destino vacío** con npm run vault:restore -- org_alpha NOMBRE_DEL_ARCHIVO --confirm-empty-target. Nunca reemplaza una bóveda existente. Si necesitas un ensayo de recuperación, utiliza otro directorio privado y aislado.
4. Almacena copias adicionales fuera del servidor de forma segura, con política de retención y comprobaciones periódicas; el script NO programa respaldos ni envía copias a ningún servicio externo.

**Advertencias de recuperación:** perder una clave hace inaccesible la bóveda y sus respaldos. Cambiarla sin un procedimiento de rotación también impide la apertura. No hay rotación automatizada ni gestión centralizada de claves. Los archivos antiguos de Fase 4 (version: 1, sin cifrar) **no se migran automáticamente**: se rechazan con migration_required y quedan intactos; conserva de manera segura cualquier archivo antiguo hasta disponer de una migración offline probada. No subas datos antiguos a GitHub.

**Limitaciones de seguridad y producto:** el cifrado en reposo no reemplaza TLS, controles del sistema operativo, separación de procesos, auditoría, gestión de sesiones ni cifrado de la biblioteca del navegador. La persistencia por archivos no soporta escrituras simultáneas desde múltiples procesos o réplicas. El respaldo local no es una copia externa de recuperación ante desastres. La restauración se diseñó para un proceso DETENIDO. No exponer públicamente el lector sin revisión de seguridad, pruebas E2E, controles de egreso de red, aislamiento real de usuarios y respaldo/recuperación operativos. Esto todavía no es un índice global ni un navegador con motor de renderizado propio. Vercel no se utiliza ni se modifica.

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

Todavía no es un navegador con motor de renderizado propio: combina búsqueda federada e índice privado bajo demanda. Un crawler global, ranking a escala Internet, RAG generativo y navegación interna requieren etapas posteriores.

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

## WAE Web Reader — Fase 3 (v0.3, histórico: sustituido por la Fase 4)

Se añade un lector bajo demanda para páginas de texto/HTML y un índice propio TEMPORAL del proceso Node. No es un crawler de Internet ni un navegador Chromium. No hace rastreo en segundo plano.

Activación explícita para un entorno de desarrollo aislado:

1. Mantener WAE_READER_ENABLED=false en cualquier entorno expuesto hasta revisar controles de salida y términos de sitios.
2. Iniciar Node con WAE_READER_ENABLED=true solo en un entorno controlado con acceso de salida restringido. El archivo .env.example es documentación: el servidor no carga archivos .env automáticamente.
3. Abrir la aplicación local; el panel WAE Web Reader permite indicar una URL pública HTTPS o leer un resultado mediante "Leer e indexar".

API (no realizar pruebas contra redes internas):

- GET /api/read?url=https%3A%2F%2Fexample.org%2Farticle — recupera texto explícitamente solicitado y lo incorpora al índice, solo si WAE_READER_ENABLED=true.
- GET /api/index/search?q=término — busca solamente documentos recuperados durante la ejecución actual.
- GET /api/index/document?id=... — obtiene un documento temporal previamente indexado.
- GET /api/capabilities — incluye readerEnabled, indexSize e indexPersistence.

Controles: HTTPS/443 únicamente, sin credenciales ni IP literales, sin hosts internos/reservados, DNS IPv4 verificado y fijado en la conexión TLS, detección de respuestas con IP privada, timeout por solicitud, límite de 256 KiB por respuesta, HTML y texto únicamente, rechazo de redirecciones de páginas para no saltarse robots.txt, rechazo de documentos demasiado breves y cache temporal de robots.txt. Si no se puede comprobar robots.txt, el lector no continúa. El contenido externo se trata como texto, no como instrucciones ni JavaScript ejecutable.

LIMITACIONES: la extracción es textual y sencilla, no comprende páginas JavaScript, archivos PDF, anti-bot, atribución legal de contenido, licencias de reutilización ni validación semántica. Las políticas de robots.txt no sustituyen autorizaciones, derechos de autor o términos de acceso. El índice tiene capacidad acotada a 80 páginas y se pierde al reiniciar el proceso; no está aislado por usuario o empresa y por ello no debe contener información privada. Las APIs del índice son compartidas por cualquier usuario con acceso al servidor. No publicar sin autenticación, segregación multi-tenant, cuotas persistentes, revisión de seguridad, logging respetuoso de privacidad y pruebas E2E.

Las pruebas usan un transporte DNS simulado únicamente en CI para confirmar denegación de rangos privados, rechazo de redirecciones, cumplimiento de robots, extracción, límite de memoria y apagado por defecto. Las pruebas no prueban la Internet real. No se ha conectado Vercel.

## WAE Private Research Vault — Fase 4 (v0.4, histórico: sustituido por cifrado de v0.5)

El índice temporal global de la Fase 3 fue sustituido EN LA API por bóvedas separadas autenticadas y almacenadas en disco. El texto anterior describe un hito histórico y no el comportamiento actual de estas rutas. La búsqueda federada pública continúa siendo independiente.

Configuración (solo en un entorno aislado de desarrollo; este proyecto NO carga archivos .env por sí solo):
- WAE_READER_ENABLED=true habilita explícitamente el lector.
- WAE_VAULTS_JSON contiene un objeto JSON de IDs de bóveda con un token ASCII diferente y aleatorio por bóveda, de al menos 32 caracteres. Ejemplo de forma: {"equipo_demo":"TOKEN_ALEATORIO_DISTINTO_NO_PUBLICAR_EN_GITHUB"}. No reutilizar ese valor ilustrativo.
- WAE_VAULT_DIR indica la carpeta del disco local. El valor por defecto es .wae-private-vaults (ignorada por Git).
- El proceso necesita permisos de escritura sobre esa carpeta y un volumen que realmente persista. Un filesystem efímero elimina todos los documentos al reiniciar. Esta fase NO configura bases de datos remotas ni cifrado en reposo.
- No enviar bearer tokens por HTTP fuera de localhost. El entorno remoto requiere TLS, autenticación y protección de infraestructura adicionales.

API protegida (todas las rutas requieren Authorization: Bearer <token_privado>, además de las variables anteriores):
- POST /api/read con JSON {"url":"https://example.org/article"}. La URL se envía en el CUERPO, no en la query string; lector bajo demanda, con las restricciones HTTPS/DNS/robots de la Fase 3.
- GET /api/index/search?q=termino: devuelve únicamente registros de la bóveda autenticada.
- GET /api/index/document?id=<id>: devuelve únicamente el documento de la bóveda autenticada.
- GET /api/capabilities es público, pero ya no expone número de documentos ni IDs de bóvedas; solo capacidades globales.

La interfaz incluye "Conectar bóveda" y "Desconectar". El token no se incorpora a URL, HTML de GitHub, localStorage ni sessionStorage; permanece solo en memoria de la pestaña. Desconectar invalida la credencial local. Revocarla de verdad exige cambiar el token en la configuración del servidor. La biblioteca del navegador es una función local separada, sin sincronización, y un usuario podría elegir guardar en ella fragmentos de su bóveda.

Persistencia y aislamiento: cada bóveda se almacena en un archivo JSON cuyo nombre es el SHA-256 de su ID, con escrituras mediante archivo temporal y cambio atómico de nombre, permisos solicitados 0700 en carpeta creada y 0600 en archivo creado, comprobación de huella del texto, límite de 80 documentos y serialización de escrituras concurrentes por bóveda dentro de un proceso. Un archivo corrupto se rechaza en lugar de borrar o reparar automáticamente. No se guardan credenciales en los archivos. La persistencia NO equivale a respaldo ni a alta disponibilidad.

**Límites y bloqueos de producción:** no hay cifrado en reposo, login con usuarios/roles, SSO, auditoría forense formal, rotación automatizada, backup, aislamiento criptográfico de inquilinos ni control de acceso a nivel de sistema operativo entre archivos. El uso remoto de tokens exige TLS. Las pruebas automatizadas usan documentos y DNS ficticios de prueba, no conexiones reales a sitios ni pruebas E2E del navegador. No desplegar públicamente ni mezclar el PR hasta pasar una auditoría independiente y completar controles operacionales. Ninguna infraestructura Vercel se usa ni se modifica.
