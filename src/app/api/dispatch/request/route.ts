import { authenticate, handleApi, json, rateLimit, readBody } from "@/lib/dispatch/server/api";
import { DispatchError, validateDispatchConfiguration } from "@/lib/dispatch/server/config";
import { submitDispatch } from "@/lib/dispatch/server/service";
import { isValidIdempotencyKey } from "@/lib/dispatch/dispatch-types";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleApi(async () => {
    validateDispatchConfiguration();
    const body = await readBody(request, ["restaurantId", "restaurant", "deliveryCount", "idempotencyKey"]);
    const restaurant = authenticate(request, body.restaurantId ?? body.restaurant);
    rateLimit(request, `create:${restaurant.slug}`, 5, 60_000);
    if (typeof body.deliveryCount !== "number" || !Number.isInteger(body.deliveryCount) || body.deliveryCount < 1) {
      throw new DispatchError(400, "La cantidad debe ser un entero positivo.");
    }
    if (!isValidIdempotencyKey(body.idempotencyKey)) {
      throw new DispatchError(400, "Clave de idempotencia inválida.");
    }
    const result = await submitDispatch(restaurant, body.deliveryCount, body.idempotencyKey);
    return json(result.data, result.statusCode);
  });
}
