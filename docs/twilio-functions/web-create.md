# Contrato: crear solicitud desde la web

Ruta lógica: `/web-create-delivery`
Variable de URL en Next.js: `TWILIO_WEB_CREATE_URL`

Campos URL-encoded enviados desde el servidor: exclusivamente `restaurantId`,
`deliveryCount` e `idempotencyKey` (UUID v4). Basic Auth permanece server-side;
no se envían PIN, token de dispositivo ni ID anticipado. La Function obtiene
la identidad, el teléfono y el perfil desde
`restaurants`; para `restaurant-test`, la Function también debe confirmar el
perfil de piloto antes de llamar a la lógica central de creación.

Validar límites, modalidad, números y UUID v4. Twilio genera `WEB<UUID sin guiones>`;
Next.js conserva el ID retornado sin cambiar mayúsculas/minúsculas y exige
`/^WEB[A-F0-9]{32}$/i` en respuestas reales. `WEB_<32 hex>` se conserva sólo
en el simulador. Registrar
la clave de idempotencia persistentemente antes de producir efectos externos:
clave y cantidad iguales devuelven la misma solicitud; clave igual con cantidad
distinta da `409`; carreras concurrentes no pueden crear dos raíces ni repetir
ofertas WhatsApp. La persistencia debe usar el patrón transaccional disponible
en el servicio de despacho real.

La modalidad batch crea una raíz única. La modalidad individual crea una raíz
parent y una solicitud hija por entrega, reusando exactamente el algoritmo de
despacho existente. La respuesta JSON debe incluir `success`, `restaurantId` y
`request` con el contrato normalizado de Dispatch, o la respuesta mínima
`{ success: true, validated: true, requestId, restaurantId, deliveryCount }`.
Se admite `requestedDeliveries` como alias; `pendingDeliveries` se normaliza
a `remainingDeliveries`. Sólo en la confirmación inicial pueden omitirse estado,
fecha e hijos: el adaptador usa `open`, la hora de confirmación y cantidades
pendientes, sin inventar IDs hijos. El polling posterior exige el contrato completo.
La confirmación inicial admite también `request.children: []` junto a los
contadores agregados. Si existe `request`, sus campos tienen prioridad sobre
los equivalentes de la raíz; las fechas presentes deben ser ISO UTC válidas.
`restaurantId` se verifica contra el restaurante autorizado (`restaurant-test`
en el piloto); nombre y pertenencia públicos siguen en `snapshot.restaurant`.
No iniciar un timer por cada
hijo; Next inicia uno para la raíz únicamente tras recibir creación confirmada.

No se incluye una implementación deployable porque no está presente aquí la
lógica central actual ni el esquema Sync completo. No sustituirla con una
aproximación nueva.
