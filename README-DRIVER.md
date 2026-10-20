# Recogido Driver (demo y conductores privados)

Interfaz móvil para conductores disponible en:

- URL local: `http://localhost:3000/driver/demo`
- Ruta: `/driver/demo`

## Alcance

- **Funciona solamente en modo demostración.** No tiene autenticación y no se indexa.
- **No está conectada con Twilio, Make ni WhatsApp.** No realiza llamadas de red ni
  lee variables de entorno.
- **Las ofertas, los estados y los tiempos son simulados.** La conductora del demo es
  Maria Elizabeth; su teléfono no existe en el demo ni se muestra.
- El historial (últimas cinco entregas completadas) se mantiene **solo en memoria**
  durante la sesión del navegador y se pierde al recargar. No se mezcla con datos reales.
- Nunca se muestran `requestId` internos que empiezan por `WEB`; la interfaz usa el
  número corto de orden (`#E814C7-01`).

## Flujo

1. **Ofertas**: `TOMAR ENTREGA` (respuesta simulada de ~700 ms, sin doble aceptación) o
   `NO DISPONIBLE` (rechaza la oferta).
2. **Entrega activa**: `CONFIRMAR RECOGIDA` → estado `picked_up` (En camino) →
   `COMPLETAR ENTREGA` con diálogo de confirmación → `completed`.
3. **Historial**: horas de asignación, recogida y finalización, y duración total.

Reglas simuladas (sin autorizaciones especiales del restaurante todavía):

- Máximo **1 entrega activa por restaurante** (`la-fonda-englewood`, `brisas-englewood`,
  `jade-lee-englewood`) y máximo **3 entregas activas en total**.
- Cuentan como activas `accepted`, `assigned` y `picked_up`; nunca `completed`,
  `declined` ni `cancelled`.
- Una entrega de un restaurante no bloquea ofertas de otro. Si ya hay una activa del
  mismo restaurante solo se bloquea esa oferta: «Ya tiene una entrega activa de este
  restaurante. Puede aceptar ofertas de otros restaurantes.» Con tres activas se
  bloquean todas: «Alcanzó su capacidad máxima de 3 entregas activas.»
- El encabezado muestra «Capacidad activa: X de 3». Cada entrega activa tiene su propia
  tarjeta y avanza de forma independiente (`assigned` → `picked_up` → `completed`); al
  completarla pasa sola al historial y libera el espacio de su restaurante.

Con el interruptor en «No disponible» no se aceptan ofertas, pero se conservan las
entregas activas. La sección «Controles de demostración» permite simular un error en
la próxima acción.

## Código

- `src/app/driver/demo/page.tsx`: ruta.
- `src/components/driver/`: componentes de interfaz (`DriverDemo`, `DriverHeader`,
  `AvailabilityToggle`, `DriverBottomNavigation`, `AvailableOffers`, `OfferCard`,
  `ActiveDeliveries`, `ActiveDeliveryCard`, `DriverTimeline`, `DriverHistory`,
  `DriverNotification`, `DriverConfirmDialog`) y estilos en `DriverDemo.module.css`.
- `src/lib/driver/driver-types.ts`: tipos (`DriverAvailability`, `DriverOffer`,
  `DriverDelivery`, `DriverDeliveryStatus`, `DriverHistoryItem`, …).
- `src/lib/driver/driver-demo.ts`: datos simulados, reglas de aceptación y reducer puro.

## Pruebas

```powershell
npm run test:driver
npm run lint
npx tsc --noEmit
npm run build
```

## Conductores privados: rutas independientes

- Rutas: `/driver/maria-elizabeth`, `/driver/patricia-castaneda`,
  `/driver/oscar-rojas`, `/driver/ramon-colorado`, o cualquier slug autorizado.
- Reutiliza encabezado, tarjetas, confirmación, navegación y estilos del demo.
  `/driver/demo` sigue siendo exclusivamente simulado y sin red.
- `DRIVERS_JSON` es la única lista server-side de autorización web. No hay
  allowlist de María en el código. `DRIVER_LIVE_TEST_DRIVER_ID` no se consulta.
  Por compatibilidad, `DRIVER_LIVE_TEST_ENABLED=false` conserva un apagado global;
  no es necesario definirla para habilitar perfiles autorizados.
- Cada perfil nuevo requiere `slug`, `driverId`, `name`, `phone`, `deviceToken`,
  `active`. `slug` es la ruta y `driverId` la identidad enviada a Twilio; pueden
  diferir. Ambos son identificadores de hasta 80 caracteres alfanuméricos
  minúsculos separados por guiones. `demo` está reservado.
- Compatibilidad con el registro existente: si solo existe `slug` o `driverId`,
  el otro toma su valor; solo en ese formato legado, omitir `active` equivale a
  `true`. Un `active:false` siempre deniega acceso. Los perfiles nuevos con ambos
  identificadores deben declarar `active` explícitamente.
- Slugs, driverIds y PINs deben ser únicos. Duplicados, JSON inválido o perfiles
  mal formados causan 503 sin llamar a Twilio. No se pasan perfiles privados a
  componentes cliente: solo el slug de la ruta, y tras autenticación los campos
  públicos normalizados. El nombre público proviene del perfil validado.

Formato esperado de `DRIVERS_JSON` (ejemplo ficticio; sustituir los PINs):

```json
[
  {"slug":"maria-elizabeth","driverId":"maria-elizabeth","name":"Maria Elizabeth","phone":"whatsapp:+15550001111","deviceToken":"REEMPLAZAR_PIN_MARIA","active":true},
  {"slug":"patricia-castaneda","driverId":"patricia-castaneda","name":"Patricia Castaneda","phone":"whatsapp:+15550002222","deviceToken":"REEMPLAZAR_PIN_PATRICIA","active":true},
  {"slug":"oscar-rojas","driverId":"oscar-rojas","name":"Oscar Rojas","phone":"whatsapp:+15550003333","deviceToken":"REEMPLAZAR_PIN_OSCAR","active":true},
  {"slug":"ramon-colorado","driverId":"ramon-colorado","name":"Ramon Colorado","phone":"whatsapp:+15550004444","deviceToken":"REEMPLAZAR_PIN_RAMON","active":true}
]
```

- No se modifica `.env.local` automáticamente ni se habilitan estos perfiles por
  tener una ruta. El operador debe agregarlos a la configuración posteriormente.
- Las Functions se configuran mediante `TWILIO_DRIVER_CONFIG_URL`,
  `TWILIO_DRIVER_DASHBOARD_URL`, `TWILIO_DRIVER_ACTION_URL` (HTTPS), y
  `TWILIO_WEB_AUTH_USERNAME` / `TWILIO_WEB_AUTH_PASSWORD`.
  `DISPATCH_REQUEST_TIMEOUT_MS` es opcional (1–10000 ms; por defecto 10000).
- API interna: `GET /api/driver/[driver]/config`,
  `GET /api/driver/[driver]/dashboard` y
  `POST /api/driver/[driver]/action`. Todas requieren el `X-Device-Token` específico
  del slug solicitado; un PIN de otra cuenta devuelve el mismo 401 que uno inválido.
  El cuerpo de acción admite solo `action`, `orderNumber` o `available`, según
  corresponda; nunca acepta identidad del conductor suministrada por el cliente.
- El PIN se compara server-side con hashes de longitud fija y
  `crypto.timingSafeEqual`. Solo después de validar configuración se guarda en
  localStorage como `recogido:driver-token:<slug>`. La clave de María no cambia.
  Un 401, 403 o «Cerrar sesión» elimina solo esa clave y los datos en memoria de
  ese controlador; no toca sesiones de otros conductores. El componente se remonta
  por slug al navegar para no reutilizar estado entre cuentas.
  No usar dispositivos compartidos:
  localStorage persiste hasta cerrar sesión y es accesible al JavaScript del sitio.
- Configuración se consulta al autenticar/restaurar sesión; dashboard cada 8 segundos
  solo en pestaña visible, sin consultas superpuestas de polling, y después de acciones.
  Los conflictos 409 también refrescan ofertas. Errores temporales conservan datos.
- La disponibilidad y los estados se muestran solo cuando los confirma el dashboard;
  completar requiere confirmación y no mueve localmente la entrega al historial.
- Twilio sigue siendo la autoridad transaccional sobre capacidad y exclusión por
  restaurante al aceptar. La interfaz también bloquea ofertas marcadas `canAccept=false`,
  sin capacidad o del mismo restaurante que una entrega activa.
- El adaptador devuelve únicamente campos públicos validados. Omite identificadores,
  credenciales y datos extra; texto público contaminado o contrato inválido se rechaza
  con 502 sanitizado. Fechas ausentes/null se muestran como «—».
- Respuestas sin caché: 401 PIN, 403 conductor deshabilitado/cruce de identidad,
  404 slug inexistente o pedido no disponible,
  409 conflicto, 502 fallo central, 503 piloto desactivado/no configurado.
  Intentos de PIN y operaciones tienen límites por cliente.

`npm run test:driver` ejecuta demo, adaptador, contratos HTTP de los Route Handlers
usando Request/Response y controladores independientes con fetch simulado. No carga
`.env.local`, no utiliza credenciales reales ni llama servicios externos.

### Contrato y cambios posteriores en las tres Twilio Functions

Esta implementación no modifica ni llama las Functions reales. **Antes de usarla
contra producción, verificar/actualizar las tres Functions**, especialmente action:
ya no se acepta una confirmación de acción sin identidad. No hay una excepción
insegura para María; las respuestas anteriores sin identidad fallan cerradas.

- Todas: mantener Basic Auth server-only; recibir `driverId` por POST form-urlencoded,
  resolverlo en su almacenamiento central y eliminar filtros hardcoded de María.
  No recibir PIN/phone desde el navegador ni confiar en identidades extras.
  Verificar conductor activo y acceso web habilitado en cada operación. No registrar
  Authorization, PIN, teléfono ni cuerpos sensibles. La lista de acceso web de
  Next sigue siendo exclusivamente `DRIVERS_JSON`.
- Config: devolver `{success:true,driver:{driverId,name,active,available,
  maxActiveDeliveries,webEnabled}}` con el `driverId` exacto solicitado.
- Dashboard: devolver `{success:true,driver:{driverId,name,active,available,
  maxActiveDeliveries},capacity:{used,maximum,remaining},offers:[],
  activeDeliveries:[],history:[]}`. Filtrar entregas/historial y calcular
  disponibilidad/capacidad para esa identidad; no mezclar datos de conductores.
  Los IDs de propiedad presentes en ofertas/entregas/historial también se validan en Next.
  Las ofertas deben ser exclusivamente las visibles/aceptables para ese conductor.
- Action: devolver al menos `{success:true,driverId:"<identidad-resuelta>"}` (o
  `driver:{driverId:...}`). Validar de forma atómica propiedad de la entrega para
  pickup/complete, destinatario de la oferta para decline y elegibilidad/capacidad/
  exclusión por restaurante para accept. `set_availability` modifica solo el
  conductor resuelto. La confirmación no demuestra por sí sola la propiedad:
  estas verificaciones deben implementarse dentro de la Function.
- Next rechaza config/dashboard/action de otro `driverId` con 403 y una acción
  sin identidad con 502. Las respuestas al navegador son allowlists públicas;
  campos extra de Twilio se descartan. Conservar 403/404/409 sanitizados.

## PWA: Recogido Conductor

- Una sola aplicación «Recogido Conductor», instalable desde cualquier ruta de
  conductor. Inicio neutral `/driver/`: permite abrir el enlace asignado o ingresar
  su identificador, sin publicar una lista de conductores ni redirigir a María.
  Ámbito instalado y del service worker: `/driver/`.
- Manifest: `/driver-manifest.webmanifest`, enlazado solo por el layout de conductor.
  No modifica metadata ni dashboards de restaurantes.
- Service worker: `/driver/sw.js`. Se registra solo en producción y requiere HTTPS
  (localhost también es válido). En `npm run dev` no se registra.
- Iconos oficiales con fondo blanco opaco: 192, 512, maskable 512 y Apple 180 en
  `public/driver/icons/`. El maskable deja el logotipo completo en la zona segura
  circular. Se regeneran sin instalar paquetes con
  `node scripts/generate-driver-icons.mjs`, usando el `sharp` ya instalado con Next.

### Caché y desconexión

- Cache Storage `recogido-driver-static-v1`: solo offline HTML neutro, iconos,
  logotipo y recursos `/_next/static/` (incluidas fuentes públicas de Next).
- Estáticos permitidos sin query: **cache-first**, obtenidos sin credenciales.
  No guarda respuestas privadas, `no-store`, cookies ni variaciones de autenticación.
  Máximo 150 recursos estáticos de ejecución, además de los precargados.
- API, POST, solicitudes con cabeceras de autenticación y demás rutas: **network-only**
  con `cache: no-store`. Navegación de conductor: red sin caché y, si falla,
  `/driver/offline.html`. Nunca se precachea el dashboard, sus HTML/RSC ni sus datos.
- No hay Background Sync, colas ni reintentos de acciones. Offline bloquea ofertas,
  recogida, completar, disponibilidad y acceso. Cerrar sesión sigue disponible.
  Los datos de la pestaña abierta se conservan solo en memoria, no en Cache Storage.
  Una navegación sin red solo muestra la página neutra, sin información operacional.
- Al reconectar, se refresca inmediatamente el dashboard por GET, sin reenviar POST.
  Una operación iniciada justo antes de perder red podría haber llegado al servidor:
  verifique el estado actualizado antes de intentar otra vez.
- No hay PIN, teléfonos, credenciales ni URLs privadas en el manifest o worker.
  La autenticación existente conserva el PIN únicamente en la clave de localStorage
  `recogido:driver-token:<slug>` y lo envía por `X-Device-Token`; no se copia al
  worker ni a Cache Storage. Cerrar sesión/401/403 elimina solo esa sesión.

### Instalación y actualizaciones

**Android/Chrome:** abra su ruta de conductor por HTTPS y presione «INSTALAR APLICACIÓN»
cuando el navegador lo ofrezca. También puede usar el menú de Chrome → Instalar
aplicación/Agregar a pantalla de inicio. Cancelar no vuelve a abrir el diálogo.

**iPhone/iPad (Safari):** Compartir → «Agregar a pantalla de inicio» → «Agregar».
Las instrucciones se pueden cerrar; se recuerda la preferencia en este dispositivo.
En standalone no se muestra la instalación. El layout conserva las áreas seguras
superior/inferior y la navegación táctil; no desactiva el zoom.

Si hay una versión esperando, muestra «Hay una nueva versión de Recogido disponible».
«ACTUALIZAR» activa el worker nuevo y recarga una sola vez. No inicia sesión ni
repite acciones. Cambie la versión de `CACHE_NAME` en `public/driver/sw.js` cuando
cambie el shell offline/recursos públicos: `activate` elimina exclusivamente cachés
antiguas con el prefijo de conductores.

### Validación PWA sin servicios externos

```powershell
npm run test:pwa
npm run test:driver
npm run test:dispatch:adapter
npm run lint
npx tsc --noEmit
npm run build
node scripts\audit-driver-public.mjs
```

Las pruebas de worker ejecutan eventos y Cache Storage simulados; todos los fetch
son locales simulados. La auditoría posterior al build compara bundles públicos,
HTML/RSC prerenderizados y archivos públicos con la configuración privada local,
sin imprimir valores ni modificar `.env.local`. El script HTTP legado
`test:dispatch` necesita un servidor mock; no ejecutarlo contra el backend real.

### Pruebas HTTP del build con perfiles ficticios

`npm run test:driver:http` comprueba ambas rutas, el manifest/worker, respuestas
401/403/404 reales de Next y el demo. Solo permite un host localhost/loopback y
necesita un servidor ya compilado; no autentica PINs correctos contra Twilio.
La autenticación correcta y todas las acciones se prueban con fetch simulado
en `test:driver`.

Después de `npm run build`, en una terminal PowerShell nueva, configurar solo
variables del proceso (no editar `.env.local`) e iniciar:

```powershell
$env:DISPATCH_MOCK_MODE = 'true'
$env:DISPATCH_LIVE_TEST_ENABLED = 'false'
$env:DRIVER_LIVE_TEST_ENABLED = 'true'
$env:DRIVERS_JSON = '[{"slug":"maria-elizabeth","name":"Maria Elizabeth","phone":"whatsapp:+15550001111","deviceToken":"synthetic-http-maria"},{"slug":"patricia-castaneda","driverId":"patricia-castaneda","name":"Patricia Castaneda","phone":"whatsapp:+15550002222","deviceToken":"synthetic-http-patricia","active":true},{"slug":"inactive-driver","driverId":"inactive-driver","name":"Inactive Driver","phone":"whatsapp:+15550003333","deviceToken":"synthetic-http-inactive","active":false}]'
$env:RESTAURANTS_JSON = '[{"slug":"la-fonda","name":"La Fonda","phone":"+15550001111","deviceToken":"synthetic-fonda"},{"slug":"brisas","name":"Brisas","phone":"+15550002222","deviceToken":"synthetic-brisas"},{"slug":"jade-lee","name":"Jade Lee","phone":"+15550003333","deviceToken":"synthetic-jade"}]'
$env:TWILIO_DRIVER_CONFIG_URL = 'https://driver.invalid/config'
$env:TWILIO_DRIVER_DASHBOARD_URL = 'https://driver.invalid/dashboard'
$env:TWILIO_DRIVER_ACTION_URL = 'https://driver.invalid/action'
$env:TWILIO_WEB_AUTH_USERNAME = 'synthetic-user'
$env:TWILIO_WEB_AUTH_PASSWORD = 'synthetic-password'
npm run start -- --port 3107
```

Para la prueba HTTP, mantén el perfil `inactive-driver` en `DRIVERS_JSON` con
`active:false`: un perfil existente pero inactivo devuelve 403, mientras que
uno omitido devuelve 404. Ambas respuestas usan el mismo mensaje público
genérico.

En otra terminal:

```powershell
$env:DRIVER_TEST_BASE_URL = 'http://localhost:3107'
npm run test:driver:http
```

Para ejecutar además `npm run test:dispatch` en esa segunda terminal, copiar allí
el mismo `RESTAURANTS_JSON` ficticio y establecer `DISPATCH_MOCK_MODE=true`,
`DISPATCH_LIVE_TEST_ENABLED=false`, `DISPATCH_TEST_BASE_URL=http://localhost:3107`.
Las variables heredadas del proceso prevalecen sobre `--env-file=.env.local`.
Detener el servidor de pruebas al terminar.
