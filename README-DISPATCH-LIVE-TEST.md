# Prueba piloto de Dispatch con Twilio

Esta guía describe el modo híbrido para validar la web sólo con el restaurante
`restaurant-test`. No se habilitó la bandera, no se desplegaron Twilio Functions
y no se contactaron Twilio ni Make durante la implementación.

## Límites de seguridad y activación

- `DISPATCH_MOCK_MODE=true` permanece como configuración base.
- La integración real sólo se selecciona si `DISPATCH_LIVE_TEST_ENABLED=true`
  **y** el ID autenticado es exactamente `restaurant-test`. El servidor también
  exige que `DISPATCH_LIVE_TEST_RESTAURANT_ID` conserve ese valor fijo.
- Los demás restaurantes siguen usando Mock Mode, sin importar la bandera.
- El teléfono del piloto se fija en el servidor. El navegador no puede elegir el
  teléfono, el ID de solicitud ni una URL upstream.
- El backend consulta la configuración central y rechaza un perfil piloto que
  no sea individual, máximo 3 entregas y máximo 1 entrega activa por conductor.
- Cada API web requiere la autenticación de restaurante existente. Las llamadas
  a Twilio/Make sólo salen desde el adaptador server-only.
- No poner ninguna variable `TWILIO_WEB_*` o `MAKE_TIMER_*` bajo `NEXT_PUBLIC_`.

La bandera se mantiene en `false` en `.env.example`. Para activar manualmente
una prueba local, configura las variables sólo en el entorno privado de
desarrollo y reinicia Next.js. No habilites producción ni Preview hasta completar
los bloqueos de esta guía y las pruebas manuales descritas abajo.

## Variables de entorno del piloto

Todos los nombres ya están en `.env.example`; los valores privados deben
configurarse en el gestor de secretos del entorno, nunca en el repositorio.

| Variable | Requerida | Uso |
| --- | --- | --- |
| `DISPATCH_MOCK_MODE` | Sí | Mantener `true`; el piloto es una excepción por restaurante, no un apagado general del mock. |
| `DISPATCH_LIVE_TEST_ENABLED` | No / por defecto desactivada | Debe ser exactamente `true` para habilitar la excepción únicamente a `restaurant-test`. |
| `DISPATCH_LIVE_TEST_RESTAURANT_ID` | Sí para habilitar | Mantener exactamente `restaurant-test`; el código no permite ampliar la allowlist mediante esta variable. |
| `TWILIO_WEB_CONFIG_URL` | Sí | Twilio Function autenticada que consulta el perfil desde Sync Map `restaurants`. |
| `TWILIO_WEB_CREATE_URL` | Sí | Twilio Function para crear la solicitud web. |
| `TWILIO_WEB_STATUS_URL` | Sí | Twilio Function para consultar una solicitud propia o la solicitud activa. |
| `TWILIO_WEB_CANCEL_URL` | No | Opcional en el piloto inicial; cancelación web deshabilitada hasta configurarla. |
| `TWILIO_WEB_RESEND_URL` | No | Opcional en el piloto inicial; reoferta web deshabilitada hasta configurarla. |
| `TWILIO_WEB_HISTORY_URL` | No | Opcional en el piloto inicial; el historial real no se consulta hasta configurarla. |
| `TWILIO_WEB_AUTH_USERNAME` | Sí | Usuario de autenticación servidor a servidor. |
| `TWILIO_WEB_AUTH_PASSWORD` | Sí | Contraseña de autenticación servidor a servidor. |
| `MAKE_TIMER_WEBHOOK_URL` | Sí para crear/reofertar | Webhook privado que inicia el timer una vez por la solicitud principal/generación. |
| `MAKE_TIMER_SECRET` | Sí para crear/reofertar | Secreto independiente enviado sólo al webhook de Make. |
| `DISPATCH_REQUEST_TIMEOUT_MS` | Opcional | Timeout de cada llamada externa, entero de 1 a 10000 ms. |

Las variables `RECOGIDO_DISPATCH_*` son el conjunto de integración anterior y
no habilitan este piloto. No copies credenciales antiguas ni uses secretos de
Twilio directamente como secreto de la web. `.env.example` conserva URLs,
usuario y secretos vacíos y un PIN de reemplazo para desarrollo.

## Contrato de las seis Twilio Functions

Las seis Functions indicadas aquí son contratos de implementación, no código
desplegable. Este repositorio no incluye el código fuente actual de las Twilio
Functions, el esquema completo de Sync ni una capa central reutilizable. Por
ello, no se debe recrear ni desplegar aquí una segunda implementación del
algoritmo de despacho. Las Functions de web deben llamar a la lógica central
existente y validar que cada operación se limite al restaurante solicitado.

Todas reciben `POST` con `application/x-www-form-urlencoded`, autenticación
HTTP Basic servidor a servidor y deben responder JSON con `success: true` y el
`restaurantId` validado. El adaptador rechaza redirects, usa `cache: "no-store"`
y timeout, valida/proyecta las respuestas y sanitiza errores. La credencial no
debe reflejarse en respuestas o logs.

| Contrato | Campos de formulario | Resultado mínimo |
| --- | --- | --- |
| [Configuración](docs/twilio-functions/web-config.md) | `restaurantId` | `restaurant: { restaurantId, name, active, deliveryEnabled, maxDeliveries, assignmentMode, maxActiveDeliveriesPerDriver }` |
| [Crear solicitud](docs/twilio-functions/web-create.md) | `restaurantId`, `restaurantName`, `restaurantPhone`, `deliveryCount`, `requestId`, `idempotencyKey` | Una raíz batch o una raíz parent con N hijos; incluir estado y datos de asignación disponibles. |
| [Consultar estado](docs/twilio-functions/web-status.md) | `restaurantId`, `requestId` (vacío para solicitud activa) | `request` de ese restaurante o `request: null`. |
| [Cancelar](docs/twilio-functions/web-cancel.md) | `restaurantId`, `requestId` | Estado actualizado; nunca cancelar hijos ya asignados. |
| [Reofertar](docs/twilio-functions/web-resend.md) | `restaurantId`, `requestId`, `openRequestIds` (IDs separados por coma) | Estado actualizado; enviar únicamente los IDs abiertos validados por el backend. |
| [Historial](docs/twilio-functions/web-history.md) | `restaurantId` | `requests` con cero a cinco raíces pertenecientes al restaurante. |

Para todos los endpoints que reciben `requestId`, validar el ID raíz
`WEB_<32 caracteres hexadecimales>`, cargar la raíz y verificar la pertenencia
antes de leer o mutar datos. No confiar en IDs hijos, número de entregas,
teléfonos, modalidad o estado que provengan del navegador.

### Respuesta normalizada

La raíz devuelta debe incluir `requestId`, `requestType` (`batch` o `parent`),
`parentRequestId`, `deliveryCount`, `totalDeliveries`, `assignedDeliveries`,
`remainingDeliveries`, `assignmentMode`, `status`, `createdAt` y, cuando sea
individual, `childRequestIds` y `deliveries`. Cada elemento de `deliveries`
incluye `requestId`, `deliveryNumber`, `status` (`open`, `claimed`, `cancelled`
o `closed`) y opcionalmente `driverName` y `assignedAt`. No devolver el teléfono
del conductor. Los estados raíz reconocidos son `open`,
`partially_claimed`, `claimed`, `fully_assigned`, `cancelled` y `closed`.

### Idempotencia y temporizador

El servidor genera un ID determinista `WEB_<32 hex>` a partir del restaurante y
la clave de idempotencia para conservar el ID ante reintentos. Eso **no**
garantiza por sí solo que la operación sea idempotente entre instancias,
despliegues o reinicios. Antes de habilitar el piloto, la Function de creación
debe guardar y comprobar atómicamente una clave persistente en Sync (o un
almacén transaccional ya usado por el despacho), asociada al restaurante,
request ID y cantidad. La misma clave/cantidad devuelve la raíz original; la
misma clave con distinta cantidad devuelve conflicto y jamás crea otra oferta.

Después de crear con éxito, la aplicación envía al webhook de Make una sola
llamada por ID raíz con `requestId`, `restaurantId`, `restaurantPhone`,
`deliveryCount`, `timerGeneration` y el secreto `MAKE_TIMER_SECRET`; también
envía `Idempotency-Key: <requestId>:<timerGeneration>`. En una reoferta envía
sólo el conjunto de hijos abiertos y una nueva generación. La aplicación
recuerda llamadas dentro de un proceso, pero Make debe deduplicar de forma
persistente: esa protección en memoria no cubre múltiples instancias ni
reinicios. Nunca crear un timer por cada hijo.

## Bloqueos antes de habilitar

1. Obtener del responsable de Twilio el código actual de creación y compartir
   su lógica central con las Functions web, en lugar de copiarla.
2. Confirmar el mecanismo de autenticación Basic en el runtime concreto de
   Twilio Functions; comprobar el formato de headers, comparación de secretos
   constante-tiempo y que el secreto no se escriba en logs.
3. Acordar el formato real de los registros y transiciones en Sync para raíz,
   hijos, asignaciones y claves de idempotencia.
4. Para el piloto inicial, implementar y probar CONFIG, CREATE y STATUS con
   verificación de ownership. CANCEL, RESEND e HISTORY son opcionales y la web
   los mantiene deshabilitados hasta que estén configurados.
5. Hacer que Make deduplique persistentemente los timers de raíz/generación.
6. Probar en un entorno no productivo: perfil permitido, creación individual,
   doble envío/reintento, asignación progresiva, status, timeouts y respuestas
   inválidas. Probar cancelación, reoferta e historial sólo cuando se implementen
   sus Functions opcionales.
7. Confirmar la configuración privada de `restaurant-test` y su PIN mediante
   un canal seguro. No usar el PIN de reemplazo de `.env.example`.
8. Ejecutar `npm run test:dispatch:adapter`, `npm run lint`,
   `npx tsc --noEmit` y `npm run build` con bandera apagada antes de preparar
   el despliegue.

El fallback es inmediato: fija `DISPATCH_LIVE_TEST_ENABLED=false` y reinicia el
servidor. No cambies `DISPATCH_MOCK_MODE` a `false` para retirar el piloto.

## Qué está validado en el repositorio

Las pruebas de adaptador simulan Twilio y Make con `fetch` falso; verifican el
allowlist, perfil, autenticación upstream, ID estable, una invocación del timer,
aislamiento de restaurante, estados parciales, cancelación/reoferta y errores.
No prueban Twilio, Sync, WhatsApp ni Make reales. La interfaz y todos los
restaurantes distintos de `restaurant-test` siguen usando los contratos mock.

No se modificó la landing pública ni el flujo telefónico existente.
