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
    case 403: return "Conductor no autorizado";
    case 404: return "El pedido ya no está disponible.";
    case 409: return "No se pudo aceptar el pedido: capacidad, restaurante o pedido tomado. Se actualizarán las ofertas.";
    case 429: return "Demasiados intentos. Espere antes de intentar nuevamente.";
    case 503: return "El piloto está desactivado o no está configurado.";
    default: return "Twilio no pudo completar la operación. Inténtelo nuevamente.";
  }
}

export interface DriverProfile {
  slug: string;
  driverId: string;
  name: string;
  phone: string;
  deviceToken: string;
  active: boolean;
}

const identifier = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length <= 80 && identifier.test(value);
}

export function getDriverProfile(slug: string): DriverProfile {
  // Preserve the old emergency stop without making pilot variables an allowlist.
  if (process.env.DRIVER_LIVE_TEST_ENABLED === "false") throw new DriverError(503, "PILOT_DISABLED");
  const invalid = () => new DriverError(503, "INVALID_CONFIGURATION");
  let entries: unknown;
  try { entries = JSON.parse(process.env.DRIVERS_JSON ?? ""); }
  catch { throw invalid(); }
  if (!Array.isArray(entries) || entries.length > 100) throw invalid();
  const slugs = new Set<string>();
  const ids = new Set<string>();
  const tokens = new Set<string>();
  const profiles = entries.map((entry: unknown): DriverProfile => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw invalid();
    const p = entry as Record<string, unknown>;
    const profileSlug = p.slug ?? p.driverId;
    const driverId = p.driverId ?? p.slug;
    const legacy = p.slug === undefined || p.driverId === undefined;
    const active = legacy && p.active === undefined ? true : p.active;
    if (!validIdentifier(profileSlug) || profileSlug === "demo" || !validIdentifier(driverId) ||
      typeof p.name !== "string" || !p.name.trim() || p.name.length > 200 ||
      typeof p.phone !== "string" || !/^(?:whatsapp:)?\+[1-9]\d{7,14}$/.test(p.phone) ||
      typeof p.deviceToken !== "string" || !/^[A-Za-z0-9_-]{4,128}$/.test(p.deviceToken) ||
      typeof active !== "boolean" || slugs.has(profileSlug) || ids.has(driverId) || tokens.has(p.deviceToken)) throw invalid();
    slugs.add(profileSlug);
    ids.add(driverId);
    tokens.add(p.deviceToken);
    return { slug: profileSlug, driverId, name: p.name, phone: p.phone, deviceToken: p.deviceToken, active };
  });
  const profile = profiles.find((entry) => entry.slug === slug);
  if (!profile) throw new DriverError(404, "DRIVER_NOT_FOUND");
  if (!profile.active) throw new DriverError(403, "DRIVER_DISABLED");
  return profile;
}

export function authenticateDriver(request: Request, slug: string) {
  const profile = getDriverProfile(slug);
  const token = request.headers.get("x-device-token") ?? "";
  const hash = (text: string) => createHash("sha256").update(text).digest();
  const matches = timingSafeEqual(hash(token.slice(0, 129)), hash(profile.deviceToken));
  if (!token || token.length > 128 || !matches) {
    rateLimit(request, `driver-auth:${profile.slug}`, 10, 15 * 60_000);
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
