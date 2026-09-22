# WAEWEB RC30 — Cómo llegar y rutas verificables

**Integración:** pestaña Mapas. El usuario elige destino en el mapa o lo escribe, introduce origen (ciudad o latitud,longitud), escoge automóvil, peatón o bicicleta, pulsa **Calcular ruta** y ve distancia, tiempo estimado, dibujo de la geometría devuelta por el proveedor e instrucciones de giros. Botón para copiar indicaciones. Responsive móvil.

**Motor:** openrouteservice (ORS), no servidor público de demostración. Activación explícita del operador por `WAE_ROUTING_PROVIDER=ors` + `WAE_ROUTING_API_KEY` (servidor, nunca en JS). Por defecto OFF: la interfaz muestra “requiere motor de rutas configurado” y no inventa trayectos. ORS recibe origen/destino y entrega GeoJSON + pasos. Se verifican coordenadas, distancias, duraciones y pasos antes de mostrarlos. Ruta real esquemática en SVG: sin mapa vial de fondo ni promesa de sincronizarse con el iframe OSM (que es de otro origen).

**Precisión geográfica:** Open-Meteo Geocoding resuelve localidades; si un punto está dado como ciudad, se usa el centro aproximado, NO una dirección postal ni un comercio. Para direcciones específicas introduce coordenadas verificadas; ambigüedades se anuncian sin inventar domicilio. No se utiliza Nominatim público para autocompletar.

**Privacidad:** GPS puntual por botón explícito y permiso del navegador, solamente en HTTPS. Se escribe como coordenadas de origen, no se inicia watchPosition ni seguimiento; los puntos se comparten con ORS solo cuando el usuario pulsa Calcular ruta. El header Node permite geolocation=(self); permisos adicionales del hosting pueden bloquearlo.

**Límites y pendientes:** no hay tráfico en tiempo real, navegación GPS viva, recalculo automático, voz de giros, accesibilidad vial ni ETA garantizado. Los límites por IP son por instancia, no rate-limit distribuido. ORS exige API key, términos y cuotas compatibles con la operación prevista; validación real E2E, movilidad y accesibilidad pendientes. Vercel no se modifica directamente; main intacta; producción HOLD.
