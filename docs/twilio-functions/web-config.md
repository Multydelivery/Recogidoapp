# Contrato: configuración web de restaurante

Ruta lógica sugerida: `/web-dispatch-config`  
Variable de URL en Next.js: `TWILIO_WEB_CONFIG_URL`

Implementar como Twilio Function autenticada servidor a servidor. Recibe
`restaurantId` en formulario URL-encoded, lee el Sync Map `restaurants` y
devuelve:

```json
{
  "success": true,
  "restaurantId": "restaurant-test",
  "restaurant": {
    "restaurantId": "restaurant-test",
    "name": "Restaurante de prueba",
    "active": true,
    "deliveryEnabled": true,
    "maxDeliveries": 3,
    "assignmentMode": "individual",
    "maxActiveDeliveriesPerDriver": 1
  }
}
```

Rechazar IDs inexistentes, inactivos o no habilitados según la política acordada.
No devolver credenciales, claves del Sync Map ni información de otros
restaurantes. El perfil de prueba autorizado debe coincidir con máximo 3,
modalidad individual y máximo 1 entrega activa por conductor. Compartir el
lector central existente; no crear otro perfil que diverja de Sync.
