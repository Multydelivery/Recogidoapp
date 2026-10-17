import { authenticate, handleApi, json, rateLimit } from "@/lib/dispatch/server/api";
import { validateDispatchConfiguration } from "@/lib/dispatch/server/config";
import { activeDispatch } from "@/lib/dispatch/server/service";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ restaurantId: string }> }) {
  return handleApi(async () => {
    validateDispatchConfiguration();
    const { restaurantId } = await context.params;
    const restaurant = authenticate(request, restaurantId);
    rateLimit(request, `read:${restaurant.slug}`, 90, 60_000);
    return json(await activeDispatch(restaurant));
  });
}
