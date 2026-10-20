# Recogido Rides - demo local

Primera fase demostrativa, aislada de restaurantes, ordering, conductores,
dispatch y APIs existentes. Usa App Router, TypeScript y CSS Modules con las
variables de marca, tipografia Geist, logo e iconos existentes. No requiere
dependencias nuevas ni cambios de entorno.

## Rutas

- `/rides/demo`: formulario con datos ficticios precargados.
- `/rides/demo/status`: solicitud actual, precio simulado, aprobacion y seguimiento.
- `/admin/rides/demo`: cola, filtro, cotizacion y operaciones manuales.

Las tres rutas muestran permanentemente:

> Modo de demostración — No se solicitará ningún viaje real ni se procesará ningún pago.

Las rutas no se
incluyen en el sitemap y declaran `noindex, nofollow`.
El dispatcher es publico y no tiene autenticacion: **no es un panel de produccion**.

## Probar el flujo

Con el servidor de desarrollo existente (`npm run dev`):

1. Abre `/rides/demo` y usa exclusivamente los datos ficticios precargados.
   Crea un viaje inmediato o programa una fecha y hora local futura.
   El demo admite de 1 a 8 pasajeros y los seis tipos de servicio del modelo.
2. En el seguimiento, abre **Dispatcher demo** en la misma pestana.
3. Selecciona la solicitud, pulsa **Revisar solicitud** e ingresa importes en USD.
   Los valores iniciales de prueba son costo 20.00 y precio 28.00.
   El margen se calcula en centavos como precio menos costo; un margen negativo
   se muestra expresamente. No se calculan tarifas ni distancias reales.
4. Envia la cotizacion, abre **Ver como cliente para aprobar** y aprueba el precio.
   El dispatcher no puede saltarse esta aprobacion ni modificar un precio ya aprobado.
5. Regresa al dispatcher y simula la reserva. Se genera una referencia ficticia.
   Asigna el conductor, vehiculo y placa ficticios precargados.
6. Avanza manualmente: conductor en camino, pasajero a bordo y viaje completado.
   Recarga y alterna entre las rutas para comprobar la persistencia.
7. Crea mas solicitudes para probar la cola y el filtro por estado.
   **Ver esta solicitud como cliente** cambia la solicitud actual.

Se puede cancelar con confirmacion antes de marcar al pasajero a bordo.
Completados y cancelados son estados terminales. La secuencia de seguimiento
no es un historial de eventos ni un mapa en tiempo real.

## Almacenamiento y aislamiento

- Solo se utiliza `sessionStorage`, bajo la clave `recogido.rides.demo.v1`.
- Solicitudes y seleccion actual se guardan juntas, despues de cada accion.
  La interfaz no confirma cambios que no se hayan podido guardar.
- Navega siempre en **la misma pestana**. Las pestanas independientes no se
  sincronizan. La recarga conserva la sesion; la restauracion de pestanas depende
  del navegador. Para eliminarla expresamente, usa **Reiniciar demo de Rides**.
- El reinicio pide confirmacion y elimina exclusivamente la clave de Rides.
  No borra almacenamiento de otros flujos.
- Si el almacenamiento esta bloqueado o los datos estan corruptos, se muestra
  un error explicito; no se reemplazan silenciosamente por datos nuevos.
- No hay almacenamiento en `localStorage`, backend, APIs, geolocalizacion,
  proveedores, mapas, pagos, SMS ni servicios de mensajeria.
- No ingreses datos personales reales, detalles medicos ni informacion sensible.
  El tipo de servicio medico solo es una etiqueta demostrativa, no emergencias.

## Validacion

Sin dependencias nuevas y sin cargar variables de entorno:

```powershell
$loader = ([System.Uri](Join-Path $PWD 'tests\register-typescript.mjs')).AbsoluteUri
node --import $loader --test .\tests\rides-demo.test.mjs
.\node_modules\.bin\eslint.cmd src\lib\rides src\components\rides src\app\rides src\app\admin\rides tests\rides-demo.test.mjs
.\node_modules\.bin\tsc.cmd --noEmit --incremental false
```

Las pruebas cubren el modelo, validaciones, centavos, margen, transiciones,
aprobacion obligatoria, cancelacion, multiples solicitudes, recuperacion de
sesion, datos corruptos y el aviso de seguridad en las tres pantallas.
