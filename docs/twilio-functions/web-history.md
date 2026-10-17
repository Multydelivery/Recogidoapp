# Contrato: historial de Dispatch web

Ruta lógica: `/web-delivery-history`  
Variable de URL en Next.js (server-only): `TWILIO_WEB_HISTORY_URL`

Petición: `POST` `application/x-www-form-urlencoded` con Basic Auth
(`TWILIO_WEB_AUTH_USERNAME` / `TWILIO_WEB_AUTH_PASSWORD`), enviada sólo desde el
servidor de Next.js. Campos:

- `restaurantId`: tomado del perfil autorizado por PIN; el navegador no puede elegirlo.
- `limit=50`: máximo de solicitudes raíz devueltas.

Respuesta esperada:

```json
{
  "success": true,
  "restaurantId": "restaurant-test",
  "count": 1,
  "requests": [
    {
      "requestId": "WEB…",
      "restaurantId": "restaurant-test",
      "restaurantName": "Restaurante de prueba",
      "totalDeliveries": 2,
      "assignedDeliveries": 2,
      "completedDeliveries": 1,
      "cancelledDeliveries": 1,
      "pendingDeliveries": 0,
      "activeDeliveries": 0,
      "status": "completed",
      "driverNames": ["Nombre del conductor"],
      "createdAt": "2026-10-13T22:00:00.000Z",
      "finalizedAt": "2026-10-13T22:40:00.000Z",
      "deliveries": [
        { "requestId": "WEB…_1", "deliveryNumber": 1, "status": "completed", "winnerName": "Nombre", "claimedAt": "…" },
        { "requestId": "WEB…_2", "deliveryNumber": 2, "status": "cancelled" }
      ]
    }
  ]
}
```

Validación estricta en Next.js (cualquier desviación responde 502
"Historial inválido del servicio central."):

- `count` debe coincidir con `requests.length` (máximo 50).
- Cada registro debe pertenecer al `restaurantId` autenticado.
- Los contadores son enteros dentro de `totalDeliveries` (1–20) y su suma no lo excede.
- `completed`, `cancelled` y `closed` deben tener `pendingDeliveries = 0`.
- `finalizedAt` puede ser `null`; `createdAt` debe ser ISO válido.
- Los campos desconocidos (por ejemplo teléfonos de conductores) se descartan y nunca llegan al navegador.

Ruta interna: `GET /api/dispatch/restaurants/[restaurantId]/history` con el
encabezado `X-Device-Token`. Responde 401 con PIN inválido, 400 si recibe
parámetros de consulta, 503 si `TWILIO_WEB_HISTORY_URL` no está configurada,
502 ante fallas del servicio central y 504 por timeout. El terminal consulta el
historial al abrir, tras una cancelación exitosa, cuando una solicitud sale de
la cola activa y con el botón "ACTUALIZAR HISTORIAL"; nunca en cada polling.

## Campos opcionales para la línea de tiempo

El terminal muestra cada entrega con un número público (`orderNumber`, por
ejemplo `#E814C7-01`) y una línea de tiempo: Solicitud recibida → Conductor
asignado → Pedido recogido (En camino) → Entrega completada. El `requestId`
interno (`WEB…`) nunca se renderiza en el HTML.

Campos opcionales aceptados (si faltan, la interfaz sigue funcionando):

- `orderNumber` en la raíz y en cada hijo: 4–12 caracteres alfanuméricos en
  mayúscula, con sufijo opcional `-NN`. Si falta o parece un ID interno
  `WEB…`, se usa un número corto derivado sólo para mostrar.
- Estado de hijo `picked_up` (se normaliza a asignada con `pickedUp: true`),
  y `pickedUpAt`, `completedAt`, `cancelledAt` como fechas ISO.
- `pickedUpDeliveries` y `cancelledDeliveries` como contadores enteros.
- `canceled` se acepta como sinónimo de `cancelled`.
