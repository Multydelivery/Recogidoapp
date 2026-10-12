import { authenticate, handleApi, json, rateLimit, readBody, readRequestId } from "@/lib/dispatch/server/api";
import { validateDispatchConfiguration } from "@/lib/dispatch/server/config";
import { resendDispatch } from "@/lib/dispatch/server/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleApi(async () => {
    validateDispatchConfiguration();
    const body = await readBody(request, ["restaurant", "requestId"]);
    const restaurant = authenticate(request, body.restaurant);
    rateLimit(request, `resend:${restaurant.slug}`, 10, 60_000);
    const result = await resendDispatch(restaurant, readRequestId(body.requestId));
    return json(result, result.operationStatus ? 202 : 200);
  });
}
