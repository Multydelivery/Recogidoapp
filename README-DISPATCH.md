# Recogido Dispatch — fase 3 (adaptador preparado, demostración activa)

La página pública `/` y el demo original `/dispatch/demo` siguen disponibles.
**Twilio y Make NO están conectados. La configuración local sigue en
`DISPATCH_MOCK_MODE=true`: no hay SMS, llamadas, ofertas reales ni llamadas externas.**
El adaptador real está preparado para pruebas controladas, no activado.

## Configuración local

El proyecto usa Next.js App Router, TypeScript y Tailwind CSS 4. No se requieren
dependencias adicionales.

1. Si aún no existen las dependencias, ejecuta `npm install`.
2. Copia `.env.example` a `.env.local` en la raíz (PowerShell):

   ```powershell
   Copy-Item .env.example .env.local
   ```

   No sobrescribas una configuración local existente sin revisarla.
3. Ejecuta `npm run dev` y abre las URLs de abajo.
4. Reinicia el servidor cuando cambies las variables de entorno.

Variables exclusivamente del servidor (no usar el prefijo `NEXT_PUBLIC_`):

| Variable | Contenido |
| --- | --- |
| `DISPATCH_MOCK_MODE` | Mantener `true`. Si se omite, se usa demo. `false` selecciona el adaptador central; cualquier otro valor devuelve 503. |
| `RESTAURANTS_JSON` | Lista JSON de restaurantes: `slug`, `name`, `phone` en formato internacional y `deviceToken` (6–128 caracteres alfanuméricos, `_` o `-`). |
| `RECOGIDO_DISPATCH_SUBMIT_URL` | URL HTTPS privada de la Twilio Function central para crear solicitudes. Vacía en el ejemplo. |
| `RECOGIDO_DISPATCH_MANAGE_URL` | URL HTTPS privada de la Function central para cancelar. Vacía en el ejemplo. |
| `RECOGIDO_DISPATCH_STATUS_URL` | URL HTTPS privada de la Function central para consultar estado mediante POST. Vacía en el ejemplo. |
| `RECOGIDO_DISPATCH_API_SECRET` | Secreto servidor a servidor. Vacío en el ejemplo. Nunca usar `NEXT_PUBLIC_`. |
| `DISPATCH_REQUEST_TIMEOUT_MS` | `10000` por defecto; entero entre 1 y 10000 ms. Se limita para caber en el timeout de 15 s del navegador. |

Las URLs no admiten usuario, contraseña, query ni fragmento. El secreto se envía
solo en el cuerpo form-urlencoded. Redirecciones externas están bloqueadas.
Las tres API Routes validan toda la configuración real al empezar cada petición
si `mock=false`. En demo no necesitan estas URLs ni el secreto.

La configuración se valida en el servidor. No hay valores de restaurantes
predeterminados ocultos: si falta o es inválida, se muestra un error de configuración.
El slug `demo` está reservado. Los nombres y teléfonos no se aceptan del navegador.
El teléfono se conserva solo en el servidor; ningún PIN o token se serializa en
las páginas ni se devuelve en las respuestas de la API.

Los teléfonos y PINs de `.env.example` son **datos ficticios y públicos de prueba**.
No son credenciales de producción. `.env.local` está ignorado por Git.

## URLs y PINs de demostración

| URL | PIN de prueba |
| --- | --- |
| http://localhost:3000/dispatch/la-fonda | `111111` |
| http://localhost:3000/dispatch/brisas | `222222` |
| http://localhost:3000/dispatch/jade-lee | `333333` |
| http://localhost:3000/dispatch/demo | No necesita PIN; demo original sin API |

Al abrir un terminal, introduce su PIN. Se valida con `GET /api/dispatch/status`
antes de habilitar el teclado. Solo tras validarlo se guarda en localStorage,
separado por restaurante. Al recargar, se valida de nuevo y se recuperan la última
solicitud y el historial del servidor. Un 401 invalida el acceso local.

El token viaja en `Authorization: Bearer <PIN>`; nunca en el cuerpo o la URL.
Usa exclusivamente dispositivos de confianza. LocalStorage es legible por
JavaScript del mismo origen: **esta fase no es una autenticación de producción**.
Para olvidar un dispositivo, elimina la clave
`recogido.dispatch.device.<slug>` en las herramientas del navegador.

## API simulada

Todas las respuestas tienen `Cache-Control: no-store`.

### POST /api/dispatch/request

Encabezados: `Content-Type: application/json` y `Authorization: Bearer <PIN>`.

```json
{
  "restaurant": "la-fonda",
  "deliveryCount": 2,
  "idempotencyKey": "ejemplo-clave-unica-0001"
}
```

La cantidad debe ser un entero de 1 a 9. La clave debe tener 8–128 caracteres
alfanuméricos, `_` o `-`. El terminal usa `crypto.randomUUID()` y reutiliza
la misma clave para reintentar una operación no confirmada con la misma cantidad.

Devuelve 201 para una nueva solicitud y 200 para el reenvío idempotente.
El identificador tiene formato `WEB_[timestamp]_[random]`, con 16 caracteres
hexadecimales aleatorios. La idempotencia está separada por restaurante:
misma clave y cantidad devuelve la solicitud original, aunque esté cancelada.
La misma clave con otra cantidad devuelve 409. Otra clave mientras hay una
solicitud abierta también devuelve 409 (incluye protección entre pestañas).

### GET /api/dispatch/status?restaurant=la-fonda

Requiere el mismo encabezado de autorización. Sirve también para validar el
dispositivo sin crear solicitudes. Opcionalmente acepta `requestId=WEB_...`.
Solo permite consultar solicitudes del restaurante autenticado.

Formato público de respuesta para las tres operaciones:

```json
{
  "mockMode": true,
  "restaurant": { "slug": "la-fonda", "name": "La Fonda Demo" },
  "request": {
    "requestId": "WEB_1791335440739_0123456789abcdef",
    "deliveryCount": 2,
    "status": "pending",
    "createdAt": "2026-10-07T01:10:40.739Z"
  },
  "history": []
}
```

Si no hay solicitudes, `request` es `null`. `history` contiene como máximo las
últimas cinco del día (según la hora local del servidor), más reciente primero.
Cuando se asigna, la solicitud incluye `driverName: "Conductor Demo"`.

Los estados se calculan desde `createdAt` en el servidor, sin temporizadores:

| Tiempo transcurrido | Estado |
| --- | --- |
| 0–menos de 5 s | `pending` |
| 5–menos de 10 s | `offer_sent` |
| 10–menos de 20 s | `searching` |
| 20 s o más | `claimed` |

El terminal hace polling cada **5 segundos**, evita consultas superpuestas,
descarta respuestas obsoletas durante operaciones y limpia polling/reloj y
aborta peticiones al desmontarse. Una red lenta puede hacer que un estado
intermedio no se vea. La API es la autoridad de estado y cancelación.

### POST /api/dispatch/cancel

```json
{
  "restaurant": "la-fonda",
  "requestId": "WEB_1791335440739_0123456789abcdef"
}
```

Requiere los mismos encabezados. Solo cancela `pending`, `offer_sent` o
`searching`. Comprueba el tiempo del servidor antes de cancelar: tras 20 s
devuelve 409 aunque el navegador aún muestre buscando. Repetir una cancelación
ya confirmada devuelve el mismo estado `cancelled`. Nunca permite cancelar
una solicitud de otro restaurante.

Errores JSON: `{ "error": "mensaje" }`. Códigos: 400 entrada inválida o campos
extra (incluido nombre/teléfono), 401 PIN inválido, 404 solicitud no encontrada,
409 conflicto, 413 cuerpo demasiado grande, 415 tipo no JSON y 503 configuración,
modo no admitido o capacidad agotada.

## Arquitectura de fase 3

```text
Tableta → API Route de Vercel → Twilio Function central
                                → Twilio Sync + WhatsApp
                                → Make → alerta después de 20 segundos
```

Este es el **flujo futuro**. Vercel no llama Make; los 20 segundos de alerta
se implementarán en el backend central, no con temporizadores en la web.
`src/lib/dispatch/recogido-api.ts` es server-only. Exporta
`submitDeliveryRequest`, `cancelDeliveryRequest` y `getDeliveryRequestStatus`.
Usa fetch POST form-urlencoded, `cache: "no-store"` y AbortController
con timeout que incluye la lectura de JSON. No hace reintentos automáticos.

Los errores son tipados (`RecogidoApiError`: configuration, timeout, network,
http, invalid_response, rejected), con un mensaje fijo seguro y una propiedad
`retryable`. Un timeout devuelve 504; fallos de red, HTTP upstream o protocolo
devuelven 502 salvo 404/409, que conservan su significado. No se devuelven
mensajes externos ni se registran cuerpos, URLs o secretos. Los logs solo
incluyen operación, requestId (o `latest` antes de conocerlo) y resultado/código.

### Contrato que deben implementar las Twilio Functions

Este contrato fue elegido para evitar almacenar solicitudes reales en la
memoria efímera de Vercel. **Debe implementarse y verificarse antes de activar
el modo real.**

Los tres endpoints validan `secret` y utilizan `restaurantId` como identificador
del restaurante. Aquí es el `slug` de RESTAURANTS_JSON.

| Operación | Campos enviados por Vercel |
| --- | --- |
| Submit | `restaurantId`, `restaurantName`, `restaurantPhone`, `deliveryCount`, `requestId`, `idempotencyKey`, `secret` |
| Cancel | `action=cancel`, `restaurantId`, `requestId`, `secret` |
| Status | `restaurantId`, `requestId`, `secret` (POST; nunca secreto en query) |

Nombre y teléfono salen de la configuración segura del servidor, nunca del
navegador. En submit Vercel propone un ID `WEB_[timestamp]_[random]`, pero la
Function central debe guardar de forma **atómica y persistente** la relación
`restaurantId + idempotencyKey → solicitud canónica` en un almacén compartido.
Un reintento conserva la clave, aunque otra instancia de Vercel proponga otro
requestId: el backend debe devolver el ID original y no repetir mensajes
WhatsApp, ofertas ni acciones de Make. Misma clave con otra cantidad y nuevas
claves cuando ya hay una solicitud abierta deben devolver 409.

Para status sin requestId, Vercel envía el campo vacío. La Function debe
devolver la última solicitud del restaurante o, si no existe:

```json
{ "success": true, "restaurantId": "la-fonda", "request": null }
```

Esto permite validar el dispositivo y recuperar el estado al recargar sin
guardar solicitudes reales en Vercel. `request: null` solo es válido para
consultas sin ID; no constituye éxito de submit o cancel.

Para una solicitud, la respuesta externa es plana:

```json
{
  "success": true,
  "restaurantId": "la-fonda",
  "requestId": "WEB_1791338715017_9f67c567ff85f8c0",
  "status": "searching",
  "deliveryCount": 2,
  "createdAt": "2026-10-07T02:05:15.017Z",
  "updatedAt": "2026-10-07T02:05:25.017Z"
}
```

`restaurantId` es obligatorio para comprobar pertenencia. En consultas por ID
y cancelaciones, también se exige que el ID devuelto coincida exactamente.
La Function **debe verificar la pertenencia en el servidor** antes de leer
o modificar y cancelar atómicamente solo pending, offer_sent o searching:
una asignación concurrente debe producir 409. Vercel hace además una consulta
previa al cancel, pero esa comprobación no sustituye la validación atómica central.

El adaptador normaliza a `{ success, requestId, status, restaurantName?,
deliveryCount?, driverName?, driverPhone?, createdAt?, updatedAt?, message? }`.
Admite únicamente pending, offer_sent, searching, claimed, cancelled o error.
`deliveryCount` y `createdAt` son obligatorios para presentar la solicitud en el
terminal; una respuesta incompleta falla explícitamente. Los campos adicionales
no se pasan al navegador. El mensaje externo se descarta; un estado error
produce un mensaje seguro. El teléfono del conductor, si existe, se valida,
pero tampoco se expone en la respuesta pública actual.

La API pública conserva `{ mockMode, restaurant, request, history }` para
no romper los componentes. En modo real el historial contiene la solicitud
consultada; el terminal acumula hasta cinco solicitudes vistas en la sesión.
Al recargar recupera la última solicitud, no un historial persistente completo.

### Mock frente a modo real

- **Mock=true:** mismo almacén, tiempos, polling y cancelación de fase 2;
  cero fetch externo. El demo original continúa siempre en demostración.
- **Mock=false:** solo estados confirmados por la Function central; no avance
  por tiempo ni temporizadores simulados. Idempotencia, propiedad y cancelación
  definitiva son responsabilidad del backend central.
- Indicador: “Modo de demostración” en demo, “Sistema conectado” tras una
  respuesta válida en modo real y “Sin conexión” si falla una consulta.
  Antes de validar muestra “Sin verificar”, sin variables ni endpoints.

### Probar sin Twilio

Con Node.js 22.15+ (o 24), usa el runner node:test ya existente:

```powershell
npm run test:dispatch:adapter
```

No necesita URLs reales ni `.env.local`; configura variables ficticias solo
en el proceso de prueba e intercepta todo fetch. El loader de prueba usa
TypeScript ya instalado; no añade dependencias y no forma parte del bundle.
Prueba modo mock sin llamadas externas, las tres rutas sin configuración real,
timeout, red, HTTP 500, JSON inválido, normalización, pertenencia,
reintentos idempotentes y ausencia de secretos en respuestas y logs.

Para probar la tableta normalmente, conserva `DISPATCH_MOCK_MODE=true`,
ejecuta `npm run dev` y usa las URLs/PINs de arriba.

### Checklist antes de activar producción

- [ ] Crear/configurar las tres Twilio Functions HTTPS centrales y su secreto.
- [ ] Implementar y probar el contrato anterior, incluida consulta sin requestId.
- [ ] Usar almacenamiento compartido/persistente (Twilio Sync u otro) con
  idempotencia atómica, aislamiento y cancelación frente a asignación concurrente.
- [ ] Integrar WhatsApp y Make exclusivamente desde el backend central y probar
  la alerta de 20 s, sin duplicaciones ante reintentos.
- [ ] Sustituir PINs y teléfonos ficticios, endurecer autenticación del dispositivo,
  limitar intentos y verificar HTTPS, permisos y ciclo de vida de credenciales.
- [ ] Configurar las variables privadas en un entorno de preview aislado de Vercel.
- [ ] Ejecutar pruebas de contrato y revisión operativa con un restaurante controlado,
  incluyendo errores, caídas de red, timeouts y dos pestañas concurrentes.
- [ ] Solo después, cambiar el modo a false **en ese entorno controlado** y desplegar.
- [ ] Mantener rollback a true y verificar que no se repitan operaciones ya enviadas.

**No cambies DISPATCH_MOCK_MODE a false hasta configurar y validar las Twilio
Functions. Este trabajo no crea ni conecta Functions, Sync, WhatsApp o Make.**

## Sistema visual compartido

Dispatch reutiliza el logo `public/recogidoapplogo.png`, las fuentes Geist y
Geist Mono y la paleta de la página pública: turquesa `#14b8ab` (hover
`#0e9488`), azul marino `#0d2748`, blanco y superficie `#f4f6f9`.
Las variables semánticas `--brand-*` en `src/app/globals.css` apuntan a los
colores existentes sin modificar la página pública. Los bordes y fondos suaves
se derivan de esos colores, sin una segunda paleta.

El terminal usa los radios y sombras de Tailwind 4 (`rounded-2xl`,
`rounded-3xl`, `shadow-sm`) y botones principales tipo píldora, conservando
alturas táctiles de al menos 64 px. El texto azul marino de 19 px en negrita sobre el botón turquesa
es una adaptación de contraste respecto al texto blanco del sitio público,
incluyendo el estado hover.
Verde confirma, ámbar indica solicitudes pendientes y rojo indica cancelación
o error; todos los estados conservan mensajes textuales.

## Persistencia y límites

El simulador mantiene solicitudes e idempotencia **en memoria de un único proceso
Node.js**, hasta 24 horas, con un máximo de 5000 solicitudes. Reiniciar el servidor
borra ambas cosas. No hay base de datos ni almacenamiento persistente de solicitudes.
El PIN sí se guarda en el navegador, como se pidió para esta fase.

No desplegar este almacén como servicio real: varias instancias o funciones
serverless no comparten memoria ni garantizan idempotencia. La siguiente fase
necesitará un almacén compartido, autenticación de dispositivos endurecida,
protección contra intentos de PIN y HTTPS antes de cualquier integración real.

## Pruebas

Prueba manual:

1. Verifica que `/` y `/dispatch/demo` siguen funcionando.
2. En `/dispatch/la-fonda`, introduce un PIN erróneo: el teclado no debe habilitarse.
3. Introduce `111111`, selecciona dos entregas y pulsa enviar dos veces.
4. Comprueba un solo request ID y los estados en 0, 5, 10 y 20 segundos.
5. Repite y cancela antes de la asignación; confirma y verifica `cancelled`.
6. Tras `claimed`, el botón de cancelar debe estar desactivado.
7. Pulsa nueva solicitud y espera más de 5 s: debe permanecer el teclado.
8. Recarga: se valida el PIN guardado y se recupera la última solicitud.
9. Abre Brisas o Jade Lee: deben pedir su propio PIN y tener historial separado.
10. Inspecciona respuestas y HTML: no deben contener tokens ni teléfonos.

Pruebas automatizadas de integración (Node.js 22+):

Con el servidor local corriendo y `.env.local` configurado como el ejemplo:

```powershell
npm run test:dispatch
```

Estas pruebas **crean y cancelan solicitudes ficticias** de los tres restaurantes.
Úsalas solo en modo simulado, no en una sesión de demostración que quieras conservar.
Cubren validación, autenticación, aislamiento, respuestas sin tokens/teléfonos,
envíos concurrentes idempotentes, todos los estados, cancelación temprana/tardía
y límite de historial. Tardan aproximadamente 40 segundos.
Para otro puerto, establece `DISPATCH_TEST_BASE_URL` antes de ejecutarlas.

Validaciones:

```powershell
npm run lint
npx tsc --noEmit
npm run build
npm run start
```

**Confirmación: Twilio y Make todavía no están conectados. Todo el flujo es simulado.**
