import "server-only";
import { driverOrderPattern, type DriverAction, type LiveConfig, type LiveDashboard, type LiveDelivery, type LiveDriver, type LiveOffer, type LiveOrder, type LiveStatus } from "../live-types";
import { DriverError, getDriverBackend, type DriverProfile } from "./config";

const invalid = () => new DriverError(502, "INVALID_RESPONSE");
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function integer(value: unknown, max = 1000): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > max) throw invalid();
  return value;
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalid();
  return value;
}
function text(value: unknown, secrets: string[]): string {
  if (typeof value !== "string" || !value.trim() || value.length > 200 ||
    /[\u0000-\u001f]|WEB|[a-z]{2}[a-f0-9]{32}|https?:|whatsapp:|@|\+?\d{8,}/i.test(value) ||
    secrets.some((secret) => secret && value.includes(secret))) throw invalid();
  return value;
}
function date(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))) throw invalid();
  return new Date(value).toISOString();
}
type PublicIdentity = Pick<DriverProfile, "driverId" | "name">;
function assertIdentity(value: unknown, identity: PublicIdentity) {
  if (value !== identity.driverId) throw new DriverError(403, "DRIVER_MISMATCH");
}
function driver(value: unknown, identity: PublicIdentity, secrets: string[]): LiveDriver {
  const d = record(value);
  assertIdentity(d.driverId, identity);
  text(d.name, secrets);
  const result = { driverId: identity.driverId, name: text(identity.name, secrets),
    active: boolean(d.active), available: boolean(d.available), maxActiveDeliveries: integer(d.maxActiveDeliveries, 3) };
  if (!result.active) throw new DriverError(403, "DRIVER_DISABLED");
  if (!result.maxActiveDeliveries) throw invalid();
  return result;
}
function order(value: unknown, secrets: string[]): LiveOrder {
  const o = record(value);
  if (typeof o.orderNumber !== "string" || !driverOrderPattern.test(o.orderNumber)) throw invalid();
  if (o.assignmentMode !== "individual" && o.assignmentMode !== "batch") throw invalid();
  const dates: Pick<LiveOrder, "createdAt" | "assignedAt" | "pickedUpAt" | "completedAt" | "updatedAt"> = {};
  for (const key of ["createdAt", "assignedAt", "pickedUpAt", "completedAt", "updatedAt"] as const) {
    const parsed = date(o[key]);
    if (parsed) dates[key] = parsed;
  }
  return { orderNumber: o.orderNumber, restaurantId: text(o.restaurantId, secrets),
    restaurantName: text(o.restaurantName, secrets), assignmentLabel: text(o.assignmentLabel, secrets),
    assignmentMode: o.assignmentMode, deliveryUnits: integer(o.deliveryUnits), ...dates };
}
const statuses: LiveStatus[] = ["open", "claimed", "assigned", "picked_up", "completed", "closed", "declined", "cancelled"];
function delivery(value: unknown, secrets: string[]): LiveDelivery {
  const o = record(value);
  const status = statuses.find((status) => status === o.status);
  if (!status) throw invalid();
  return { ...order(o, secrets), status };
}
function list<T>(value: unknown, normalize: (item: unknown) => T): T[] {
  if (!Array.isArray(value) || value.length > 500) throw invalid();
  return value.map(normalize);
}
export function normalizeDriverConfig(value: unknown, identity: PublicIdentity, secrets: string[] = []): LiveConfig {
  const data = record(value);
  if (data.success !== true) throw invalid();
  if (data.driverId !== undefined) assertIdentity(data.driverId, identity);
  const rawDriver = record(data.driver);
  const webEnabled = boolean(rawDriver.webEnabled);
  if (!webEnabled) throw new DriverError(403, "DRIVER_DISABLED");
  return { success: true, driver: { ...driver(rawDriver, identity, secrets), webEnabled } };
}
export function normalizeDriverDashboard(value: unknown, identity: PublicIdentity, secrets: string[] = []): LiveDashboard {
  const data = record(value);
  if (data.success !== true) throw invalid();
  if (data.driverId !== undefined) assertIdentity(data.driverId, identity);
  const d = driver(data.driver, identity, secrets);
  const c = record(data.capacity);
  const capacity = { used: integer(c.used), maximum: integer(c.maximum, 3), remaining: integer(c.remaining) };
  if (capacity.maximum !== d.maxActiveDeliveries || capacity.used + capacity.remaining !== capacity.maximum) throw invalid();
  const ownedDelivery = (item: unknown) => {
    const raw = record(item);
    if (raw.driverId !== undefined) assertIdentity(raw.driverId, identity);
    return delivery(raw, secrets);
  };
  const activeDeliveries = list(data.activeDeliveries, ownedDelivery);
  if (activeDeliveries.some((item) => !["claimed", "assigned", "picked_up"].includes(item.status))) throw invalid();
  const offers = list<LiveOffer>(data.offers, (item) => {
    const raw = record(item);
    if (raw.driverId !== undefined) assertIdentity(raw.driverId, identity);
    const offer = order(raw, secrets);
    let canAccept = boolean(raw.canAccept);
    let blockReason = raw.blockReason == null || raw.blockReason === "" ? undefined : text(raw.blockReason, secrets);
    if (!d.available) { canAccept = false; blockReason = "Está No disponible."; }
    else if (capacity.remaining === 0) { canAccept = false; blockReason = "Alcanzó su capacidad máxima de 3 entregas activas."; }
    else if (activeDeliveries.some((active) => active.restaurantId === offer.restaurantId)) {
      canAccept = false; blockReason = "Ya tiene una entrega activa de este restaurante. Puede aceptar ofertas de otros restaurantes.";
    }
    return { ...offer, canAccept, ...(!canAccept ? { blockReason: blockReason || "Esta oferta no está disponible." } : {}) };
  });
  return { success: true, driver: d, capacity, offers, activeDeliveries,
    history: list(data.history, ownedDelivery) };
}

export function normalizeDriverAction(value: unknown, identity: PublicIdentity) {
  const data = record(value);
  if (data.success !== true) throw invalid();
  if (data.driverId === undefined && data.driver === undefined) throw invalid();
  if (data.driverId !== undefined) assertIdentity(data.driverId, identity);
  if (data.driver !== undefined) assertIdentity(record(data.driver).driverId, identity);
  return { success: true as const };
}

export async function callDriverTwilio(profile: DriverProfile, operation: "config" | "dashboard" | "action", action?: DriverAction) {
  const config = getDriverBackend(operation);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  try {
    const body = new URLSearchParams({ driverId: profile.driverId });
    if (action) for (const [key, value] of Object.entries(action)) body.set(key, String(value));
    const response = await fetch(config.url, { method: "POST", cache: "no-store", redirect: "error",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: config.authorization },
      body, signal: controller.signal });
    // Upstream auth failures refer to integration credentials, not the device PIN.
    if (!response.ok) throw new DriverError([403, 404, 409].includes(response.status) ? response.status : 502, "UPSTREAM_ERROR");
    const data: unknown = await response.json();
    const payload = record(data);
    if (payload.success !== true) {
      const status = [403, 404, 409].find((status) => payload.status === status || payload.statusCode === status);
      throw new DriverError(status ?? 502, "UPSTREAM_REJECTED");
    }
    const secrets = [profile.phone, profile.phone.replace("whatsapp:", ""), profile.deviceToken,
      config.username, config.password, config.authorization, config.url];
    if (operation === "config") return normalizeDriverConfig(data, profile, secrets);
    if (operation === "dashboard") return normalizeDriverDashboard(data, profile, secrets);
    return normalizeDriverAction(data, profile);
  } catch (error) {
    if (error instanceof DriverError) throw error;
    throw new DriverError(502, controller.signal.aborted ? "UPSTREAM_TIMEOUT" : "UPSTREAM_FAILURE");
  } finally { clearTimeout(timeout); }
}
