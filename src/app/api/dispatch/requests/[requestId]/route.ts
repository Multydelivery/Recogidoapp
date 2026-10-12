import { authenticate, handleApi, json, rateLimit, readRequestId } from "@/lib/dispatch/server/api";
import { validateDispatchConfiguration } from "@/lib/dispatch/server/config";
import { statusDispatch } from "@/lib/dispatch/server/service";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ requestId: string }> }) {
  return handleApi(async () => {
    validateDispatchConfiguration();
    const { requestId: rawRequestId } = await context.params;
    const requestId = readRequestId(rawRequestId);
    const restaurantId = new URL(request.url).searchParams.get("restaurantId");
    const restaurant = authenticate(request, restaurantId);
    rateLimit(request, `read:${restaurant.slug}`, 90, 60_000);
    return json(await statusDispatch(restaurant, requestId));
  });
}
