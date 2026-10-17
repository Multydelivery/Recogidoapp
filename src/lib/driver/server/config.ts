import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { DispatchError } from "@/lib/dispatch/server/config";
import { rateLimit } from "@/lib/dispatch/server/api";

export class DriverError extends DispatchError {
  constructor(status: number, code: string) {
    super(status, driverErrorMessage(status), code);
  }
}

export function driverErrorMessage(status: number) {
  switch (status) {
    case 400: return "Solicitud de conductor inválida.";
    case 401: return "PIN incorrecto. Inténtelo nuevamente.";
    case 403: return "Conductor no habilitado.";
    case 404: return "El pedido ya no está disponible.";
    case 409: return "No se pudo aceptar el pedido: capacidad, restaurante o pedido tomado. Se actualizarán las ofertas.";
    case 429: return "Demasiados intentos. Espere antes de intentar nuevamente.";
    case 503: return "El piloto está desactivado o no está configurado.";
    default: return "Twilio no pudo completar la operación. Inténtelo nuevamente.";
  }
}

export function getDriverProfile() {
  if (process.env.DRIVER_LIVE_TEST_ENABLED !== "true" ||
    process.env.DRIVER_LIVE_TEST_DRIVER_ID !== "maria-elizabeth") throw new DriverError(503, "PILOT_DISABLED");
  let entries: unknown;
  try { entries = JSON.parse(process.env.DRIVERS_JSON ?? ""); }
  catch { throw new DriverError(503, "INVALID_CONFIGURATION"); }
  if (!Array.isArray(entries) || entries.length > 100) throw new DriverError(503, "INVALID_CONFIGURATION");
  const profiles = entries.filter((entry: unknown): entry is Record<string, unknown> =>
    !!entry && typeof entry === "object" && !Array.isArray(entry) &&
    "slug" in entry && entry.slug === "maria-elizabeth");
  const profile = profiles[0];
  if (profiles.length !== 1 || typeof profile.name !== "string" || !profile.name.trim() ||
    typeof profile.phone !== "string" || !/^(?:whatsapp:)?\+[1-9]\d{7,14}$/.test(profile.phone) ||
    typeof profile.deviceToken !== "string" || !/^[A-Za-z0-9_-]{4,128}$/.test(profile.deviceToken)) {
    throw new DriverError(503, "INVALID_CONFIGURATION");
  }
  return { slug: "maria-elizabeth", name: profile.name, phone: profile.phone, deviceToken: profile.deviceToken };
}

export function authenticateDriver(request: Request) {
  const profile = getDriverProfile();
  const token = request.headers.get("x-device-token") ?? "";
  const hash = (text: string) => createHash("sha256").update(text).digest();
  const matches = timingSafeEqual(hash(token.slice(0, 129)), hash(profile.deviceToken));
  if (!token || token.length > 128 || !matches) {
    rateLimit(request, "driver-auth:maria-elizabeth", 10, 15 * 60_000);
    throw new DriverError(401, "INVALID_PIN");
  }
  return profile;
}

export function getDriverBackend(operation: "config" | "dashboard" | "action") {
  const invalid = () => new DriverError(503, "INVALID_CONFIGURATION");
  const raw = process.env[`TWILIO_DRIVER_${operation.toUpperCase()}_URL`];
  let url: URL;
  try { url = new URL(raw ?? ""); } catch { throw invalid(); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw invalid();
  const username = process.env.TWILIO_WEB_AUTH_USERNAME;
  const password = process.env.TWILIO_WEB_AUTH_PASSWORD;
  if (!username?.trim() || !password?.trim()) throw invalid();
  const timeout = process.env.DISPATCH_REQUEST_TIMEOUT_MS ?? "10000";
  const timeoutMs = Number(timeout);
  if (!/^\d+$/.test(timeout) || timeoutMs < 1 || timeoutMs > 10_000) throw invalid();
  return { url: url.toString(), username, password, timeoutMs,
    authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` };
}
