# WAEWEB RC31 — direcciones y lugares elegidos por el usuario

## Funcionalidad
- Dentro de la pestaña Mapas, Cómo llegar permite «⌕ Buscar origen» y «⌕ Buscar destino» después de escribir dirección, negocio o localidad. La búsqueda se realiza SOLO al pulsar, no mientras escribe.
- `GET /api/places?q=` consulta ORS Pelias por HTTPS con clave EN SERVIDOR; devuelve hasta seis coincidencias con etiquetas, coordenadas y precisión. El usuario escoge expresamente cuál usar; no se selecciona el primer resultado silenciosamente.
- Al elegir una coincidencia, su coordenada se usa para la API de rutas. Se muestra el nombre/ubicación de la coincidencia en resultados y se recenteriza el iframe OSM si está disponible. La geometría de la ruta sigue en el esquema separado: no se afirma que esté superpuesta sobre el mapa de terceros.
- Las coordenadas introducidas manualmente siguen funcionando. Las localidades seleccionadas desde Open-Meteo se señalan como centros aproximados. «Preciso» en una ficha de geocodificación significa punto de la fuente, **no** dirección física, entrada vial ni negocio verificado.
- El backend de rutas rechaza texto sin elección de coincidencia con `409 selection_required`. Ni geocodificación automática del primero ni sustitución silenciosa por centro de localidad.

## Estado del proveedor y privacidad
- Motor `WAE_ROUTING_PROVIDER=ors`, `WAE_ROUTING_API_KEY` **servidor**. El mismo proveedor opera Pelias y directions. Por defecto apagado; la UI explica el motivo, sin resultados simulados.
- Los textos consultados se envían a ORS al pulsar Buscar. Las coordenadas de origen/destino se envían al pulsar Calcular ruta. GPS puntual, opt-in, sin `watchPosition`.
- Sin tráfico en vivo ni navegación en vivo; cobertura y exactitud varían por país/ciudad. No se han completado pruebas E2E con clave real, condiciones comerciales ni prueba de despliegue.
- Proteger cuota con límite por instancia y mantener protecciones privadas de preview.

**Sólo GitHub**; Vercel, rama principal y release HOLD sin cambios.
