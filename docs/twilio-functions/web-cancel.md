# Contrato: cancelar entregas web pendientes

Ruta lógica sugerida: `/web-cancel-delivery-request`  
Variable de URL en Next.js: `TWILIO_WEB_CANCEL_URL` (server-only)

## Petición

`POST` con `Content-Type: application/x-www-form-urlencoded` y Basic Auth
(`TWILIO_WEB_AUTH_USERNAME` / `TWILIO_WEB_AUTH_PASSWORD`), enviada únicamente
desde el servidor de Next.js. Campos:

| Campo | Valor |
| --- | --- |
| `restaurantId` | Tomado del perfil autenticado en el servidor; nunca del navegador. |
| `requestId` | Raíz de la solicitud. |
| `action` | Siempre `cancel_pending`. |

El navegador sólo envía `requestId` (más el slug y el PIN del terminal para
autenticarse) a `POST /api/dispatch/cancel`; cualquier otro campo
(`restaurantId`, `action`, URL…) se rechaza con `400`.

## Reglas de la Function

- Verificar ownership de la raíz antes de modificarla (`404` si no pertenece).
- Individual: cancelar sólo los hijos aún `open`; los `claimed`/`assigned`/
  `completed`/`closed` quedan intactos. Batch: cancelar la raíz sólo si sigue
  abierta.
- Nunca eliminar físicamente solicitudes.
- Usar la misma sincronización/atomicidad del flujo de despacho para no
  cancelar una entrega que acaba de ser aceptada.
- Si no queda nada pendiente puede devolver `409`.

## Respuesta

La raíz actualizada en el contrato compartido (`success`, `restaurantId`,
`request`). Opcionalmente `action: "cancel_pending"` y
`cancelledDeliveries` (entero entre 0 y `requestedDeliveries`). La respuesta
debe quedar sin entregas pendientes; si no, se rechaza como inválida (`502`).

## Comportamiento del servidor Next.js

- Consulta el estado antes de cancelar; si no hay pendientes responde éxito con
  `cancelledDeliveries: 0` sin llamar a la Function (idempotente).
- Clics concurrentes sobre la misma solicitud se agrupan en una sola llamada.
- `409` upstream: vuelve a consultar el estado; si ya no hay pendientes es un
  no-op confirmado, de lo contrario se informa el conflicto.
- Si una entrega asignada desaparece o cambia en la respuesta → `502`.
- `401`/`403` upstream → `502` (no se confunde con un PIN inválido), `404` →
  `404`, timeout → `504`; todos con mensajes sanitizados, sin URL, credenciales
  ni encabezado `Authorization` en respuestas o logs.

No usar `/manage-delivery-request`: depende de contexto de WhatsApp, del mensaje
original y de la identidad de dispatcher.
