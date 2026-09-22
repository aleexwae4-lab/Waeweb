# WAEWEB RC24 — búsqueda y navegación en una sola experiencia

**Solo GitHub · sin acciones ni cambios directos en Vercel · `main` sin fusionar.**

## Hallazgos del video móvil de revisión

- Una búsqueda como «clima en Guadalajara» o «TikTok» presentaba el mensaje «Credencial inválida o revocada. Conecta tu bóveda nuevamente» pese a estar en una consulta pública. El frontend transformaba **cualquier HTTP 401** en ese mensaje, sin distinguir la búsqueda pública del índice privado. El video no permite determinar por sí solo cuál capa originó ese 401 (API, protección del deployment o enrutado); no se declara reparada una configuración externa que no se ha inspeccionado.
- «Índice WAE» y el formulario de registro se mostraban en la vista previa aunque no eran utilizables; el Marketplace vacío no señalaba suficientemente su estado de pruebas.
- «Navegador WAEWEB» se abría como pantalla separada y mostraba un gran panel blanco vacío, en lugar de conservar el contexto de la búsqueda.

## Cambios implementados

1. La vista HTTPS vive **dentro de resultados** junto a fuentes, resumen y clima. No hay segunda pantalla ni botón gigante para abrir otro navegador. El icono superior lleva al campo de búsqueda.
2. La barra principal y la barra de resultados aceptan **consultas o URLs explícitas**. Términos como «TikTok», «clima en Guadalajara» y `site:` siguen siendo búsquedas; `example.org` y `https://example.org` abren la vista integrada. Un protocolo inseguro no se convierte silenciosamente en búsqueda: se somete a las validaciones HTTPS existentes.
3. Se conservan resultados e historial de búsqueda al ver una página, y la vista se puede cerrar sin eliminar los resultados. El estado vacío ocupa poco espacio y tiene fondo oscuro coherente con el buscador; iframe aislado y enlace al sitio original permanecen.
4. El error 401 solo invalida la credencial cuando procede de una ruta privada `/api/index/*` o `/api/read`. En una ruta pública informa el HTTP 401 de forma separada y facilita enlaces **externos reales, no resultados simulados**, para continuar la investigación.
5. El clima se consulta **independientemente** de la búsqueda federada; un fallo del proveedor general no suprime la ficha meteorológica.
6. Ocultamos el índice y la búsqueda de empresas si sus capacidades reales no están activadas; se informa por qué no están disponibles sin solicitar una credencial privada para una búsqueda pública. En la vista previa las cuentas muestran aviso, **no un formulario que no guarda**. El Marketplace indica expresamente su modo de prueba.

## Garantías y límites

- Una página HTTPS puede prohibir iframe por CSP o X-Frame-Options. Una web pública no puede saltar esa protección ni observar su historial entre dominios. Se mantiene «Abrir sitio original» como alternativa; el motor Chromium de escritorio es una capacidad distinta.
- Los proveedores externos y la configuración de acceso/ruteo reales necesitan pruebas HTTP del entorno cuando el usuario autorice volver a Vercel. El cambio de frontend **no demuestra que desapareciera la causa de la respuesta 401**: corrige la explicación incorrecta y ofrece continuidad útil.
- No se habilitan datos reales, registro, Stripe, almacenamiento privado ni producción. `release-readiness.json` conserva `HOLD`.

Verificación: `npm run check`, `npm test` (omnibox, UI integrada, preservación de aislamiento y rutas), y las pruebas PostgreSQL pertinentes en GitHub Actions. Los tests son evidencia de código, no un ensayo manual del video en la URL desplegada.
