import { driverApi } from "@/lib/driver/server/api";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ driver: string }> }) {
  return driverApi(request, "dashboard", (await context.params).driver);
}
