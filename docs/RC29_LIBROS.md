# WAEWEB RC29 — Libros para autores

## Cambios de interfaz

- Se elimina de la portada principal el texto exacto «Una sola barra para investigar y abrir sitios web. Si una página impide la vista integrada, podrás abrir su sitio original.»
- En el pie global aparece el enlace **▤ Libros →** hacia **/libros.html**. No sustituye la pestaña de investigación «Libros» dentro del buscador.
- /libros y /libros.html se sirven desde el backend Node; public/libros.html forma parte de la salida estática Vercel. CSS y JS independientes no interfieren con búsqueda, traductor, mapas ni otras cuentas.

## Flujo editorial

1. Página propia de WAEWEB para autores con catálogo de libros publicados reales (vacío hasta que existan), pasos claros y propuesta de registro/publicación sin cuota inicial.
2. Cuenta de autor mediante la **API existente de cuentas**, únicamente cuando /api/capabilities confirme accountsEnabled y que no es vista previa. No se fingen cuentas en el navegador; credencial solo en la memoria de esta página. En preview, el registro sigue bloqueado.
3. Datos editoriales básicos (título, autor/seu­dónimo, categoría, sinopsis, precio) en formulario sencillo. Solo se guarda **metadata** en localStorage por pulsación explícita. El contenido y la portada se seleccionan localmente y no se suben ni se guardan junto al borrador. El borrador no crea libro público.
4. Archivos PDF/EPUB máximo 40 MB y portadas JPG/PNG/WebP máximo 5 MB con comprobación preliminar de firma/encabezado; vista local disponible. Esto NO sustituye revisión antivirus, validación de EPUB/PDF, derechos ni almacenamiento duradero.
5. Calculadora ilustrativa de distribución **70 % al autor / 30 % a WAEWEB** en pesos mexicanos con céntimos exactos: el precio no es un cobro; impuestos, devoluciones y costes de pasarela deben definirse en condiciones claras.
6. Botón de publicar y cobros deshabilitados hasta contar con persistencia de archivos, onboarding de autores, control de derechos, moderación, Stripe Connect u otro sistema real de liquidación, reembolsos, comprobantes e impuestos.

## Política de precisión

No se han inventado libros, autores, portadas, reseñas ni compras. Los precios de portada ilustrativa y los cálculos no representan ventas ni regalías reales. Las cuentas solo pueden registrarse si ya está operativo el servicio seguro existente. El proveedor de cobros vigente de WAEWEB cubre promociones de negocios, **no ventas de ebooks ni pagos a autores**.

**Implementación:** GitHub `feat/wae-web-search-core`, PR 1. main intacta. No acciones directas en Vercel. Release HOLD. Pruebas de rutas estáticas, vista previa, portada editorial y división de regalías en tests/libros.test.mjs.
