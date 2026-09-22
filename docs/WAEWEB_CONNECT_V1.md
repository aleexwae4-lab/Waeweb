# WAEWEB Connect API v1 — navegación web informada, no Chromium remoto

Estado: **código en rama de desarrollo**, desactivado por defecto. NO hay endpoint público activo,
credenciales emitidas, conexión de producción, merge a main ni despliegue en Vercel.

## Objetivo

Permitir a tres sistemas consumir búsquedas federadas actuales de WAEWEB mediante una API
servidor-a-servidor y eventos SSE. Destinos declarados por el fundador:

| Identificador de cliente | Destino previsto | Código consumidor |
| --- | --- | --- |
| `inteligenciauniversal` | `https://inteligenciauniversal.onrender.com/?wae_runtime=36` | conector opcional en `Inteligenciauniversal`; correspondencia exacta con este servicio todavía sin confirmar en Render |
| `universal-core-vt3h` | `https://wae-inteligencia-universal-vt3h.onrender.com/` | `Inteligenciauniversal`; workflow del repo contiene este origen |
| `waeosgreen` | `https://waeosgreen.onrender.com/` | `Chatwaeosgreen`; mantiene su navegador e índices propios |

Cada despliegue debe recibir un **token distinto**. Un solo token compartido facilita suplantación
entre productos. Los tokens solo viven en gestores de secretos del servidor, jamás en JavaScript
del usuario, URL, enlaces de prueba ni repositorios.

## API

Todas las rutas usan el prefijo `/api/connect/v1`, encabezados
`X-WAEWEB-Client: <id>` y `Authorization: Bearer <token_aleatorio>`.
**No existe CORS** y se rechaza `Origin` en las llamadas machine-to-machine.
`WAE_CONNECT_ENABLED=false` por defecto; las peticiones reciben 503.

| Método | Ruta | Función |
| --- | --- | --- |
| GET | /status | Contrato y capacidades para el cliente autenticado |
| POST | /search | Búsqueda JSON: `{"query":"energía solar","type":"all","fresh":true}` |
| POST | /stream | SSE con `ready`, `results` o `error`, y `done` |
| POST | /retrieve | Opt-in: `{"url":"https://example.org/articulo"}` extrae texto sin guardarlo |

El contrato de resultados `waeweb-connect/v1` incluye `query`, `results[]` con `title`,
`url`, `snippet`, `source`, `date`, `image`, `sources`, `failedSources`,
`fetchedAt`, `brief` si existe y `freshness`. **`fresh:true` evita la caché
de WAEWEB para esa consulta**, sin poder garantizar el frescor de cada fuente externa.
No significa que la web entera se rastree continuamente.

La ruta SSE emite `ready` de inmediato y `results` **cuando concluye la búsqueda**;
no transmite píxeles, DOM, cookies, sesión Chromium ni navegación remota en tiempo real.
Las APIs web normales pueden seguir ofreciendo su navegador/Reader particular.

`/retrieve` está apagado salvo `WAE_CONNECT_READER_ENABLED=true`. Usa el Reader público
existente: HTTPS/443, DNS IPv4 público fijado, `robots.txt`, límite de bytes/tiempo,
redirecciones de documento rechazadas, texto extraído. No usa el token de una bóveda y
no almacena ese texto en ninguna bóveda del sistema consumidor.

Límites iniciales: 20 solicitudes/minuto y 3 operaciones concurrentes **por cliente y
compartidos entre réplicas**, usando tablas transaccionales PostgreSQL y leases de 45 segundos
que expiran tras un fallo de proceso. `WAE_CONNECT_ADMISSION_MODE=postgres` es obligatorio
si se detecta `NODE_ENV=production`, Render o Vercel: sin conexión validada o tablas
inicializadas, la API responde 503 y **NO vuelve a la caché de cuotas local**.
La modalidad `local` solo se permite con `NODE_ENV=development` o `NODE_ENV=test` explícito y sin indicadores de Render/Vercel; si `NODE_ENV` no existe, el gateway también falla cerrado. Los límites
de usuarios individuales dentro de cada producto y la recuperación/abuso requieren
políticas adicionales en cada servicio consumidor. El gateway no acepta URLs arbitrarias de backend ni
reenvía cookies/cabeceras privadas al sitio visitado.

## Activación posterior, nunca automática

1. Publicar primero un backend WAEWEB validado bajo un origen HTTPS y cumplir
   `npm run release:gate` (actualmente HOLD). No asumir que la URL Vercel existente ya
   sirve el branch en desarrollo.
2. Crear tres secretos aleatorios únicos de al menos 32 caracteres y definir en el
   backend WAEWEB `WAE_CONNECT_CLIENTS_JSON`, `WAE_CONNECT_ENABLED=true`.
3. Inicializar las tablas de admisión de la base PostgreSQL validada mediante
   `WAE_CONNECT_ADMISSION_MODE=postgres npm run connect:pg:init` con aprobación del
   operador. La cuenta de base debe contar con permisos mínimos y esquema listo.
   No se provisiona ni se configura ninguna base de producción desde este PR.
4. En el backend de **cada** consumidor: `WAEWEB_CONNECT_ENABLED=true`,
   `WAEWEB_CONNECT_BASE_URL=https://<origen-waeweb>/`,
   `WAEWEB_CONNECT_CLIENT_ID=<id-exacto>`,
   `WAEWEB_CONNECT_TOKEN=<secreto-correspondiente>`.
5. Verificar `GET /status`, error de credencial ajena, SSE, resultados con fuentes,
   fallback cuando WAEWEB está inactivo y métricas por cliente antes de conectar la UI
   o el orquestador. No reenviar su token al navegador. Mantener `retrieve` apagado
   hasta probar robots/seguridad de lectura en el entorno final.

## Seguridad y QA

Tests `tests/connect.test.mjs`: configuración apagada, tres clientes y claves distintas,
rechazo de tokens incorrectos, origen navegador, tipos/consultas inválidos, lector
apagado, resultados JSON, SSE, URL HTTPS validada. Sin secretos de producción.
El contrato OpenAPI está en `docs/openapi-connect-v1.yaml`.

**No-go de Vercel/Render:** ninguna integración aparece como LIVE hasta que existan
servicio WAEWEB desplegado/verificado, configuración de secretos, pruebas E2E de cada
consumidor, control de abuso distribuido y aprobación de los bloqueos del manifiesto.

**Evidencia de admisión real:** [CI PostgreSQL 16 — cuotas compartidas y concurrencia PASS](https://github.com/aleexwae4-lab/Waeweb/actions/runs/35712745534). Valida procesos independientes en CI, no un servicio externo de producción.
