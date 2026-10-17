# Recogido Dispatch

El panel de restaurante está disponible en `/dispatch/[restaurantId]`; `/dispatch/demo`
simula modalidades individual y por lote sin autenticación ni servicios externos.
La página pública `/` y el flujo telefónico existente no forman parte de Dispatch.

La interfaz de conductores en modo demostración (`/driver/demo`, sin conexión con
Twilio ni WhatsApp) se documenta en [README-DRIVER.md](./README-DRIVER.md).

**La integración continúa en `DISPATCH_MOCK_MODE=true`.** No activar el modo real
ni configurar URLs privadas hasta completar y validar las Functions descritas abajo.

## Configuración local

Usa Node.js 22.15+ o 24 y copia `.env.example` a `.env.local` sin reemplazar
una configuración local existente. Reinicia Next.js al cambiar variables.
Todos los valores de integración son exclusivamente de servidor; no usar
`NEXT_PUBLIC_`.

| Variable | Uso |
| --- | --- |
| `DISPATCH_MOCK_MODE` | `true` mantiene el simulador; no se cambia a `false` en esta entrega. |
| `RESTAURANTS_JSON` | Identidad de PIN por restaurante y perfiles mock: `slug`, `name`, `phone`, `deviceToken`, `active`, `deliveryEnabled`, `maxDeliveries`, `assignmentMode`, `maxActiveDeliveriesPerDriver`. |
| `RECOGIDO_DISPATCH_SUBMIT_URL` | Twilio Function segura que crea la solicitud principal y, si es individual, sus entregas hijas. |
| `RECOGIDO_DISPATCH_CONFIG_URL` | Twilio Function que consulta la configuración en el Sync Map `restaurants`. |
| `RECOGIDO_DISPATCH_STATUS_URL` | Twilio Function para estado actual e información de asignaciones. |
| `RECOGIDO_DISPATCH_CANCEL_URL` | Twilio Function para cancelar sólo entregas todavía abiertas. No reutilizar `/manage-delivery-request`. |
| `RECOGIDO_DISPATCH_RESEND_URL` | Twilio Function para volver a ofrecer sólo las entregas abiertas. |
| `RECOGIDO_DISPATCH_HISTORY_URL` | Twilio Function para las últimas cinco solicitudes del restaurante. |
| `RECOGIDO_DISPATCH_MAKE_WEBHOOK_URL` | Webhook privado que inicia el temporizador de Make con el ID principal. Debe deduplicar ese ID. |
| `RECOGIDO_DISPATCH_API_SECRET` | Secreto compartido servidor a servidor. Nunca incluirlo en código cliente, respuestas o logs. |
| `DISPATCH_REQUEST_TIMEOUT_MS` | Timeout de cada llamada externa; entero de 1 a 10000 ms, por defecto 10000. |

`.env.example` contiene únicamente URLs y secreto vacíos, además de PINs y
teléfonos ficticios para desarrollo. Las configuraciones antiguas sin campos de
modalidad reciben perfiles demo compatibles (La Fonda: 3 individual; Brisas y
Jade Lee: 5 por lote). Para datos reales, la Function de configuración obtiene
la verdad del Sync Map; el backend valida los límites en cada creación.

## Autenticación y endpoints de la web

El terminal conserva el PIN/token por restaurante en `localStorage` únicamente
después de validarlo en el servidor. El PIN se envía en `Authorization`; nombre,
teléfono y configuración no se aceptan como campos editables del navegador.
Cada API comprueba el token y la pertenencia del restaurante. Se aplican límites
básicos por cliente y operación. En producción, usa PINs no compartidos,
dispositivos confiables y protección de sesión apropiada para el entorno.

Todas las respuestas de API usan `Cache-Control: no-store`.

| API Route | Función |
| --- | --- |
| `GET /api/dispatch/config?restaurant=...` | Valida el dispositivo y consulta configuración pública del restaurante. |
| `POST /api/dispatch/request` | Recibe `restaurantId`, `deliveryCount` e `idempotencyKey` UUID v4. En modo real, Twilio genera el `requestId`; el mock lo genera localmente. |
| `GET /api/dispatch/status?restaurant=...&requestId=...` | Consulta estado autorizado; sin ID devuelve el estado actual. |
| `POST /api/dispatch/cancel` | Cancela únicamente entregas abiertas; las asignadas se conservan. |
| `POST /api/dispatch/resend` | Reoferta únicamente entregas abiertas. |
| `GET /api/dispatch/recent?restaurant=...` | Devuelve las últimas cinco solicitudes. |

Los errores de una operación real sin URL configurada devuelven HTTP 503 con
`code: "NOT_CONFIGURED"`. No se simulan respuestas reales. Los errores upstream
no exponen mensajes, cuerpos, URLs ni secretos. Los logs contienen sólo operación,
ID de solicitud, código de estado y duración aproximada.

## Contrato de solicitudes

En el piloto real, Twilio genera el ID principal como `WEB<UUID sin guiones>`.
El adaptador conserva ese ID (incluidas sus mayúsculas) y exige `WEB` seguido de
32 caracteres hexadecimales en respuestas reales. El mock conserva `WEB_<32 hex>`.
La creación se envía como `application/x-www-form-urlencoded` exclusivamente
con `restaurantId`, `deliveryCount` e `idempotencyKey` (UUID v4). Basic Auth
permanece en el servidor; no se envían PIN, teléfono ni ID anticipado a Twilio.
El teléfono utilizado por Make procede de la configuración del servidor.

- **Individual (La Fonda y restaurante de prueba):** un `parent` con IDs de
  entrega hija `<requestId>_1...N`; cada hijo tiene estado y asignación propios.
  El mock asigna progresivamente y deja entregas pendientes para probar aviso,
  cancelación y reoferta.
- **Por lote (Brisas y Jade Lee):** una sola solicitud `batch`; el primer
  conductor acepta el lote completo.
- `maxDeliveries` se valida en el cliente para mostrar opciones y nuevamente en
  servidor antes de crear. Un reintento con la misma idempotency key devuelve
  la solicitud original. El backend debe persistir atómicamente la clave por
  restaurante; una clave reutilizada con otra cantidad debe dar HTTP 409.
- Después de crear, se inicia el temporizador de Make una vez por ID principal.
  El webhook recibe ese ID como `Idempotency-Key`; Make debe deduplicarlo
  persistentemente porque las llamadas pueden repetirse tras un timeout/reintento.
- La web jamás invoca Twilio, Sync, Make ni URLs privadas desde el navegador.
  El adaptador server-only impone timeout, `cache: "no-store"`, validación de
  respuesta y proyección segura; no transmite el teléfono del conductor.

## Estado y operación en Mock Mode

El mock del servidor usa el mismo contrato que la API real. Las solicitudes
individuales muestran una tarjeta por entrega con estado, nombre y hora de
asignación; los lotes muestran una tarjeta. Tras 20 segundos, toda entrega que
siga abierta se marca visualmente como pendiente sin conductor. Cancelar sólo
cambia entregas abiertas; las asignadas se conservan. Reofertar registra y
transmite al mock sólo los IDs abiertos. El historial del servidor conserva las
últimas cinco solicitudes, hasta 24 horas o reinicio del proceso.

`/dispatch/demo` también permite alternar entre el perfil individual de La Fonda
y el perfil por lote de Brisas, sin PIN, servicios externos ni cambios en la
landing. Ambos usan los tipos compartidos de Dispatch.

## Prueba piloto de Twilio

La guía de habilitación restringida a `restaurant-test`, sus variables
`TWILIO_WEB_*`, el contrato de las seis Twilio Functions web y los bloqueos
previos a producción están en
[README-DISPATCH-LIVE-TEST.md](README-DISPATCH-LIVE-TEST.md). El piloto requiere
una habilitación separada; Mock Mode sigue activo para los demás restaurantes.

## Twilio Functions necesarias antes de producción

`/manage-delivery-request` **no es compatible con llamadas web** porque depende
de `OriginalRepliedMessageSid`, del botón recibido por WhatsApp y de la identidad
del dispatcher. No conectarlo a estas API Routes.

Crear y probar las siguientes operaciones HTTPS autenticadas con el secreto
compartido (comparación constante, sólo en el cuerpo POST; nunca en query);
todas deben validar `restaurantId` contra Sync Map `restaurants`, `active`,
`deliveryEnabled` y permisos antes de leer o mutar Sync:

1. **Extender `/create-delivery-offer`** (ya existe): aceptar el formulario
   anterior; leer configuración actual de Sync y validar `maxDeliveries`.
   Crear una raíz + N hijos para `individual`, o una sola raíz `batch`; aplicar
   idempotencia persistente y atómica. Devolver raíz, modo, hijos, cantidades y
   estados iniciales. Una repetición nunca vuelve a enviar WhatsApp/ofertas.
2. **Crear `/get-restaurant-dispatch-config`**: leer `restaurants` y devolver
   sólo nombre, activo, despacho habilitado, máximo, modalidad y límite por
   conductor. No devolver teléfono, PIN, tokens, SID ni credenciales.
3. **Crear `/get-delivery-request-status`**: devolver una solicitud raíz con
   hijos, estados, nombres de conductor y hora de asignación; nunca devolver
   teléfonos completos. Para una búsqueda, comprobar que la raíz pertenece al
   `restaurantId` autenticado. Sin ID, responder solicitud actual nula o la
   solicitud activa más reciente.
4. **Crear `/cancel-web-delivery-request`**: mutación atómica que cancele sólo
   hijos/lotes abiertos. No modificar solicitudes ya asignadas; retener
   asignaciones existentes y responder 409 ante carrera con una aceptación.
5. **Crear `/resend-web-delivery-request`**: volver a ofrecer sólo hijos abiertos
   de una raíz individual, o el lote si sigue abierto. La Function debe volver a
   comprobar estado y propiedad de forma atómica.
6. **Crear `/get-recent-delivery-requests`**: devolver como máximo las últimas
   cinco raíces del restaurante autenticado, ordenadas de más reciente a más
   antigua y sin datos sensibles del conductor.
7. **Configurar el webhook temporizador de Make**: crear un único temporizador
   por `requestId` raíz para la alerta de 20 segundos, con deduplicación
   persistente, cancelación/reevaluación de pendientes y validación de firma
   compartida. No programar un temporizador por cada hijo.

Las operaciones 2–6 deben responder JSON con `success` y `restaurantId`. Las
respuestas de estado/creación/cancelación/reoferta deben incluir raíz y
`deliveries` individualizadas: `requestId`, `deliveryNumber`, `status`,
`driverName` opcional y `assignedAt` opcional. El contrato acepta los estados
`open`, `partially_claimed`, `claimed`, `fully_assigned`, `cancelled` y `closed`.
No incluir el `secret`, PIN, tokens, `Account SID`, `Auth Token`, Sync SID,
número completo del conductor ni URLs internas.

El backend central debe guardar los datos de solicitud/idempotencia en Sync u
otro almacén persistente compartido. El Make scenario necesita deduplicación
persistente por raíz. Sólo activar un entorno real una vez que cada operación
haya pasado pruebas de contrato y propiedad. Esta entrega no despliega ni
contacta Twilio, Make u otros servicios externos y no cambia `DISPATCH_MOCK_MODE`.

## Pruebas y validación

```powershell
npm run test:dispatch:adapter
npm run lint
npx tsc --noEmit
npm run build
```

`npm run test:dispatch` es la suite de integración contra un servidor local en
modo mock; requiere `npm run dev` ejecutándose y `RESTAURANTS_JSON` configurado.
