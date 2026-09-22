# RC33 — Traductor y visor geográfico propios de WAEWEB

## Traductor
- El texto técnico de error HTTP 401 y el párrafo largo solicitado ya no se representan dentro del traductor. El formulario permanece operativo, con botón «↻ Reconectar» y estado breve sin divulgar detalles del backend a la interfaz.
- Motor «Automático · priorizar dispositivo»: si el navegador dispone de la **Translation API local** y admite el par, traduce en el dispositivo tras la pulsación explícita; pueden descargarse paquetes de idioma por el navegador. No se asegura compatibilidad en Android ni en todos los idiomas.
- Motor «En este dispositivo»: si no hay soporte local, se indica claramente y no se envía el texto a servicios externos.
- Motor «Servicio conectado»: llama a `/api/translate` solo al pulsar Traducir y cuando `/api/translate/capabilities` lo permite. El backend mantiene cuotas/tamaño y los secretos solo en el servidor. Sin conexión, reintenta sin descartar el texto. No hay traducciones ficticias.
- El tratamiento de datos sigue siendo transparente en una frase corta; borrar un aviso visual no significa eliminar el deber de documentar privacidad en el producto.

## Mapas
- `/native-map.js` dibuja un visor SVG dentro de la pestaña Mapas sin iframe, sin API de terceros para el **dibujo** y sin petición de imágenes/tile servers. Tiene pan con puntero, teclas de dirección, zoom, centrar, marcador y graticulado de latitud/longitud.
- La ruta se traza en el SVG únicamente con geometría validada del motor de rutas, cuando está configurado y devuelve datos. Las coordenadas ingresadas siguen funcionando sin `/api/maps`.
- Es una **vista geográfica y de rutas, no una cartografía callejera**: no contiene calles, negocios ni imágenes satelitales. Un mapa completo requiere un dataset cartográfico con licencia, teselas, hosting y cobertura. No se promete equivalencia a Google Maps ni se presenta una cuadrícula inventada como calles.
- Búsqueda de localidades Open-Meteo y dirección Pelias + rutas ORS siguen bajo la configuración y limitaciones publicadas; sin backend accesible o sin clave no se inventan ubicaciones, traducciones ni rutas.
- El original de OpenStreetMap se conserva como enlace opcional, no un navegador integrado.

## Release
- Cambios solo en PR de GitHub, rama `feat/wae-web-search-core`; no se toca Vercel ni se fusiona `main`.
- No afirmar corrección del HTTP 401 live sin comprobar el proyecto Vercel real, rama y Deployment Protection. Mantener gate HOLD hasta E2E real y seguridad.
