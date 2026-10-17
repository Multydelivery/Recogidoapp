import { driverApi } from "@/lib/driver/server/api";
export const runtime = "nodejs";
export async function GET(request: Request) { return driverApi(request, "dashboard"); }
