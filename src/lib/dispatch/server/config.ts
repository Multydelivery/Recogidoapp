import "server-only";
import type { AssignmentMode, DispatchCapabilities, RestaurantPublic } from "../dispatch-types";

export class DispatchError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code = "DISPATCH_ERROR",
  ) {
    super(message);
  }
}

export interface RestaurantConfig extends RestaurantPublic {
  phone: string;
  deviceToken: string;
}

export function isDispatchMockMode() {
  const mode = process.env.DISPATCH_MOCK_MODE ?? "true";
  if (mode !== "true" && mode !== "false") {
    throw new DispatchError(503, "Configuración de Dispatch inválida.");
  }
  return mode === "true";
}

export type DispatchMode = "mock" | "twilio";

const pilotRestaurantId = "restaurant-test";

export function isLiveTestPilotRequested(restaurantId: string) {
  return process.env.DISPATCH_LIVE_TEST_ENABLED === "true" && restaurantId === pilotRestaurantId;
}

export function resolveDispatchMode(restaurantId: string): DispatchMode {
  if (!isLiveTestPilotRequested(restaurantId) || process.env.DISPATCH_LIVE_TEST_RESTAURANT_ID !== pilotRestaurantId) return "mock";
  return "twilio";
}

function validHttpsUrl(value: string | undefined) {
  if (!value?.trim()) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}

export function getMissingLiveTestRequirements() {
  const missing: string[] = [];
  if (process.env.DISPATCH_LIVE_TEST_RESTAURANT_ID !== pilotRestaurantId) {
    missing.push("DISPATCH_LIVE_TEST_RESTAURANT_ID");
  }
  for (const operation of ["config", "create", "status"] as const) {
    if (!validHttpsUrl(process.env[backendUrlVariables[operation]])) missing.push(backendUrlVariables[operation]);
  }
  if (!process.env.TWILIO_WEB_AUTH_USERNAME?.trim()) missing.push("TWILIO_WEB_AUTH_USERNAME");
  if (!process.env.TWILIO_WEB_AUTH_PASSWORD?.trim()) missing.push("TWILIO_WEB_AUTH_PASSWORD");
  if (!validHttpsUrl(process.env.MAKE_TIMER_WEBHOOK_URL)) missing.push("MAKE_TIMER_WEBHOOK_URL");
  if (!process.env.MAKE_TIMER_SECRET?.trim()) missing.push("MAKE_TIMER_SECRET");
  return missing;
}

const mockCapabilities: DispatchCapabilities = {
  liveDispatch: false,
  canCreate: true,
  canReadStatus: true,
  canCancel: true,
  canResend: true,
  canLoadHistory: true,
};

export function getDispatchCapabilities(restaurantId: string): DispatchCapabilities {
  if (!isLiveTestPilotRequested(restaurantId)) return { ...mockCapabilities };

  const liveDispatch = getMissingLiveTestRequirements().length === 0;
  const available = (operation: BackendOperation) =>
    liveDispatch && validHttpsUrl(process.env[backendUrlVariables[operation]]);

  return {
    liveDispatch,
    canCreate: available("create"),
    canReadStatus: available("status"),
    canCancel: available("cancel"),
    canResend: available("resend"),
    canLoadHistory: available("history"),
  };
}

export function isLiveTestConfigurationIncomplete(restaurantId = pilotRestaurantId) {
  return isLiveTestPilotRequested(restaurantId) && !getDispatchCapabilities(restaurantId).liveDispatch;
}

export type BackendOperation = "create" | "config" | "status" | "cancel" | "resend" | "history";

const backendUrlVariables: Record<BackendOperation, string> = {
  create: "TWILIO_WEB_CREATE_URL",
  config: "TWILIO_WEB_CONFIG_URL",
  status: "TWILIO_WEB_STATUS_URL",
  cancel: "TWILIO_WEB_CANCEL_URL",
  resend: "TWILIO_WEB_RESEND_URL",
  history: "TWILIO_WEB_HISTORY_URL",
};

export function getBackendConfig(operation: BackendOperation) {
  const invalid = () => new DispatchError(503, "La integración central no está configurada correctamente.");
  const missing = () => new DispatchError(503, "La operación aún no está configurada en el servicio central.", "NOT_CONFIGURED");
  const liveTestEnabled = process.env.DISPATCH_LIVE_TEST_ENABLED === "true";
  const name = liveTestEnabled ? backendUrlVariables[operation] : ({
    create: "RECOGIDO_DISPATCH_SUBMIT_URL",
    config: "RECOGIDO_DISPATCH_CONFIG_URL",
    status: "RECOGIDO_DISPATCH_STATUS_URL",
    cancel: "RECOGIDO_DISPATCH_CANCEL_URL",
    resend: "RECOGIDO_DISPATCH_RESEND_URL",
    history: "RECOGIDO_DISPATCH_HISTORY_URL",
  } satisfies Record<BackendOperation, string>)[operation];
  const raw = process.env[name];
  if (!raw?.trim()) throw missing();
  let endpoint: URL;
  try { endpoint = new URL(raw); } catch { throw invalid(); }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw invalid();
  const webhookRaw = liveTestEnabled
    ? process.env.MAKE_TIMER_WEBHOOK_URL
    : process.env.RECOGIDO_DISPATCH_MAKE_WEBHOOK_URL;
  let makeWebhookUrl: string | undefined;
  if (operation === "create") {
    if (!webhookRaw?.trim()) throw missing();
    let webhook: URL;
    try { webhook = new URL(webhookRaw); } catch { throw invalid(); }
    if (webhook.protocol !== "https:" || webhook.username || webhook.password || webhook.hash) throw invalid();
    makeWebhookUrl = webhook.toString();
  }
  const username = liveTestEnabled ? process.env.TWILIO_WEB_AUTH_USERNAME : undefined;
  const password = liveTestEnabled ? process.env.TWILIO_WEB_AUTH_PASSWORD : undefined;
  const secret = liveTestEnabled ? undefined : process.env.RECOGIDO_DISPATCH_API_SECRET;
  const makeTimerSecret = liveTestEnabled ? process.env.MAKE_TIMER_SECRET : undefined;
  if (liveTestEnabled ? (!username?.trim() || !password?.trim() || !makeTimerSecret?.trim()) : !secret?.trim()) throw missing();
  const rawTimeout = process.env.DISPATCH_REQUEST_TIMEOUT_MS ?? "10000";
  if (!/^\d+$/.test(rawTimeout)) throw invalid();
  const timeoutMs = Number(rawTimeout);
  if (timeoutMs < 1 || timeoutMs > 10_000) throw invalid();
  return {
    url: endpoint.toString(),
    ...(makeWebhookUrl ? { makeWebhookUrl } : {}),
    ...(secret ? { secret } : {}),
    ...(username && password ? { authorization: `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}` } : {}),
    ...(username ? { username } : {}),
    ...(password ? { password } : {}),
    ...(makeTimerSecret ? { makeTimerSecret } : {}),
    liveTestEnabled,
    timeoutMs,
  };
}

export function requireDispatchCapability(restaurantId: string, capability: keyof Omit<DispatchCapabilities, "liveDispatch">) {
  if (getDispatchCapabilities(restaurantId)[capability]) return;
  throw new DispatchError(
    503,
    "This feature is not configured for the live pilot",
    "FEATURE_NOT_CONFIGURED",
  );
}

export function validateDispatchConfiguration() {
  isDispatchMockMode();
}

export function getRestaurants(): RestaurantConfig[] {
  isDispatchMockMode();
  const raw = process.env.RESTAURANTS_JSON;
  if (!raw) throw new DispatchError(503, "Falta la configuración de restaurantes en el servidor.");

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new DispatchError(503, "La configuración de restaurantes no es JSON válido.");
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 100) {
    throw new DispatchError(503, "La configuración de restaurantes debe ser una lista de 1 a 100 entradas.");
  }
  const slugs = new Set<string>();
  return parsed.map((value: unknown) => {
    if (!value || typeof value !== "object" ||
      !("slug" in value) || typeof value.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug) || value.slug.length > 80 ||
      !("name" in value) || typeof value.name !== "string" || !value.name.trim() || value.name.length > 100 ||
      !("phone" in value) || typeof value.phone !== "string" || !/^\+[1-9]\d{7,14}$/.test(value.phone) ||
      !("deviceToken" in value) || typeof value.deviceToken !== "string" || !/^[A-Za-z0-9_-]{6,128}$/.test(value.deviceToken) ||
      ("maxDeliveries" in value && (!Number.isInteger(value.maxDeliveries) || (value.maxDeliveries as number) < 1 || (value.maxDeliveries as number) > 20)) ||
      ("assignmentMode" in value && value.assignmentMode !== "individual" && value.assignmentMode !== "batch") ||
      ("maxActiveDeliveriesPerDriver" in value && (!Number.isInteger(value.maxActiveDeliveriesPerDriver) || (value.maxActiveDeliveriesPerDriver as number) < 1 || (value.maxActiveDeliveriesPerDriver as number) > 20)) ||
      ("active" in value && typeof value.active !== "boolean") ||
      ("deliveryEnabled" in value && typeof value.deliveryEnabled !== "boolean") ||
      value.slug === "demo" || slugs.has(value.slug)) {
      throw new DispatchError(503, "Hay una entrada inválida o duplicada en la configuración de restaurantes.");
    }
    slugs.add(value.slug);
    const name = value.name.trim();
    const compatibilityProfile = /brisas|jade[\s-]*lee/i.test(`${value.slug} ${name}`)
      ? { maxDeliveries: 5, assignmentMode: "batch" as AssignmentMode }
      : { maxDeliveries: 3, assignmentMode: "individual" as AssignmentMode };
    const maxDeliveries = "maxDeliveries" in value ? value.maxDeliveries as number : compatibilityProfile.maxDeliveries;
    const assignmentMode = "assignmentMode" in value ? value.assignmentMode as AssignmentMode : compatibilityProfile.assignmentMode;
    return {
      slug: value.slug,
      name,
      phone: value.phone,
      deviceToken: value.deviceToken,
      active: "active" in value ? value.active as boolean : true,
      deliveryEnabled: "deliveryEnabled" in value ? value.deliveryEnabled as boolean : true,
      maxDeliveries,
      assignmentMode,
      maxActiveDeliveriesPerDriver: "maxActiveDeliveriesPerDriver" in value
        ? value.maxActiveDeliveriesPerDriver as number
        : assignmentMode === "batch" ? maxDeliveries : 1,
    };
  });
}
