import { authenticate, handleApi, json, readBody, readRequestId } from "@/lib/dispatch/server/api";
import { cancelRequest } from "@/lib/dispatch/server/mock-store";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return handleApi(async () => {
    const body = await readBody(request, ["restaurant", "requestId"]);
    const restaurant = authenticate(request, body.restaurant);
    return json(cancelRequest(restaurant, readRequestId(body.requestId)));
  });
}
