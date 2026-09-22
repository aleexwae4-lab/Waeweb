# WAEWEB RC28 — Traductor integrado

Pestaña «🌐 Traductor» junto a Índice WAE, visible aunque el índice privado esté oculto. Idiomas, intercambio, copia, lectura en voz del navegador y contador de bytes; solo se envía texto al pulsar Traducir. No se guarda contenido en la bóveda ni en URLs de WAEWEB.

API pública GET /api/translate/capabilities y POST /api/translate, con rutas de Vercel explícitas, validación de idiomas y bytes, y límites de 8 solicitudes/minuto por IP dentro de cada instancia (no es limitación distribuida en serverless). Preview solo permite este POST público; las demás escrituras privadas continúan bloqueadas.

Por defecto MyMemory (proveedor externo gratuito) limita a 450 bytes UTF-8 por solicitud y requiere seleccionar idiomas de origen y destino. No se garantiza disponibilidad ni cuota ilimitada. Se envía el texto mediante HTTPS al proveedor al pulsar Traducir; no introduzcas datos confidenciales. Los términos comerciales y privacidad se deben revisar antes del lanzamiento.

LibreTranslate se habilita expresamente con WAE_TRANSLATE_PROVIDER=libretranslate, WAE_TRANSLATE_URL=https://tu-instancia/ y WAE_TRANSLATE_API_KEY según corresponda. Permite origen auto y hasta 6000 bytes, sujeto a soporte real del servidor. Claves nunca en JavaScript público. Configurar off desactiva el servicio con explicación; ningún fallo se convierte en traducción falsa.

No se modifican Vercel, main, cuentas ni pagos. Release HOLD a falta de pruebas móviles y proveedor en el despliegue.
