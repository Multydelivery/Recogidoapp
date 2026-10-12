# Contrato: consultar estado web

Ruta lógica sugerida: `/web-delivery-request-status`  
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
