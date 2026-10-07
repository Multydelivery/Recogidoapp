import { authenticate, handleApi, json, readBody } from "@/lib/dispatch/server/api";
import { DispatchError } from "@/lib/dispatch/server/config";
import { createRequest } from "@/lib/dispatch/server/mock-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleApi(async () => {
    const body = await readBody(request, ["restaurant", "deliveryCount", "idempotencyKey"]);
    const restaurant = authenticate(request, body.restaurant);
    if (typeof body.deliveryCount !== "number" || !Number.isInteger(body.deliveryCount) ||
      body.deliveryCount < 1 || body.deliveryCount > 9) {
      throw new DispatchError(400, "La cantidad debe ser un entero entre 1 y 9.");
    }
    if (typeof body.idempotencyKey !== "string" || !/^[A-Za-z0-9_-]{8,128}$/.test(body.idempotencyKey)) {
      throw new DispatchError(400, "Clave de idempotencia inválida.");
    }
    const result = createRequest(restaurant, body.deliveryCount, body.idempotencyKey);
    return json(result.data, result.reused ? 200 : 201);
  });
}
