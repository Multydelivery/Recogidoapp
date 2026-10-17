import { authenticate, handleApi, json, rateLimit } from "@/lib/dispatch/server/api";
import { DispatchError, validateDispatchConfiguration } from "@/lib/dispatch/server/config";
import { historyDispatch } from "@/lib/dispatch/server/service";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ restaurantId: string }> }) {
  return handleApi(async () => {
    validateDispatchConfiguration();
    const { restaurantId } = await context.params;
    const restaurant = authenticate(request, restaurantId);
    // The restaurant comes only from the authenticated path; query parameters cannot widen or redirect it.
    if (new URL(request.url).searchParams.size > 0) throw new DispatchError(400, "Parámetros no permitidos en la solicitud.");
    rateLimit(request, `history:${restaurant.slug}`, 30, 60_000);
    return json(await historyDispatch(restaurant));
  });
}
