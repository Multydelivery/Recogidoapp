# Contrato: consultar estado web

Ruta lógica: `/web-delivery-status`
Variable de URL en Next.js: `TWILIO_WEB_STATUS_URL`

Campos URL-encoded: `restaurantId` y `requestId`. Un `requestId` vacío solicita
la solicitud activa más reciente del restaurante. La Function debe cargar la
raíz, verificar que pertenece al restaurante autenticado antes de leer los
hijos, y devolver `{ "success": true, "restaurantId": "...", "request": ... }`.
Si no hay solicitud, `request` puede ser `null`.

La respuesta debe reflejar estado y conteos desde Sync, no inferir que una
solicitud está abierta por ausencia de asignaciones. En modo individual, incluir
el estado de cada hijo, nombre de conductor si existe y fecha de asignación;
omitir siempre el teléfono del conductor.

La respuesta puede incluir la identidad solamente dentro de `request`.
El adaptador reutiliza `normalizeRequest` para estado e historial: valida raíces
con `/^WEB[A-F0-9]{32}$/i` e hijos con `/^WEB[A-F0-9]{32}_[1-9][0-9]*$/i`,
además de comprobar pertenencia a la raíz y `deliveryNumber`.
`requestedDeliveries` se proyecta a `deliveryCount`, `pendingDeliveries` a
`remainingDeliveries`, `children` a `deliveries`, `winnerName` a `driverName`
y `claimedAt` a `assignedAt`. La identidad pública permanece en
`snapshot.restaurant`; no se devuelven campos privados del payload.

`no_driver_alerted` se normaliza a `open` con `noDriverAlerted: true`;
`partially_assigned` a `partially_claimed`, `completed` a `closed` y
`assigned` en hijos a `claimed`. Los estados canónicos existentes se conservan.
En solicitudes activas/asignadas, asignadas + pendientes debe igualar el total
y coincidir con los hijos. Solicitudes canceladas/cerradas pueden incluir
entregas no asignadas que ya no están pendientes.

Cuando una solicitud deja de estar abierta, su polling se detiene por
`requestId`, sin afectar otras solicitudes. `fully_assigned` muestra el total
asignado y los conductores públicos, y permite usar “Nueva solicitud”.
Consultar estado no inicia Make ni crea/reoferta ofertas.

La validación de asignación es condicional: en hijos `open`, `winnerName`
puede estar vacío/ausente y `claimedAt` puede ser `null`/ausente; ambos se
omiten del resultado si todavía no hay conductor. Hijos `cancelled` también
admiten esos campos `null`/ausentes. Hijos `claimed` o `assigned` requieren
nombre público no vacío y fecha ISO válida. Otros valores malformados
siguen rechazándose.

Un padre `open` puede conservar cero asignadas y todas las entregas pendientes
sin límite de tiempo; el aviso de 20 segundos no cierra la solicitud.
`partially_claimed` exige asignadas y pendientes mayores que cero;
`fully_assigned` exige todas asignadas y cero pendientes.


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
