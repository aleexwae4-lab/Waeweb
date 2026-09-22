# WAE WEB

WAE WEB es el buscador federado de WAE OS Enterprise. Servidor web Node.js con cliente PostgreSQL opcional en ejecución y edición opcional de escritorio con Electron como dependencia de desarrollo. Interfaz obsidiana/aurora basada en el prototipo visual aportado por el fundador.

**Desarrollo únicamente.** El despliegue existente de Vercel no se utiliza, modifica ni conecta en esta etapa. No hay scripts de despliegue ni hooks de Vercel. Rama de trabajo: feat/wae-web-search-core.

## Fase 17 — RC8: no más datos efímeros en servicios alojados

Una política centralizada en `server/hosting.mjs` impide que los registros
de cuentas, perfiles de empresas y bóvedas de investigación dependan de
archivos locales cuando WAEWEB corre en Render, Vercel, producción, Lambda
o Cloud Run. Sin PostgreSQL cifrado configurado, esas funciones responden
desactivadas/503 y no crean archivos. La API de capacidades deja de
anunciar persistencia local cuando Reader no está activo.

El comando **solo lectura** `npm run storage:preflight` revisa que
las tablas PostgreSQL existan, los sobres cifrados sean autenticables con
claves configuradas y las tablas compartidas de Connect respondan sin
consumir cuotas. Su salida no incluye datos ni credenciales y advierte
`releaseApproval:"not_evaluated"`, incluso con PASS.
[Manual RC8](docs/RC8_HOSTED_STORAGE.md) ·
[Prueba PostgreSQL 16 + preflight PASS](https://github.com/aleexwae4-lab/Waeweb/actions/runs/35720429537).

**NO-GO sigue vigente:** la prueba fue sobre PostgreSQL desechable de CI;
faltan restauración, migración, verificación real de los tres Render,
identidad/pagos y certificación de Green privado. No se configuró ningún
servicio productivo, no se usó Vercel y no se fusionó el PR.

## Fase 16 — RC7: resultados fiables y fuentes atribuidas

Connect v1 distingue respuestas `complete` (incluye cero coincidencias verificadas
con un proveedor accesible), `partial` (mantiene las fuentes existentes e informa
fallos/no configuración), y `unavailable` (HTTP 503 / SSE `error` más
`done:false` cuando ningún proveedor está utilizable). No se presentan caídas
de proveedores como resultados vacíos exitosos.

El saneamiento conserva nombres reales y caracteres Unicode, limita longitud de
fragmentos, valida URLs web y retiene los panoramas extractivos asociados a
citas. Una caída transitoria tampoco se almacena como cero resultados en la
caché. Pruebas nuevas: `tests/search-availability.test.mjs`, casos de
`tests/connect.test.mjs` y contrato real WAEWEB + Universal Core
`tests/connect-consumers.integration.mjs`.

**Todavía no LIVE:** resultados de fuentes sintéticas de QA, sin secretos
productivos, Render o Vercel; Green privado no cuenta con CI ejecutada.
El manifiesto continúa `HOLD` / `NO-GO`.

## Fase 15 — RC6: contrato entre repositorios y SSE robusto

**Prueba entre repositorios, sin tocar servicios reales:** el workflow
`.github/workflows/cross-connect.yml` obtiene las ramas públicas WAEWEB y
`Inteligenciauniversal`, ejecuta el manejador HTTP WAEWEB real con proveedores
de prueba y llama mediante el cliente Universal Core real con **dos identidades
separadas**. Comprueba autenticación cruzada, `/status`, búsqueda con fuentes,
SSE `ready/results/done` y que ningún token aparece en el texto transmitido.
Evidencia: [GitHub Actions PASS](https://github.com/aleexwae4-lab/Waeweb/actions/runs/35714662862).

El consumidor Universal Core mantiene vivo su timeout después de las cabeceras,
limita el cuerpo SSE a 128 KiB, aborta la solicitud al desconectarse el cliente
y marca una respuesta sin `done` como incompleta. Su QA específico:
[PASS](https://github.com/aleexwae4-lab/Inteligenciauniversal/actions/runs/35714792211).
El consumidor WAE OS Green incorpora relay acotado, cancelación y eventos de
error; su repositorio **privado NO ha logrado ejecutar QA en Actions** porque
sus jobs fallan sin runner (`runner_id=0`, sin pasos ejecutados). Por tanto
no se declara compilado, probado en CI ni conectado a Render.

**Separación de evidencias:** la prueba entre repositorios utiliza fuentes
simuladas, no consulta páginas externas ni demuestra conexiones LIVE con
`inteligenciauniversal.onrender.com`, la edición `vt3h` o `waeosgreen`.
El release gate de Vercel y los tres PR de integración siguen bloqueados.

## Fase 14 — WAEWEB Connect v1.0.0-rc.5: seguridad del gateway

**Control distribuido comprobado:** `server/connect-postgres.mjs` asigna un
presupuesto global de 20 solicitudes/minuto y 3 operaciones concurrentes
por identidad de cliente usando PostgreSQL 16, bloqueos de fila y leases
de 45 segundos. A diferencia de un Map local, distintas instancias no
reciben presupuestos nuevos. `WAE_CONNECT_ADMISSION_MODE=postgres` es
obligatorio para producción, Render o Vercel: si PostgreSQL/TLS/esquema
no están disponibles, el conector queda desactivado o responde 503,
sin degradarse a presupuestos locales.

El esquema `wae_connect_quota` + `wae_connect_lease` se crea SOLO con
`npm run connect:pg:init` y autorización del operador, después de configurar
`WAE_ACCOUNTS_DATABASE_URL`, `WAE_ACCOUNTS_PG_CA` y
`WAE_CONNECT_ADMISSION_MODE=postgres`. No se han conectado cuentas ni
bases de producción. La prueba real abarca procesos Node independientes:
[PostgreSQL CI PASS](https://github.com/aleexwae4-lab/Waeweb/actions/runs/35712745534).

En `Inteligenciauniversal`, el proxy opcional también requiere una
segunda clave entrante en `WAEWEB_CONNECT_INBOUND_TOKEN` además del
token de WAEWEB. Así un navegador anónimo no puede utilizar la clave de
servicio. Las credenciales no se suben a GitHub ni se exponen en JS
público. La protección individual por usuario y las pruebas completas
entre los tres servicios de Render aún son pendientes. **Vercel sigue HOLD.**

## Fase 13 — WAEWEB Connect v1 (v1.0.0-rc.4)

API **servidor-a-servidor** para integrar la búsqueda WAEWEB en dos despliegues Universal Core y WAE OS Green, con tres credenciales independientes. Endpoints autenticados `/api/connect/v1/status`, `/search`, `/stream` (SSE: `ready → results/error → done`) y `/retrieve` (Reader seguro, opt-in). El parámetro `fresh:true` evita la caché interna de resultados, pero no convierte WAEWEB en un crawler de Internet ni en un Chromium remoto.

- [Contrato, configuración y límites](docs/WAEWEB_CONNECT_V1.md)
- [Contrato OpenAPI](docs/openapi-connect-v1.yaml)
- QA: `tests/connect.test.mjs`, `npm test` y `npm run check`.

Todos los conectores están **apagados por defecto**; no hay secretos reales en GitHub y ninguno de los tres Render está conectado a esta rama. Antes de producción hacen falta backend WAEWEB desplegado bajo HTTPS, credenciales de servidor configuradas por destino, prueba en los tres entornos, protección antiabuso distribuida y **aprobación del manifiesto de lanzamiento**. Vercel se mantiene en HOLD.




## Fase 12 — WAEWEB v1.0.0-rc.3: backend compartido y bóvedas duraderas

**Desarrollo exclusivamente en GitHub; no se ha conectado Vercel.** El backend API de Node ahora tiene un punto de entrada independiente en `api/[...path].js` que delega en el mismo `handler` utilizado localmente, sin llamar a `listen()`. Las pruebas HTTP del adaptador comprueban `/api/health`, capacidades, rutas desconocidas, métodos y rechazo del almacenamiento efímero. **Aún NO hay prueba de build/ruteo/despliegue en Vercel real**: el adaptador es código de integración, no prueba de que un deployment ya funcione.

**Bóvedas PostgreSQL opcionales y aisladas:** `WAE_VAULT_STORE=postgres` utiliza la conexión PostgreSQL/CA verificada de `WAE_ACCOUNTS_DATABASE_URL` y `WAE_ACCOUNTS_PG_CA`, pero guarda las bóvedas en `wae_vault_records`, separadas de la tabla de cuentas. Cada bóveda conserva cifrado AES-256-GCM con clave independiente, hash de identificador y hasta 80 documentos. `pg_advisory_xact_lock` y transacciones protegen incluso la creación y escritura concurrente de una bóveda inexistente desde **distintos procesos**; una consulta entre bóvedas sigue prohibida por autenticación y claves propias.

**CI real:** https://github.com/aleexwae4-lab/Waeweb/actions/runs/35709282150 probó PostgreSQL 16, cuentas, bóvedas cifradas, aislamiento de inquilinos, inserciones simultáneas desde ocho procesos independientes y fallo cerrado ante una clave incorrecta. Los tests no equivalen a una auditoría externa ni validan todavía un proveedor productivo.

**Activación controlada, no automática:** `WAE_VAULT_STORE=postgres`, las variables PostgreSQL verificadas, claves distintas por bóveda en `WAE_VAULT_KEYS_JSON` y tokens por bóveda en `WAE_VAULTS_JSON` son requisitos. Ejecutar `npm run vault:pg:init` solo para una base nueva y tras respaldo, con `WAE_READER_ENABLED=false` hasta terminar. **No se importan los archivos previos.** No activar PostgreSQL vacío para un espacio que ya contenga documentos sin migración verificable y ensayo de recuperación. `WAE_VAULT_STORE=file` continúa para el entorno local sin Vercel.

**Fail-closed de serverless:** con `VERCEL=1`, el almacenamiento local de cuentas y de bóvedas queda desactivado; el lector solo puede habilitarse con PostgreSQL cifrado válido, tokens/llaves completos y `WAE_READER_ENABLED=true`. Una tabla sin inicializar produce error, no una bóveda pública falsa ni creación automática de datos. No almacenar variables de cifrado, tokens o base en `public/`.

**HOLD de despliegue:** sigue faltando verificar el build/ruteo reales de Vercel, migración y recuperación de datos, tasa distribuida de registro/login/búsqueda, identidad, pagos E2E, UX móvil, privacidad y operación. `npm run release:gate` sigue devolviendo NO-GO. El navegador Chromium completo continúa limitado a Electron; desplegar la API web no lo instala en el navegador del visitante.

## Fase 11 — WAEWEB v1.0.0-rc.2: cuentas empresariales cifradas en PostgreSQL

**Cambio real, no simulación:** agregamos `WAE_ACCOUNTS_STORE=postgres` como opción. El código de cuentas, sesiones, fichas de negocios y estados de promoción utiliza el **mismo registro cifrado AES-256-GCM** existente. En lugar de un archivo local, guarda ese registro en una fila PostgreSQL con `SELECT ... FOR UPDATE` y transacción `BEGIN/COMMIT/ROLLBACK`. Esto serializa mutaciones incluso entre procesos distintos sobre la **misma base duradera**; no se trata de sincronizar archivos ni hacer una réplica efímera. `WAE_ACCOUNTS_STORE=file` permanece como modo local para una sola instancia y carpeta privada duradera.

**Prueba con PostgreSQL auténtico:** CI inició PostgreSQL 16 y verificó registro, login, lectura y revocación de sesión, publicación de negocio, datos cifrados sin correo en claro, escrituras concurrentes en **procesos Node independientes** y fallo cerrado ante clave de cifrado incorrecta: https://github.com/aleexwae4-lab/Waeweb/actions/runs/35707323895 . Los tests unitarios independientes verifican configuración TLS y rechazo de URL malformada. No representa una auditoría externa ni asegura disponibilidad en un proveedor cloud no configurado.

**Activación manual y segura (NO ejecutar todavía en Vercel):**
1. Proveer una base PostgreSQL privada con backups y control de acceso a través de un proveedor que permita conexiones TCP, así como URL privada de conexión en `WAE_ACCOUNTS_DATABASE_URL`. Instalar dependencias con `npm install` o `npm ci` cuando exista un lockfile auditado. Nunca colocar URL, credenciales o clave en `public/`, GitHub ni en links de usuario.
2. Definir `WAE_ACCOUNTS_STORE=postgres`, un `WAE_ACCOUNTS_KEY` único de 64 caracteres hexadecimales y `WAE_ACCOUNTS_PG_CA` como base64 del certificado CA PEM de la base (TLS con verificación obligatoria). Mantener `WAE_ACCOUNTS_ENABLED=false` hasta inicializar y verificar el almacenamiento.
3. Ejecutar explícitamente `npm run accounts:pg:init` **una sola vez por base nueva, con aprobación del operador y respaldo previo**. La aplicación normal nunca crea/migra automáticamente el esquema. Comprobar el procedimiento de backup/restauración de PostgreSQL y después habilitar cuentas solo en el backend deseado.
4. Una base existente con `accounts.encrypted.json` **NO se importa automáticamente**. No activar un nuevo almacenamiento vacío sobre cuentas reales antes de un procedimiento de migración/ensayo que conserve todas las sesiones, fichas y pagos. La fase no incluye ese migrador.

**Por defecto, sin riesgo de pérdida en Vercel:** si `VERCEL=1` y el almacenamiento sigue en `file`, el registro de cuentas se desactiva aun con su clave presente. El lector de bóvedas documentales también se desactiva en funciones Vercel porque hoy depende de archivos locales; **PostgreSQL para cuentas no migra las bóvedas**. Si PostgreSQL está mal configurado, falla cerrado y no vuelve al almacenamiento local. Ninguna credencial de PostgreSQL se expone en la respuesta de capacidades.

**Límites actuales:** el modelo es intencionalmente una fila cifrada, con límite de **500 usuarios, 20 negocios por usuario y 6 sesiones activas por usuario**; no se afirma una base universal a escala Google. Quedan pendientes migración/recuperación de datos reales, almacenamiento de bóvedas, política de correo/identidad, abuso, operativa de pagos, E2E web/móvil, privacidad y adaptador de runtime web verificado. El manifiesto de lanzamiento sigue en **HOLD / NO-GO para Vercel**.

## Fase 10 — WAEWEB v1.0.0-rc.1: Chromium real + compuerta de lanzamiento

- **Linux nativo ejecutado en GitHub Actions**, no solo pruebas de sintaxis: https://github.com/aleexwae4-lab/Waeweb/actions/runs/35706038901. Se descargó Electron, se configuró el sandbox SUID sin `--no-sandbox` y arrancó Chromium con Xvfb. El smoke verificó preload, interfaz, API local y apertura/cierre de pestañas. **No** verificó navegación externa, Windows/macOS ni instaladores.
- **Defensa del servidor local**: la edición Electron valida Host exacto, Origin y Fetch Metadata contra el origen de `127.0.0.1`; rechaza mutaciones que carecen del Origin de la interfaz. El servidor web público conserva su ruta de ejecución independiente.
- **Control de lanzamiento a Vercel**: `npm run release:gate` evalúa `release-readiness.json` y termina con código distinto de cero si hay bloqueos, falta evidencia o el paquete aún es release candidate. La versión actual devuelve **NO-GO**, deliberadamente. NO debe conectarse Vercel hasta aprobar cada control con pruebas verificables y un plan de backend persistente; `main` no se ha fusionado.
- El proceso HTTP de `server/index.mjs` es un servidor Node de larga duración, mientras que las cuentas, negocios y bóvedas usan archivos privados persistentes. No equivale automáticamente a un backend listo para funciones serverless de Vercel. Separar frontend desplegable del backend duradero, o construir/verificar un adaptador compatible, es obligatorio antes de promover.
- Las cuentas y publicidad no están listas para lanzamiento público hasta resolver verificación de correo, recuperación, antifraude, reconciliación, privacidad, QA E2E móvil y operación/rollback.

## Estado actual — Fase 9 (v0.9): WAEWEB Native Chromium Desktop Engine

**Objetivo implementado en la rama:** edición local opcional para Windows, macOS y Linux usando **Electron 44.3.0 / Chromium**. Conserva el mismo WAEWEB web y sus módulos; no depende del despliegue existente de Vercel. El proceso principal abre el backend Node de WAEWEB *solo en 127.0.0.1 y puerto aleatorio*; la interfaz se sirve en una ventana Electron y las páginas externas se muestran en `WebContentsView` independientes en vez de iframes. Nada cambia en producción y no se ha publicado un instalador.

### Arranque local para desarrolladores

1. Instalar Node.js compatible (recomendado Node 22 o superior) y las dependencias opcionales del entorno de escritorio en el propio equipo: `npm install` (Electron es una dependencia de desarrollo; su descarga inicial puede consumir datos/almacenamiento y no se realiza en CI).
2. Ejecutar `npm run desktop`. Abre «◎ Navegar», introduce un sitio público HTTPS y utiliza las pestañas. `npm start` **sigue iniciando únicamente el servidor web existente**.
3. Antes de desarrollar para clientes: configurar claves/almacenamiento solo cuando corresponda, ejecutar `npm run check && npm test`, realizar pruebas visuales y funcionales reales en los sistemas operativos objetivo, firmar y empaquetar los binarios. Este PR no incluye ejecutables ni exige tokens/productos de pago.

**Motor real y aislamiento:** hasta ocho `WebContentsView` con su propia URL, título, historial real `navigationHistory`, progreso y fallos de carga. Al cambiar pestañas no se vuelve a cargar la web: se intercambia la vista nativa activa. Se aceptan páginas públicas HTTPS que no se pueden incrustar en un iframe, sujetas a sus propias políticas de autenticación y seguridad. El contenido web externo está en una sesión efímera y separada de la interfaz local, sin preload ni Node.js; sandbox, context isolation y web security permanecen activos. Todos los permisos de dispositivos y descargas están denegados en esta fase. Los popups HTTPS se convierten en pestañas dentro del límite; se deniegan otras aperturas. No se omiten CAPTCHA, autenticación, controles antiautomatización ni políticas de los sitios.

**Canal IPC:** solo el frame principal de la ventana local exacta puede solicitar navegación, selección, historial, geometría de la vista y salida explícita al navegador del sistema. Los comandos y URLs vuelven a validarse en el proceso principal. No se expone `ipcRenderer` ni acceso a archivos, consola del sistema, claves o bóvedas a sitios de terceros. El navegador del sistema solo se abre con URL HTTPS validada desde la interfaz local. La vista nativa ajusta su geometría al área real visible de la aplicación. Los contenidos se cierran expresamente al cerrar cada pestaña/ventana para limitar fugas de memoria.

**Diferencia con v0.8 web:** dentro del navegador web normal WAEWEB sigue usando su `iframe` de compatibilidad y mostrando «Abrir fuera»; el motor Chromium verdadero se activa **solo** al arrancar la edición Electron local. En escritorio, los enlaces/clics y redirecciones HTTPS de la página remota pasan al historial del motor. No se prometen equivalencia total con Google Chrome, extensiones Chrome, DRM, todas las páginas ni compatibilidad de cada inicio de sesión. No existe una plataforma remota de Chromium para usuarios de Vercel/Render.

**QA disponible:** las pruebas automatizadas cubren URLs, prohibición de protocolos/destinos locales, límites de viewport, origen/frame del IPC y controles de aislamiento; `node --check` también valida los archivos de escritorio. GitHub Actions no instala ni inicia Electron, así que una ejecución PASS **no es** una validación visual ni de navegación real del ejecutable. Quedan pendientes E2E nativos y paquetes instalables firmados.

## Estado actual — Fase 8 (v0.8): WAEWEB Browser Core

**Navegación interna sin usar Vercel.** La barra «◎ Navegar» y los títulos de resultados abren un área integrada con direcciones HTTPS, hasta ocho pestañas por sesión, atrás/adelante, recarga, salida al buscador y apertura explícita del sitio original. La pestaña conserva su iframe mientras se alterna entre pestañas; el historial de URLs introducidas por WAEWEB tiene un límite de 30 entradas. La interfaz muestra siempre el aviso de que la navegación interna es condicional.

**Seguridad de diseño:** el navegador incrustado utiliza iframe con `sandbox="allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox"` y *sin* `allow-same-origin`, `referrerpolicy="no-referrer"` y política de contenido `frame-src https:`. Solo admite URLs HTTPS sin credenciales en la barra integrada y no es un proxy de sitios, no reescribe HTML externo ni elimina cabeceras X-Frame-Options/CSP. El contenido remoto no obtiene acceso al DOM, tokens o bóvedas de WAEWEB; el usuario debe evitar credenciales de terceros en sitios no confiables. Los sitios con autenticación por cookies y JavaScript dependiente de origen pueden no funcionar en el iframe.

**Funcionamiento real y límites:** no es Chromium, Chrome, Electron ni Tauri; un servidor web no puede imponer que todos los sitios sean incrustables. Las páginas que restringen `frame-ancestors` o `X-Frame-Options`, HTTP no seguro, páginas privadas, PDF y aplicaciones que requieren origen propio pueden no abrirse en el contenedor. El navegador principal bloquea de forma deliberada observar el contenido y URL internos del iframe de otro origen: atrás/adelante y dirección corresponden a navegaciones iniciadas desde la barra de WAEWEB, no a clics dentro del sitio remoto. No se promete detectar bloqueos de incrustación: `load` de iframe no demuestra que el sitio se renderizó. «↗ Abrir fuera» permite visitar la página en una pestaña ordinaria del navegador. «⌕ Leer con WAE» usa el lector protegido existente solamente con lector y bóveda configurados, sin habilitar un proxy ni lectura silenciosa. No se guardan URLs en cuentas ni en bóvedas por la navegación (la lectura es una acción distinta). No se crean credenciales ni se conecta el despliegue.

**QA:** `npm run check && npm test`; pruebas de parsing HTTPS, control de esquemas/credenciales, aislamiento, límites de ocho pestañas y treinta entradas, recursos servidos por allowlist y CSP. Estas pruebas no equivalen a un E2E visual ni demuestran carga real de sitios externos. Para llegar a navegación con compatibilidad de navegador completo se requeriría un runtime nativo/controlado (p. ej., WebView2, WKWebView, Electron/Tauri) y pruebas de seguridad específicas.

## Estado actual — Fase 7 (v0.7): perfiles empresariales compartibles

La Fase 7 agrega un ciclo completo para la ficha comercial de WAE WEB: **registrar → editar → publicar voluntariamente → compartir perfil → ocultar o eliminar**. No se ha habilitado ningún registro de usuario ni despliegue de producción; el servidor continúa requiriendo las variables privadas de cuentas de la Fase 6.

**Panel del propietario:** «Mi cuenta / Negocios» permite modificar nombre comercial, sector, ciudad, descripción y sitio HTTPS. Los cambios se guardan en el registro cifrado de cuentas y **no alteran la visibilidad** de la ficha. Publicar y ocultar siguen siendo acciones independientes. El panel ofrece «Ver perfil público» y «Copiar enlace» solo para fichas publicadas; las privadas no reciben enlaces públicos funcionales.

**Perfiles compartibles:** las fichas publicadas pueden abrirse en `/?business=UUID` y desde la pestaña «Negocios». La página se recupera a través de la API exacta GET `/api/businesses/public/:id`, muestra categoría, ciudad, descripción y sitio web declarado y avisa de forma visible que **WAE WEB no verifica la empresa ni la titularidad**. No incluye correo, identificador de propietario, contraseña, tokens, sesiones ni documentos de investigación. Si el titular oculta o elimina el negocio, el enlace pasa a devolver HTTP 404; una visita posterior al perfil no muestra sus datos.

**Nuevas rutas:**
- PATCH `/api/businesses/:id/profile` con Authorization: Bearer TOKEN y JSON `{ "name": "...", "category": "...", "city": "...", "description": "...", "website": "https://..." }`. Solo el titular puede editar. No admite publicación implícita.
- GET `/api/businesses/public/:id`, anónimo para una ficha voluntariamente publicada. No expone datos privados; responde 404 cuando está oculta, eliminada o no existe.
- PATCH `/api/businesses/:id` con `{ "published": true|false }` continúa siendo el único control de visibilidad del propietario.

**Límites:** sigue siendo un directorio **autodeclarado**, no una verificación mercantil, fiscal o de propiedad del sitio. El perfil no es una página indexada en Google por definición, ni está conectado a Maps, SEO de producción, dominio propio, pagos o publicidad. Las pruebas automatizadas comprueban API, confidencialidad, autorización y entrega del archivo estático; no sustituyen una prueba visual E2E en navegador. No desplegar públicamente antes de añadir verificaciones, privacidad y mecanismos de reclamación de negocios.

## Estado actual — Fase 6 (v0.6): WAE WEB Business + Vault Maintenance

**Experiencia de cuenta y negocios:** la página de inicio muestra un acceso a «Mi cuenta / Negocios», además del acceso en la navegación. Los usuarios pueden crear una cuenta con nombre, correo y contraseña, iniciar/cerrar sesión y gestionar **hasta 20 fichas de negocio privadas por cuenta** (nombre comercial, sector, ciudad, descripción y sitio web HTTPS opcional). Las fichas son **autodeclaradas**; registrar una empresa NO supone verificar su identidad, documentación, dirección o situación legal. Por defecto son privadas. Cada titular puede publicar u ocultar su ficha expresamente: solo esas fichas aparecen en la pestaña «Negocios» de búsqueda pública, siempre identificadas como **no verificadas**. No hay edición colaborativa.

**Activación real — desactivada por defecto:** el proceso Node debe tener WAE_ACCOUNTS_ENABLED=true, WAE_ACCOUNTS_KEY con **una clave hexadecimal aleatoria propia de 64 caracteres**, y WAE_ACCOUNTS_DIR apuntando a un directorio privado y persistente. Nunca reutilices la clave de investigación, una contraseña de usuario o un ejemplo de prueba. Sin ambas variables de activación y clave, la interfaz informa que el registro está desactivado; no simula usuarios o empresas. La clave perdida impide abrir el archivo cifrado y no existe recuperación de cuenta automatizada.

**API de cuentas:**

- POST /api/account/register: { "name": "...", "email": "...", "password": "..." }. Requiere una contraseña entre 12 y 128 caracteres. Devuelve usuario público y token opaco para esa sesión.
- POST /api/account/login: { "email": "...", "password": "..." }. Compara un verificador scrypt salado; no guarda contraseñas en claro.
- GET /api/account/me: requiere Authorization: Bearer TOKEN.
- POST /api/account/logout: revoca esa sesión en el servidor.
- GET /api/businesses: únicamente las fichas de la cuenta autorizada.
- POST /api/businesses: { "name": "...", "category": "...", "city": "...", "description": "...", "website": "https://..." }.
- DELETE /api/businesses/:id: elimina únicamente la ficha perteneciente al usuario autorizado.
- PATCH /api/businesses/:id: { "published": true | false }. Solo el titular autorizado controla su visibilidad.
- GET /api/businesses/public?q=consulta: búsqueda pública de hasta 25 fichas publicadas voluntariamente. Respuestas sin correo del usuario ni identificador del propietario; se muestra estado autodeclarado y no verificado.

**Separación de credenciales:** las sesiones de cuenta y las credenciales de la bóveda de investigación son **distintas**. Una cuenta recién creada no da acceso a las bóvedas preexistentes; esto evita conceder acceso privado a otra empresa por asociación implícita. El token de sesión se mantiene solo en memoria de la pestaña; al recargar se requiere iniciar sesión de nuevo. Las sesiones guardadas en el servidor son hashes SHA-256 de tokens aleatorios de 256 bits, con expiración de 7 días; las contraseñas usan scrypt con sal aleatoria y el archivo de usuarios, sesiones y negocios está cifrado con AES-256-GCM y una clave de cuentas independiente.

**Límites expresos:** se restringe la creación de cuentas e intentos de acceso por IP con estado local del proceso; no sustituye un WAF ni un control distribuido. La base de cuentas es un archivo atómico de **un solo proceso**, limitada a 500 usuarios y 20 negocios por usuario: no es una solución multi-réplica. No hay confirmación de email, recuperación de contraseña, MFA, revisión documental, reclamo de negocios existentes, OAuth ni administración de roles. El directorio público básico es voluntario y no verifica la identidad comercial. Nunca habilitar públicamente sin TLS, protección antiabuso durable, política de privacidad y tratamiento legal de datos, copias de seguridad de cuentas, observabilidad y pruebas E2E. No se han configurado registros reales, claves productivas ni despliegues.

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


## RC17 — presencia de fotografías / continuidad de recuperación

La auditoría del operador `npm run marketplace:media:probe` comprueba por HEAD firmado las fotografías S3 referenciadas por las cuentas cifradas, sin imprimir claves ni modificar objetos. Resultados paginados, manifiesto SHA-256 y detección de cambios concurrentes; una presencia confirmada NO verifica bytes, backups ni restore conjunto. [Alcance y límites](docs/RC17_MEDIA_PRESENCE.md). **Vercel HOLD / PR borrador**.


## RC18 — integridad criptográfica de fotografías

Además de comprobar presencia, `npm run marketplace:media:integrity` recupera cada JPEG privado en lotes acotados y compara sus bytes reales con `imageSha256` + `imageBytes` almacenados dentro del registro cifrado. Detecta alteración del contenido, formato/MIME inválido, ausencia, permisos, metadatos legados y cambios concurrentes sin exponer imagen, object key, hash o URL firmada en el reporte. Requiere autorización operativa fuera de CI. [Alcance y límites](docs/RC18_MEDIA_INTEGRITY.md). **No certifica backup/restore; Vercel continúa HOLD.**
