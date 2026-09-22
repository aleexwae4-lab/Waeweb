# WAEWEB RC35 — traductor móvil, resultados ampliados y aviso comercial

## Traductor
- El modo «Automático» prioriza el servicio conectado si ya está disponible. La descarga de un motor local en el móvil deja de bloquear la primera traducción. El motor local se puede solicitar expresamente.
- Capacidad y traducción tienen límites temporales visibles; si se cuelgan, el usuario puede detener y reintentar sin perder texto. Al cambiar de pestaña o ir a una URL se cancela el trabajo activo; las pestañas sin consulta tienen su propia pantalla en vez de retener el traductor congelado.
- MyMemory es una traducción externa de texto breve (máx. 450 bytes) y puede tener cuota, fallos o resultados erróneos. No se asegura soporte local en todos los navegadores y el modo local no envía texto al proveedor.

## Búsqueda federada enriquecida
- «Todo»: Google si configurado, Wikipedia, Wikidata, Crossref, OpenAlex, Europe PMC, Open Library.
- «Investigación»: Crossref, OpenAlex, Europe PMC y Wikipedia.
- «Imágenes»: Wikimedia Commons (28 archivos consultados) y Google si configurado.
- «Videos»: Wikimedia Commons **solo archivos con MIME de video**, más Google si configurado. Enlaces a las fichas originales; no se simulan videos de YouTube ni reproducción universal.
- «Noticias»: documentos GDELT de la última semana y Google si configurado; disponibilidad variable por proveedor.
- «Libros»: Open Library (10 fichas). Fuentes siempre explícitas y URLs validadas. Nuevas fuentes pueden fallar independientemente sin ocultar las demás.
- «source:wikidata», «source:europepmc» y «source:gdelt» disponibles. Sin cifra global de resultados ni datos inventados.

## Aviso visual
- Se quita el banner fijo «Cuentas, pagos ... desactivados» y se deja una descripción neutra del estado empresarial cuando se abre el módulo. **Esto NO activa pagos ni cuentas**: el backend mantiene HOLD, WAE_PREVIEW_MODE=true en Render y todas las operaciones comerciales privadas fail-closed.

## Entrega
- Servicio objetivo: Render workspace Waeweb, `waeweb.onrender.com`, rama `main`. La confirmación requiere deployment LIVE de RC35 y pruebas HTTP reales en el dominio. Vercel continúa separado y limitado por su cuota; no se hace despliegue adicional a través de Vercel.
