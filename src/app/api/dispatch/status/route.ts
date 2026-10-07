import { authenticate, handleApi, json, readRequestId } from "@/lib/dispatch/server/api";
import { snapshot } from "@/lib/dispatch/server/mock-store";

export const runtime = "nodejs";

export async function GET(request: Request) {
  return handleApi(() => {
    const params = new URL(request.url).searchParams;
    const restaurant = authenticate(request, params.get("restaurant"));
    const requestId = params.get("requestId");
    return json(snapshot(restaurant, requestId === null ? undefined : readRequestId(requestId)));
  });
}
