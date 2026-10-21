# Recogido Rides - seguimiento y supervision por excepciones (demo v4)

Next App Router, TypeScript y CSS Modules, con Geist, colores, logo e iconos
SVG existentes de Recogido. Sin nuevas dependencias, SDKs, claves, HTTP,
mapas, mensajes ni pagos reales. No es un administrador de produccion.

## Rutas y recorrido normal

- `/rides/demo`: solicitud ficticia y cotizacion automatica.
- `/rides/demo/status`: aceptacion, seguimiento y recibo simulado.
- `/admin/rides/demo`: activos, finalizados y requieren atencion.

En todas las pantallas permanece visible:

> Modo de demostración — No se solicitará ningún viaje real ni se procesará ningún pago.

Las rutas conservan noindex/nofollow. Usa datos ficticios y la misma pestana.
Recogido coordina; no es el proveedor de transporte. No es para emergencias.

1. Ejecuta `npm run dev` y crea una solicitud.
2. El simulador cotiza automaticamente $25.00 de proveedor.
3. El cliente acepta precio y politica obligatoria:

   > Entiendo que cualquier cargo real de cancelación aplicado por el proveedor de transporte podrá deducirse del monto autorizado.

4. **Aceptar precio y autorizar pago de prueba** inicia el flujo.
5. Sin abrir el dispatcher, observa autorizacion, reserva, conductor,
   recogida, recorrido, finalizacion y pago.
6. El recibo aparece en seguimiento. No se envia por ningun servicio externo.

No hay botones para cotizar, aprobar cada reserva, asignar conductor,
avanzar estados, ingresar costo final, conciliar, capturar ni liberar dinero.

## Formula y dinero

[pricing.ts](src/lib/rides/pricing.ts) usa basis points y BigInt con
redondeo half-up. Todos los importes del modelo son enteros en centavos.

```text
coordinationFee = min(round(providerEstimate * 1000 / 10000) + 200, 500)
temporaryReserve = min(round(providerEstimate * 1000 / 10000), 500)
customerTotal = providerEstimate + coordinationFee
authorizationTotal = customerTotal + temporaryReserve
processingEstimate = round(customerTotal * 290 / 10000) + 30
```

| Proveedor | Coordinacion |
| --- | --- |
| $10.00 | $3.00 |
| $15.00 | $3.50 |
| $20.00 | $4.00 |
| $25.00 | $4.50 |
| $30.00 | $5.00 |
| $40.00 | $5.00 |
| $100.00 | $5.00 |

La pantalla muestra costo estimado, coordinacion, total estimado, retencion
temporal y monto maximo autorizado. La retencion no es ingreso. Stripe no
aparece como recargo al cliente. Procesamiento estimado cero para pago cero.
La tarifa de coordinacion queda fijada al cotizar, no al costo final.
El helper de precios conserva reserva configurable en basis points para
compatibilidad; los viajes nuevos usan 10%, sin editor administrativo.

`parseDollarInput` conserva valores naturales como `18.50`, `$18.50`, `21`,
`21.00` y coma decimal, sin agrupadores ni mas de dos decimales.
`formatCents` presenta USD. Ya no hay entrada manual de importes del dispatcher.

## Estados y eventos automaticos

```text
quote_created -> payment_pending -> payment_authorized -> ride_requesting
  -> booked -> driver_assigned -> driver_arriving -> driver_arrived
  -> passenger_picked_up -> in_progress -> arrived_destination -> completed -> settled

payment_pending -> payment_failed -> payment_pending (reintento del cliente)
fallos de proveedor/eventos/cierre -> needs_attention
cancelacion segura -> cancelled
```

La reserva exige autorizacion, monto exacto, politica versionada y orden
de eventos, en la logica central. El procesador no acepta saltos de estado.
No existen estados visibles de conciliacion.

[contracts.ts](src/lib/rides/contracts.ts) separa `PaymentGateway`,
`RideProvider` y `RideEventProcessor`.
[paymentSimulator.ts](src/lib/rides/paymentSimulator.ts) implementa pagos
ficticios; [simulator.ts](src/lib/rides/simulator.ts) implementa proveedor y
reloj; [demo.ts](src/lib/rides/demo.ts) procesa eventos y acciones validadas.

Eventos cada 1.5 segundos, solo mientras alguna pantalla de Rides este
abierta. El evento final ausente vence 15 segundos despues de completar.
Las fechas de entrega quedan persistidas: al volver o recargar se procesan
en orden los eventos vencidos. No hay tareas de servidor ni ejecucion en
segundo plano con la pestana cerrada; el navegador puede limitar timers.
Los viajes programados tambien se aceleran, sin esperar la fecha elegida.

## Timeline publico, ETA y accesibilidad

[progress.ts](src/lib/rides/progress.ts) es la unica definicion ordenada de
etapas, textos, encabezados y calculo de progreso. Las paginas no deciden
transiciones ni tienen un reloj visual independiente.
[RideProgressTimeline.tsx](src/components/rides/RideProgressTimeline.tsx)
se reutiliza en seguimiento y detalle del dispatcher. Tambien contiene
resumen compacto, tarjeta publica de conductor, aviso de excepcion, ETA y
placeholder de mapa accesible. Usa exclusivamente identidad Recogido;
no incorpora logotipos, estilos ni componentes de otras plataformas.

| Estado tecnico | Etapa publica |
| --- | --- |
| payment_authorized | Solicitud confirmada |
| ride_requesting, booked | Buscando conductor |
| driver_assigned | Conductor asignado |
| driver_arriving | Conductor en camino |
| driver_arrived | El conductor llego |
| passenger_picked_up | Pasajero recogido |
| in_progress | En camino al destino |
| arrived_destination | Llegada al destino |
| completed, settled | Viaje completado |

`cancelled`, `payment_failed` y `needs_attention` aparecen en una tarjeta
destacada, nunca como etapas normales. El cliente conserva opciones seguras
para otro viaje, inicio o reintento de pago; no puede saltar etapas.
El consentimiento de pago adicional preexistente sigue siendo obligatorio.
No se agrega contacto de conductor ni soporte real: el demo no tenia una
accion segura para comunicarse con ellos.

Cada cambio central de estado registra una sola entrada en `statusEvents`:
`{status, label, occurredAt, source, sequence}`. Se conserva la primera hora
de cada estado, incluso en reintentos o eventos duplicados; `booked` comparte
la etapa de busqueda y `settled` la de completado, sin duplicar filas.
El timeline utiliza la primera hora registrada de cada etapa publica.
La historia es inmutable al recargar y no dispara POST ni sonidos.
Las excepciones conservan `progressStatus`, sin reiniciar el avance normal.

`estimatedArrival` y `driver` vienen en eventos del proveedor simulado y se
persisten junto al viaje. ETA distingue recogida/destino y declara que es
simulada. Solo se muestran minutos/hora si existen; en caso contrario se
indica "Calculando tiempo estimado...". No se calcula ubicacion real.
La tarjeta de conductor se identifica como ficticia y contiene nombre
publico, vehiculo, color y placa demo, sin telefono ni datos privados.
El numero corto `DEMO-XXXXXXXX` deriva del ID existente sin modificarlo.

El mapa es una figura ilustrativa con origen, destino y vehiculo neutral,
no un mapa geolocalizado. No carga tiles, scripts ni claves de terceros.
En movil y escritorio el timeline es vertical. En movil el avance activo
queda antes del detalle; antes del pago se prioriza la cotizacion.
Usa lista semantica, `aria-current="step"`, anuncio `aria-live="polite"`,
check SVG, numero y texto de fase (no solo color), foco visible y controles
de al menos 44 px. Solo el paso activo tiene un pulso discreto, deshabilitado
con `prefers-reduced-motion: reduce`.

## Cierre automatico e idempotencia

`settleRideAutomatically` es pura y devuelve:

```text
finalCustomerTotalCents = providerFinalCost + coordinationFee + cancellationFee
amountToCaptureCents = min(finalCustomerTotal, authorizedAmount)
amountToReleaseCents = max(authorizedAmount - finalCustomerTotal, 0)
additionalPaymentRequiredCents = max(finalCustomerTotal - authorizedAmount, 0)
settlementStatus = settled | needs_attention
```

Estimado y costo definitivo son campos distintos. El evento final del
proveedor simulado provoca cierre y recibo sin accion humana:

| Costo final | Total | Pago inicial simulado | Liberado | Adicional |
| --- | --- | --- | --- | --- |
| $20.00 | $24.50 | $24.50 | $7.50 | $0 |
| $25.00 | $29.50 | $29.50 | $2.50 | $0 |
| $27.50 | $32.00 | $32.00 | $0 | $0 |
| $35.00 | $39.50 | $32.00 | $0 | $7.50 |

Los IDs de evento procesados, entregas duplicadas, intento de reserva y
operacion de cierre se persisten. Repetir el evento, incluso con otro ID,
no vuelve a cerrar ni a cobrar. `settlementCount` permanece en uno.
Los eventos de intentos anteriores no reanudan viajes terminados.

Si falta dinero: `needs_attention` y `additional_payment_required`; nunca
hay segundo cobro automatico. El cliente debe autorizar expresamente el
importe adicional exacto desde seguimiento. Solo entonces el supervisor
puede aprobar un pago adicional de prueba, con otra clave idempotente, y
marcar la excepcion resuelta. El pago inicial no se repite ni supera su
autorizacion. Todo sigue siendo ficticio.

Decision de producto conservada: **cancelar elimina la coordinacion**.
Se simula solo el cargo del proveedor, limitado al monto autorizado.
Se distingue cancelacion gratuita de cargo ficticio, sin afirmar confirmacion
de Lyft. No se permite cancelar despues de recoger al pasajero ni despues
de completar/cerrar; una excepcion no elimina esta proteccion.

El recibo muestra costo final proveedor, coordinacion, cargo de cancelacion
si existe, total, pago de prueba, saldo liberado y estado del pago. No muestra
terminologia tecnica de integracion al cliente.

## Supervisar excepciones

Viajes activos y finalizados son solo lectura. Ante excepciones:

- No hay conductor o error de reserva: reintento seguro con el pago autorizado,
  sin una reserva previa y usando un nuevo intento.
- Pago rechazado: el cliente puede reintentar; nunca se reserva sin pago.
- Costo excesivo: consentimiento adicional del cliente antes de aprobar.
- Falta de evento final: timeout, sin inventar costo ni cerrar a mano.
  Un evento final tardio valido puede completar el cierre automaticamente.
- Error procesando evento o migracion insegura: se conserva para revision.
  No hay un boton generico para cambiar estados ni inventar pagos.
- Contactar cliente solo registra una nota local; no llama ni envia mensajes.
- Cancelar solo cuando sea seguro. Resolver solo cuando el pago adicional
  consentido ya se haya aprobado; no oculta problemas financieros pendientes.

Registrar un contacto o reintentar marca intervencion humana. Detectar un
error automaticamente no la marca por si solo.

## Escenarios de desarrollo

En **Opciones de desarrollo - Solo simulacion**, antes de crear la cotizacion:

- Normal.
- Ningun conductor disponible (primer intento; reintento exitoso).
- Pago rechazado (primer intento; reintento exitoso).
- Cancelacion gratuita o con cargo ficticio de $5.00.
- Final menor ($20.00).
- Mayor dentro de autorizacion ($27.50).
- Superior a autorizacion ($35.00).
- Evento final duplicado (un cierre, duplicado contabilizado).
- Falta de evento final (timeout).
- Error al reservar (primer intento).
- Error al procesar evento.

No hay simuladores escondidos que llamen a servicios reales.

## Metricas y sostenibilidad

Automatico se define exactamente como:

```ts
requestChannel === "web"
  && operatorInterventionRequired === false
  && status === "settled"
```

Denominador: todas las solicitudes de la sesion, incluidas las pendientes.
Meta >=90%. Cerrado sin intervencion usa solo finalizados/cancelados.
Se conservan promedio proveedor ($25-$30), intervencion, coordinacion
efectivamente pagada, procesamiento estimado, contribucion, cancelaciones,
viajes por dia, proyeccion mensual actual y de 100 viajes diarios (3000/mes).
Pagos adicionales consentidos se cuentan una sola vez, con su estimacion
de procesamiento propia. Las retenciones liberadas nunca son ingresos.
Proyecciones usan viajes liquidados no cancelados y no garantizan resultados.

Tambien: excepciones acumuladas, bloqueados actuales en needs_attention,
promedio desde inicio de pago hasta reserva y conductor asignado,
y webhooks simulados duplicados ignorados.

Reserva sugerida = round(pagos simulados totales * 200 / 10000).

**Reserva operativa sugerida; no representa fondos separados automáticamente.**

El panel "¿Es sostenible el 10%?" resume volumen, promedio, automatizacion,
contribucion y estado general. Verde cumple, ambar requiere atencion,
rojo es insuficiente. Son indicadores informativos; no bloquean viajes.

## Persistencia y migracion

Exclusivamente sessionStorage, version 4. Se conserva la clave historica
`recogido.rides.demo.v1` para encontrar versiones anteriores.
No se usa localStorage, cookies financieras, BD ni API.

- v1/v2 conservan IDs, datos del pasajero, horarios y referencias ficticias.
- v3 conserva estados, autorizaciones, cierre, intentos y claves idempotentes.
  Se agregan eventos solo para horas historicas conocidas (creacion, inicio
  de pago, reserva, asignacion, finalizacion y cierre). No se inventan horas
  para llegada de conductor/destino ni autorizaciones anteriores; se indica
  cuando una etapa completada no tiene hora historica. ETA antigua es nula.
- Cotizaciones antiguas requieren nueva aceptacion para iniciar el nuevo flujo.
- Autorizaciones y cierres v2 validos conservan sus importes, incluida reserva
  configurada anteriormente. No se fabrica una autorizacion para viajes v1.
- Viajes avanzados que no pueden reanudarse con seguridad pasan a
  needs_attention/migration, sin generar reservas ni cargos nuevos.
- JSON/esquema corrupto se recupera con aviso; registros invalidos o duplicados
  se descartan individualmente conservando los validos.
- Fallos de almacenamiento son visibles; no se anuncia exito sin persistir.
- Reiniciar elimina solo la clave Rides, previa confirmacion.

No hay sincronizacion entre pestanas ni garantia contable de produccion.
No ingresar ni migrar datos reales.

## Arquitectura futura, no implementada

En produccion:

- `PaymentGateway` sera Stripe, exclusivamente en servidor.
- `RideProvider` sera Lyft Concierge, exclusivamente en servidor.
- `RideEventProcessor` recibira webhooks con firma verificada.
- El navegador consultara unicamente el backend de Recogido para obtener
  eventos y ETA; nunca se conectara directamente al proveedor. No se
  implementan webhooks reales ni polling HTTP en esta fase.
- Los secretos viviran exclusivamente en el servidor.
- Webhooks y operaciones usaran idempotencia **persistente** y transacciones
  atomicas en almacenamiento servidor, incluyendo reintentos concurrentes.
- El navegador nunca decidira importes ni estados financieros.
- El servidor verificara consentimiento, autorizacion, cargos, facturas,
  timeout, reintentos y pagos adicionales. No confiar en sessionStorage.

Estas son interfaces y responsabilidades previstas, no integraciones ya
conectadas. El demo no tiene garantias de dinero real ni procesa tarjetas.

## Validacion

```sh
npm run lint
npx tsc --noEmit
npm run build
npm run test:rides
```

La suite Rides prueba recorrido automatico, bloqueos centrales, cierre
normal/menor/igual/mayor, limites, cancelaciones, duplicados y cierre unico,
timeout y evento tardio, errores/reintentos, pago rechazado, metricas,
consentimiento adicional, migracion, corrupcion y aislamiento sin red.
Incluye nueve etapas, alias publicos, eventos unicos, horas persistidas,
estados de llegada/recogida, excepciones separadas, aria-current/anuncios,
movimiento reducido, tarjeta de conductor y placeholder sin red.
Las suites existentes con proveedores mock verifican regresiones de API,
Dispatch, conductores, PWA y ordering; no usar pruebas de integracion privada.
