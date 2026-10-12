# Contrato: crear solicitud desde la web

Ruta lógica sugerida: `/web-create-delivery-offer`  
Variable de URL en Next.js: `TWILIO_WEB_CREATE_URL`

Campos URL-encoded enviados desde el servidor: `restaurantId`,
`restaurantName`, `restaurantPhone`, `deliveryCount`, `requestId` e
`idempotencyKey`. La identidad, el teléfono y el perfil deben validarse contra
`restaurants`; para `restaurant-test`, la Function también debe confirmar el
perfil de piloto antes de llamar a la lógica central de creación.

Validar límites, modalidad, números y la forma `WEB_<32 hex>` del ID. Registrar
la clave de idempotencia persistentemente antes de producir efectos externos:
clave y cantidad iguales devuelven la misma solicitud; clave igual con cantidad
distinta da `409`; carreras concurrentes no pueden crear dos raíces ni repetir
ofertas WhatsApp. La persistencia debe usar el patrón transaccional disponible
en el servicio de despacho real.

La modalidad batch crea una raíz única. La modalidad individual crea una raíz
parent y una solicitud hija por entrega, reusando exactamente el algoritmo de
despacho existente. La respuesta JSON debe incluir `success`, `restaurantId` y
`request` con el contrato normalizado de Dispatch. No iniciar un timer por cada
hijo; Next inicia uno para la raíz únicamente tras recibir creación confirmada.

No se incluye una implementación deployable porque no está presente aquí la
lógica central actual ni el esquema Sync completo. No sustituirla con una
aproximación nueva.
