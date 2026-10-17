import { driverApi } from "@/lib/driver/server/api";
export const runtime = "nodejs";
export async function POST(request: Request) { return driverApi(request, "action"); }
