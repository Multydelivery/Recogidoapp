# Contrato: cancelar entregas web abiertas

Ruta lógica sugerida: `/web-cancel-delivery-request`  
Variable de URL en Next.js: `TWILIO_WEB_CANCEL_URL`

Campos URL-encoded: `restaurantId` y `requestId`. Verificar ownership de la raíz
antes de modificarla. En modalidad individual, cancelar sólo hijos aún abiertos
y mantener intactos los hijos asignados/cerrados. En batch, cancelar la raíz
únicamente si sigue abierta. Si no queda ninguna entrega abierta, devolver
conflicto `409`; no reinterpretar ese caso como éxito.

Las transiciones concurrentes con una asignación deben ser seguras: la Function
debe usar la misma sincronización/atomicidad que el flujo de despacho existente
para evitar cancelar una entrega que acaba de ser aceptada. Devolver la raíz
actualizada en el contrato compartido.

No usar `/manage-delivery-request`: depende de contexto de WhatsApp, del mensaje
original y de la identidad de dispatcher.
