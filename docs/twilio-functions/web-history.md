# Contrato: historial de Dispatch web

Ruta lógica sugerida: `/web-delivery-request-history`  
Variable de URL en Next.js: `TWILIO_WEB_HISTORY_URL`

Campo URL-encoded: `restaurantId`. Devolver entre cero y cinco solicitudes raíz
recientes que pertenezcan a ese restaurante:

```json
{
  "success": true,
  "restaurantId": "restaurant-test",
  "requests": []
}
```

El límite se aplica en el servidor; no devolver hijos como entradas de nivel
raíz ni registros de otros restaurantes. Cada elemento usa el contrato
normalizado de Dispatch, con los datos de asignación disponibles y sin teléfonos
de conductores ni credenciales.
