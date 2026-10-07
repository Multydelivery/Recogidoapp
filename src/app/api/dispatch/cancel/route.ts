import { authenticate, handleApi, json, readBody, readRequestId } from "@/lib/dispatch/server/api";
import { validateDispatchConfiguration } from "@/lib/dispatch/server/config";
import { cancelDispatch } from "@/lib/dispatch/server/service";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleApi(async () => {
    validateDispatchConfiguration();
    const body = await readBody(request, ["restaurant", "requestId"]);
    const restaurant = authenticate(request, body.restaurant);
    return json(await cancelDispatch(restaurant, readRequestId(body.requestId)));
  });
}
