# WAEWEB RC14 — solicitudes privadas y moderación manual del Marketplace

**Estado:** desarrollo aislado. Vercel HOLD, PR borrador. No habilitar datos comerciales reales antes de pruebas operativas.

## Comprador

Desde la ficha pública de un producto o servicio, la persona autenticada puede pulsar **Solicitar información** y enviar un mensaje de 10–500 caracteres. Se requiere consentimiento expreso para compartir su nombre, correo y mensaje **solo con la empresa propietaria**. No se muestra el correo en búsquedas ni catálogos. La solicitud queda cifrada junto al registro de cuentas; máximo 40 consultas guardadas por empresa y una solicitud por comprador+artículo cada 24 horas. El mensaje no genera pagos, notificaciones por correo ni garantía de respuesta.

**Reportar anuncio** solicita un motivo estructurado, requiere sesión, impide reportes propios, deduplica por cuenta/artículo durante 30 días y admite hasta cinco reportes por cuenta cada 24 horas. Los reportes quedan en la misma persistencia cifrada y se retienen hasta revisión; ningún reporte causa retirada automática.

## Empresa

En **Mi cuenta → Mi empresa → Consultas recibidas**, el propietario consulta el mensaje y los datos compartidos. La API solo autoriza a ese propietario. No se habilita correo de respuesta automática, ni se usa el mensaje como instrucción de IA. Los datos de contacto no se incluyen en la respuesta pública del catálogo. El negocio y el artículo deben estar publicados para recibir una consulta.

## Moderación operativa

La revisión es **offline, fuera de HTTP y sin plataforma administrativa pública**. Solo el operador con acceso a claves cifradas, a la base de cuentas PostgreSQL y con `WAE_MARKET_MODERATOR_ACK=manual-review-authorized` puede ejecutar:

```bash
npm run marketplace:reports
npm run marketplace:moderate -- <report-uuid> hide --confirm-manual-review
npm run marketplace:moderate -- <report-uuid> dismiss --confirm-manual-review
```

La lista no imprime identidades de denunciantes, correos ni secretos; presenta ID de caso, empresa, artículo, motivo y fecha. La acción `hide` oculta la publicación y la marca `moderation=blocked`: su propietario no puede volver a publicarla mediante las rutas habituales. `dismiss` solo cierra el reporte. No existe sanción automática basada en el número de denuncias. La resolución humana y la política de revisión siguen siendo responsabilidad del operador; falta interfaz y procedimiento de apelación.

## Seguridad y límites de RC14

El Marketplace sigue siendo un directorio comercial autodeclarado, **no un intermediario de pagos**. La bandeja almacena datos personales y exige política de privacidad, retención y eliminación antes de producción. El límite actual de 4 MiB del sobre cifrado y la fotografía inline mantienen pendiente la migración a almacenamiento de objetos privado. No se afirma haber implementado object storage, mensajería en tiempo real, antiabuso distribuido por IP ni conformidad legal definitiva. El release general continúa en HOLD.
