# Recogido Driver (demo y piloto privado)

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

## Piloto privado de Maria Elizabeth

- URL local: `http://localhost:3000/driver/maria-elizabeth`.
- Reutiliza encabezado, tarjetas, confirmación, navegación y estilos del demo.
  `/driver/demo` sigue siendo exclusivamente simulado y sin red.
- El servidor requiere `DRIVER_LIVE_TEST_ENABLED=true`,
  `DRIVER_LIVE_TEST_DRIVER_ID=maria-elizabeth` y un perfil único en `DRIVERS_JSON`
  con `slug`, `name`, `phone` y `deviceToken`. No se incrustan variables privadas
  en el HTML ni se pasan a componentes cliente.
- Las Functions se configuran mediante `TWILIO_DRIVER_CONFIG_URL`,
  `TWILIO_DRIVER_DASHBOARD_URL`, `TWILIO_DRIVER_ACTION_URL` (HTTPS), y
  `TWILIO_WEB_AUTH_USERNAME` / `TWILIO_WEB_AUTH_PASSWORD`.
  `DISPATCH_REQUEST_TIMEOUT_MS` es opcional (1–10000 ms; por defecto 10000).
- API interna: `GET /api/driver/maria-elizabeth/config`,
  `GET /api/driver/maria-elizabeth/dashboard` y
  `POST /api/driver/maria-elizabeth/action`. Todas requieren `X-Device-Token`.
  El cuerpo de acción admite solo `action`, `orderNumber` o `available`, según
  corresponda; nunca acepta identidad del conductor suministrada por el cliente.
- El PIN se compara server-side con hashes de longitud fija y
  `crypto.timingSafeEqual`. Solo después de validar configuración se guarda en
  localStorage como `recogido:driver-token:maria-elizabeth`.
  Un 401 o «Cerrar sesión» elimina esa clave. No usar dispositivos compartidos:
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
- Respuestas sin caché: 401 PIN, 403 conductor deshabilitado, 404 pedido no disponible,
  409 conflicto, 502 fallo central, 503 piloto desactivado/no configurado.
  Intentos de PIN y operaciones tienen límites por cliente.

`npm run test:driver` ejecuta demo, adaptador, contratos HTTP de los Route Handlers
usando Request/Response y controlador del piloto con fetch simulado. No carga
`.env.local`, no utiliza credenciales reales ni llama servicios externos.

## PWA: Recogido Conductor

- Inicio: `/driver/maria-elizabeth`; ámbito instalado y del service worker: `/driver/`.
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
  del piloto y lo envía por `X-Device-Token`; no se copia al worker ni a Cache Storage.
  Cerrar sesión/401 lo elimina y vuelve al formulario.

### Instalación y actualizaciones

**Android/Chrome:** abra el piloto por HTTPS y presione «INSTALAR APLICACIÓN»
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
