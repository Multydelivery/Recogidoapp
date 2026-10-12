import { authenticate, handleApi, json, rateLimit } from "@/lib/dispatch/server/api";
import { validateDispatchConfiguration } from "@/lib/dispatch/server/config";
import { recentDispatch } from "@/lib/dispatch/server/service";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleApi(async () => {
    validateDispatchConfiguration();
    const params = new URL(request.url).searchParams;
    const restaurant = authenticate(request, params.get("restaurant"));
    rateLimit(request, `read:${restaurant.slug}`, 90, 60_000);
    return json(await recentDispatch(restaurant));
  });
}
