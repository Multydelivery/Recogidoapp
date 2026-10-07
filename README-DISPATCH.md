# Recogido Dispatch — fase 2 (solo simulación)

La página pública `/` y el demo original `/dispatch/demo` siguen disponibles.
**Twilio y Make NO están conectados. No hay SMS, llamadas, ofertas reales ni APIs externas.**

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
| `DISPATCH_MOCK_MODE` | `true`. Si se omite, el modo simulado es el único habilitado. Cualquier otro valor devuelve 503; el modo real no está implementado. |
| `RESTAURANTS_JSON` | Lista JSON de restaurantes: `slug`, `name`, `phone` en formato internacional y `deviceToken` (6–128 caracteres alfanuméricos, `_` o `-`). |

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
