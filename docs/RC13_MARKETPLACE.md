# WAEWEB RC13 — Marketplace empresarial

**Estado: DRAFT / HOLD. No desplegar todavía en Vercel ni habilitar cobros reales.**

RC13 añade un marketplace tipo catálogo social dentro de WAEWEB, ligado al perfil
de cada empresa. El objetivo es reducir el registro a una secuencia simple:
**Mi cuenta → empresa → producto/servicio → guardar → publicar**.

## Capacidades
- Productos y servicios separados por tipo, con nombre, categoría, descripción,
  precio opcional MXN, disponibilidad y fotografía.
- Las publicaciones se guardan privadas por defecto. Publicarlas requiere una
  acción explícita y el perfil de empresa debe ser público.
- Edición, ocultamiento y eliminación desde el panel del propietario.
- Fotografía reducida en el navegador antes de enviarse; backend admite
  JPEG/PNG/WebP, valida firma binaria y limita el payload persistente.
- Catálogo público dentro del perfil de empresa y explorador global Marketplace.
- Búsqueda por texto, tipo y ciudad; paginación de 20 elementos.
- Texto autodeclarado siempre renderizado mediante `textContent`, sin HTML de usuario.
- No hay checkout comprador, escrow, entrega ni garantía de precio/disponibilidad.
  El contacto sigue ocurriendo con la empresa y WAEWEB no se presenta como vendedor.

## Modelo de monetización compatible
El catálogo base permanece gratuito. El sistema de promociones de RC12 puede
posteriormente extenderse a ubicaciones patrocinadas claramente etiquetadas,
sin alterar el orden orgánico de manera encubierta. RC13 no implementa todavía
promoción pagada por producto.

## Controles
- Máximo 16 publicaciones por empresa en esta etapa para respetar el límite del
  sobre cifrado de cuentas.
- Empresa y publicación privadas no aparecen en el catálogo público.
- Una publicación pública deja de ser visible si el perfil empresarial se oculta.
- No se aceptan SVG ni URLs remotas como fotografía.
- Las imágenes son datos comerciales autodeclarados y forman parte del sobre
  cifrado de la cuenta mientras el almacenamiento siga este modelo.

## Próximo salto antes de producción
Mover fotografías a object storage privado con URLs firmadas y ciclo de vida,
incorporar moderación/denuncia, contacto comercial estructurado, pruebas E2E
del panel móvil y política de contenido. El release general continúa en HOLD.
