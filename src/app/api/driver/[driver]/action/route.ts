import { driverApi } from "@/lib/driver/server/api";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ driver: string }> }) {
  return driverApi(request, "action", (await context.params).driver);
}
