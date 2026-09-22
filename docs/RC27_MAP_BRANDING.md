# RC27 — Mapas bajo la identidad WAEWEB

Alcance: únicamente GitHub en la rama `feat/wae-web-search-core`. La interfaz propia usa WAEWEB como marca principal y nombres de controles neutrales, sin presentar OSM como el nombre del producto.

El proveedor de cartografía conserva la atribución **visible y accesible** junto al mapa: [© OpenStreetMap contributors](https://www.openstreetmap.org/copyright) · ODbL. También se indica la procedencia de la geocodificación Open-Meteo cuando se usó.

No se borra ni se tapa la atribución que pueda dibujar OpenStreetMap dentro de su iframe: WAEWEB no es propietario ni controlador de esa página externa. Cualquier cambio futuro a un motor cartográfico bajo diseño propio requerirá proveedor de teselas autorizado, estudio de uso de servicio y atribución compatible.

No se cambia Vercel, no se fusiona main y producción continúa HOLD.
