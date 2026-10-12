# Contrato: reofertar entregas web abiertas

Ruta lógica sugerida: `/web-resend-delivery-request`  
Variable de URL en Next.js: `TWILIO_WEB_RESEND_URL`

Campos URL-encoded: `restaurantId`, `requestId` y `openRequestIds` como IDs
separados por coma. Volver a leer la raíz y derivar/verificar el conjunto de
hijos abiertos en Sync; no confiar en que la lista del llamador sea correcta.
Sólo enviar ofertas para IDs abiertos, nunca duplicar una entrega asignada.
Batch sólo puede reofertarse como una raíz que siga abierta.

Reusar el mecanismo actual de oferta WhatsApp y la protección de concurrencia
existente. Devolver el estado actualizado. Next inicia un timer de Make para la
raíz/generación de reoferta, no uno por hijo; Make debe deduplicar la clave
`<requestId>:resend:<generation>` de forma persistente.

No usar `/manage-delivery-request`: requiere el contexto de una interacción por
WhatsApp.
