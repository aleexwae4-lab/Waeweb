# WAEWEB RC26 — mapas integrados y verificables

**Rama:** feat/wae-web-search-core · `main` intacta · producción HOLD · sin acciones directas en Vercel.

## Qué se construyó

- La pestaña Mapas ahora usa `GET /api/maps?q=` de WAEWEB, no un botón aislado. Entrada Vercel `api/maps.js` y Node comparten `handler`; accesible anónimamente en preview (solo GET).
- `server/maps.mjs` localiza localidades por Open-Meteo Geocoding (hasta 8 coincidencias), conserva latitud/longitud del proveedor, etiqueta el punto como **centro aproximado de localidad**; no afirma conocer direcciones, establecimientos ni rutas. Las coordenadas introducidas directamente no invocan un geocodificador, ni se convierten en dirección inventada.
- `public/maps-core.js` construye URLs seguras únicamente hacia OpenStreetMap con `bbox` y `marker` numéricos; vista embebida desplazable, selector de localidades, acercar/alejar, coordenadas copiables y enlace al mapa original.
- Estado vacío, fallo del proveedor y resultado sin coincidencias informativos. Se invalidan consultas anteriores mediante AbortController/sequence; cambiar de pestaña preserva el flujo de búsqueda; no solicita bóveda ni ubicación GPS.
- Respuesta geográfica con caché de 15 min (sin coincidencias 1 min) y límite compartido de solicitudes de la API; sin autocompletado intensivo ni uso de la API pública de Nominatim.
- Atribución a OpenStreetMap en el mapa y en WAEWEB. El iframe limita capacidades y carga desde origen HTTPS fijo; se mantiene alternativa externa si la inserción falla.

## Límites verificables

Open-Meteo es geocodificación de localidades, no catálogo de empresas ni direcciones postales precisas. OpenStreetMap es cartografía externa embebida; su disponibilidad depende del servicio y la red. No hay GPS porque la política CSP/permisos del sitio lo deshabilita. Ningún dato sintético es presentado como ubicación real.

El error HTTP 401 del deployment requiere pruebas reales de `/api/maps`, `/api/search` y Vercel; código y CI por sí solos no certifican producción. No se fusionó `main`, no se habilitaron cuentas, pagos ni despliegue productivo.

## RC27 — marca WAEWEB en Mapas

- La cabecera y los controles muestran la identidad WAEWEB; se retiraron menciones promocionales redundantes a OpenStreetMap de títulos y acciones, conservando la URL de destino original cuando el usuario abre el proveedor.
- Se conserva junto al mapa un enlace visible, legible y clicable `© OpenStreetMap contributors` a `https://www.openstreetmap.org/copyright`, además de `ODbL` y la fuente de localidades cuando corresponde. No se ocultan ni recortan los avisos que OpenStreetMap dibuje dentro de su iframe.
- No se intenta alterar el contenido de un origen cruzado. Si se requiere cartografía completamente rediseñada y marca blanca, el paso posterior es un renderizador propio con teselas y atribuciones autorizadas, no manipular el iframe externo.
- Sin cambios directos en Vercel, cuentas, cobros o estado HOLD.
