import "server-only";
import { json, rateLimit, readBody } from "@/lib/dispatch/server/api";
import { DispatchError } from "@/lib/dispatch/server/config";
import { driverOrderPattern, type DriverAction } from "../live-types";
import { authenticateDriver, DriverError, driverErrorMessage } from "./config";
import { callDriverTwilio } from "./twilio";

export async function driverApi(request: Request, operation: "config" | "dashboard" | "action") {
  try {
    authenticateDriver(request);
    rateLimit(request, `driver:${operation}`, operation === "action" ? 60 : 120, 60_000);
    let action: DriverAction | undefined;
    if (operation === "action") {
      const body = await readBody(request, ["action", "orderNumber", "available"]);
      if (body.action === "set_availability" && typeof body.available === "boolean" && body.orderNumber === undefined) {
        action = { action: body.action, available: body.available };
      } else if ((body.action === "accept" || body.action === "decline" || body.action === "pickup" || body.action === "complete") &&
        typeof body.orderNumber === "string" && driverOrderPattern.test(body.orderNumber) && body.available === undefined) {
        action = { action: body.action, orderNumber: body.orderNumber };
      } else throw new DriverError(400, "INVALID_ACTION");
    }
    return json(await callDriverTwilio(operation, action));
  } catch (error) {
    const status = error instanceof DispatchError ? error.statusCode : 502;
    if (!(error instanceof DispatchError)) console.error("Unexpected driver API failure");
    return json({ success: false, code: error instanceof DriverError ? error.code : "DRIVER_ERROR",
      error: driverErrorMessage(status) }, status);
  }
}
