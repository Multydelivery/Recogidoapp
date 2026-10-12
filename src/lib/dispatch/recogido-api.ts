import "server-only";
import { createHash } from "node:crypto";
import type {
  AssignmentMode,
  DispatchRequest,
  DispatchStatus,
  RestaurantPublic,
} from "./dispatch-types";
import { DispatchError, getBackendConfig, resolveDispatchMode, type BackendOperation } from "./server/config";

export type BackendErrorCode = "not_configured" | "timeout" | "network" | "http" | "invalid_response" | "rejected" | "timer_error";

export class RecogidoApiError extends DispatchError {
  public createdRequest?: DispatchRequest;

  constructor(
    public readonly code: BackendErrorCode,
    public readonly requestId: string | undefined,
    statusCode: number,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(statusCode, message, code === "not_configured" ? "NOT_CONFIGURED" :
      code === "timer_error" ? "CREATED_WITH_TIMER_ERROR" : "CENTRAL_API_ERROR");
  }

}

export function stableLiveTestRequestId(restaurantId: string, idempotencyKey: string) {
  const digest = createHash("sha256").update(`${restaurantId}:${idempotencyKey}`).digest("hex").slice(0, 32);
  return `WEB_${digest}`;
}

interface Identity {
  restaurantId: string;
  requestId?: string;
}

export interface CreateDeliveryRequestInput extends Identity {
  requestId: string;
  restaurantName: string;
  restaurantPhone: string;
  deliveryCount: number;
  idempotencyKey: string;
  configuration: RestaurantPublic;
}

const rootIdPattern = /^WEB_[a-f0-9]{32}$/;
const statusValues: DispatchStatus[] = ["open", "partially_claimed", "claimed", "fully_assigned", "cancelled", "closed"];

declare global {
  var recogidoMakeTimersStarted: Set<string> | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof parsed === "number" && Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function safeText(value: unknown, maximum = 100) {
  return typeof value === "string" && value.length <= maximum && !/[\u0000-\u001f]/.test(value) &&
    !value.includes("://") && !value.includes("@") ? value : undefined;
}

function safeDriverName(value: unknown) {
  const name = safeText(value);
  return name && !/(?:^|\D)\+?[1-9]\d{7,14}(?:\D|$)/.test(name) ? name : undefined;
}

function containsSensitiveValue(value: unknown, sensitiveValues: string[]): boolean {
  if (typeof value === "string") return sensitiveValues.some((sensitive) => sensitive && value.includes(sensitive));
  if (Array.isArray(value)) return value.some((entry) => containsSensitiveValue(entry, sensitiveValues));
  return isRecord(value) && Object.values(value).some((entry) => containsSensitiveValue(entry, sensitiveValues));
}

function requestPayload(value: unknown, identity: Identity): Record<string, unknown> | null {
  if (!isRecord(value) || value.success !== true || value.restaurantId !== identity.restaurantId) {
    throw new RecogidoApiError("invalid_response", identity.requestId, 502, "Respuesta inválida del servicio central.", false);
  }
  if ("request" in value && value.request === null && !identity.requestId) return null;
  const payload = isRecord(value.request) ? value.request : value;
  if (payload.requestedDeliveries !== undefined && payload.deliveryCount === undefined) {
    payload.deliveryCount = payload.requestedDeliveries;
  }
  if (Array.isArray(payload.children) && payload.deliveries === undefined) {
    payload.deliveries = payload.children.map((child) => {
      if (!isRecord(child)) return child;
      return {
        ...child,
        driverName: child.winnerName,
        assignedAt: child.claimedAt,
      };
    });
  }
  if (identity.requestId && payload.requestId !== identity.requestId) {
    throw new RecogidoApiError("invalid_response", identity.requestId, 502, "Respuesta inválida del servicio central.", false);
  }
  return payload;
}

function normalizeRequest(
  value: unknown,
  identity: Identity,
  configuration: RestaurantPublic,
  initialCreateResponse = false,
): DispatchRequest | null {
  const payload = requestPayload(value, identity);
  if (!payload) return null;
  const invalid = () => new RecogidoApiError("invalid_response", identity.requestId, 502, "Respuesta inválida del servicio central.", false);
  const requestId = payload.requestId;
  const deliveryCount = boundedInteger(payload.deliveryCount, 1, configuration.maxDeliveries);
  const createdAt = safeText(payload.createdAt, 40) ?? (initialCreateResponse ? new Date().toISOString() : undefined);
  const statusValue = payload.status === "partially_assigned" ? "partially_claimed" : payload.status;
  const status = statusValue ?? (initialCreateResponse ? "open" : undefined);
  if (typeof requestId !== "string" || !rootIdPattern.test(requestId) ||
    (identity.requestId && requestId !== identity.requestId) ||
    typeof status !== "string" || !statusValues.includes(status as DispatchStatus) ||
    deliveryCount === null || !createdAt || !Number.isFinite(Date.parse(createdAt))) throw invalid();

  const assignmentMode: AssignmentMode = payload.assignmentMode === "batch" || payload.assignmentMode === "individual"
    ? payload.assignmentMode : configuration.assignmentMode;
  const requestType = payload.requestType === "batch" || payload.requestType === "parent"
    ? payload.requestType : assignmentMode === "batch" ? "batch" : "parent";
  if ((requestType === "batch") !== (assignmentMode === "batch")) throw invalid();

  const childIds = Array.isArray(payload.childRequestIds) ? payload.childRequestIds : [];
  if (childIds.some((id) => typeof id !== "string" || !new RegExp(`^${requestId}_[1-9]\\d*$`).test(id))) throw invalid();

  const deliveries: DispatchRequest["deliveries"] = [];
  if (Array.isArray(payload.deliveries)) {
    if (payload.deliveries.length > configuration.maxDeliveries) throw invalid();
    for (const [index, delivery] of payload.deliveries.entries()) {
      if (!isRecord(delivery)) throw invalid();
      const number = boundedInteger(delivery.deliveryNumber, 1, configuration.maxDeliveries);
      const id = delivery.requestId;
      const status = delivery.status;
      if (number === null || typeof id !== "string" || id !== `${requestId}_${number}` ||
        !["open", "claimed", "cancelled", "closed"].includes(String(status))) throw invalid();
      const driverName = safeDriverName(delivery.driverName);
      const assignedAt = safeText(delivery.assignedAt, 40);
      if (delivery.driverName !== undefined && !driverName) throw invalid();
      if (delivery.assignedAt !== undefined && (!assignedAt || !Number.isFinite(Date.parse(assignedAt)))) throw invalid();
      deliveries.push({
        requestId: id,
        deliveryNumber: number,
        status: status as DispatchRequest["deliveries"][number]["status"],
        ...(driverName ? { driverName } : {}),
        ...(assignedAt ? { assignedAt } : {}),
      });
      if (number !== index + 1) throw invalid();
    }
  } else if (requestType === "parent" && childIds.length) {
    childIds.forEach((id, index) => deliveries.push({
      requestId: id as string,
      deliveryNumber: index + 1,
      status: "open",
    }));
  }
  const openRequestIds = payload.openRequestIds;
  if (openRequestIds !== undefined) {
    if (!Array.isArray(openRequestIds) || openRequestIds.some((id) => typeof id !== "string" || !childIds.includes(id))) throw invalid();
  }
  if (childIds.length && deliveries.length && childIds.some((id, index) => id !== deliveries[index]?.requestId)) throw invalid();
  if (requestType === "parent" && deliveries.length !== deliveryCount) throw invalid();
  const assignedFromItems = deliveries.filter((delivery) => delivery.status === "claimed" || delivery.status === "closed").length;
  const assignedDeliveries = boundedInteger(payload.assignedDeliveries, 0, deliveryCount) ??
    (requestType === "batch" && ["claimed", "fully_assigned"].includes(String(status)) ? deliveryCount : assignedFromItems);
  const remainingDeliveries = boundedInteger(payload.pendingDeliveries ?? payload.remainingDeliveries, 0, deliveryCount) ??
    (requestType === "batch" ? (assignedDeliveries === deliveryCount ? 0 : deliveryCount) :
      deliveries.filter((delivery) => delivery.status === "open").length);
  const totalDeliveries = boundedInteger(payload.totalDeliveries, 1, configuration.maxDeliveries) ?? deliveryCount;
  const parentRequestId = payload.parentRequestId === undefined ? requestId : payload.parentRequestId;
  if (parentRequestId !== requestId) throw invalid();
  const driverName = safeDriverName(payload.driverName);
  const assignedAt = safeText(payload.assignedAt, 40);
  const updatedAt = safeText(payload.updatedAt, 40);
  for (const date of [assignedAt, updatedAt]) {
    if (date && !Number.isFinite(Date.parse(date))) throw invalid();
  }
  return {
    requestId,
    requestType,
    parentRequestId: requestId,
    deliveryCount,
    totalDeliveries,
    assignedDeliveries,
    remainingDeliveries,
    assignmentMode,
    status: status as DispatchStatus,
    childRequestIds: deliveries.map((delivery) => delivery.requestId),
    deliveries,
    ...(driverName ? { driverName } : {}),
    ...(assignedAt ? { assignedAt } : {}),
    createdAt,
    ...(updatedAt ? { updatedAt } : {}),
  };
}

function normalizeConfiguration(value: unknown, restaurantId: string): RestaurantPublic {
  const invalid = () => new RecogidoApiError("invalid_response", undefined, 502, "Configuración inválida del servicio central.", false);
  if (!isRecord(value) || value.success !== true || value.restaurantId !== restaurantId) throw invalid();
  const payload = isRecord(value.restaurant) ? value.restaurant : value;
  const slug = payload.restaurantId ?? payload.slug;
  const maxDeliveries = boundedInteger(payload.maxDeliveries, 1, 20);
  const maxActiveDeliveriesPerDriver = boundedInteger(payload.maxActiveDeliveriesPerDriver, 1, 20);
  const name = safeText(payload.name);
  if (slug !== restaurantId || !name || maxDeliveries === null || maxActiveDeliveriesPerDriver === null ||
    (payload.assignmentMode !== "individual" && payload.assignmentMode !== "batch") ||
    typeof payload.active !== "boolean" || typeof payload.deliveryEnabled !== "boolean") throw invalid();
  return {
    slug: restaurantId,
    name,
    maxDeliveries,
    maxActiveDeliveriesPerDriver,
    assignmentMode: payload.assignmentMode,
    active: payload.active,
    deliveryEnabled: payload.deliveryEnabled,
  };
}

async function centralRequest(
  operation: BackendOperation,
  identity: Identity,
  fields: Record<string, string>,
): Promise<unknown> {
  let config: ReturnType<typeof getBackendConfig>;
  try {
    const legacyDirectAdapterTest = process.env.DISPATCH_LIVE_TEST_ENABLED !== "true" && process.env.DISPATCH_MOCK_MODE === "false";
    if (resolveDispatchMode(identity.restaurantId) !== "twilio" && !legacyDirectAdapterTest) {
      throw new DispatchError(503, "El modo de integración no está disponible.");
    }
    config = getBackendConfig(operation);
  } catch (error: unknown) {
    const notConfigured = error instanceof DispatchError && error.code === "NOT_CONFIGURED";
    throw new RecogidoApiError(
      notConfigured ? "not_configured" : "invalid_response",
      identity.requestId,
      error instanceof DispatchError ? error.statusCode : 503,
      notConfigured ? "La operación todavía no está disponible para producción." : "La integración central no está habilitada o configurada correctamente.",
      false,
    );
  }
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const safeId = identity.requestId && rootIdPattern.test(identity.requestId) ? identity.requestId : "latest";
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(config.authorization ? { Authorization: config.authorization } : {}),
      },
      body: new URLSearchParams({ ...fields, ...(config.secret ? { secret: config.secret } : {}) }),
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) {
      const statusCode = response.status === 404 ? 404 : response.status === 409 ? 409 : response.status === 429 ? 429 : 502;
      throw new RecogidoApiError("http", identity.requestId, statusCode,
        statusCode === 404 ? "Solicitud no encontrada para este restaurante." :
          statusCode === 409 ? "La operación entra en conflicto con el estado del servicio central." :
            statusCode === 429 ? "Demasiadas operaciones. Espera un momento y vuelve a intentar." :
              "El servicio central no pudo completar la operación.",
        response.status >= 500 || response.status === 429);
    }
    try {
      const data: unknown = await response.json();
      if (containsSensitiveValue(data, [
        config.secret ?? "",
        config.url,
        config.makeWebhookUrl ?? "",
        config.authorization ?? "",
        config.username ?? "",
        config.password ?? "",
      ])) {
        throw new RecogidoApiError("invalid_response", identity.requestId, 502, "Respuesta inválida del servicio central.", false);
      }
      console.info("Dispatch central", {
        operation,
        requestId: safeId,
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
      });
      return data;
    } catch {
      if (controller.signal.aborted) throw new RecogidoApiError("timeout", identity.requestId, 504, "El servicio central tardó demasiado. Reintenta la misma operación.", true);
      throw new RecogidoApiError("invalid_response", identity.requestId, 502, "Respuesta inválida del servicio central.", false);
    }
  } catch (error: unknown) {
    const safeError = error instanceof RecogidoApiError ? error :
      controller.signal.aborted
        ? new RecogidoApiError("timeout", identity.requestId, 504, "El servicio central tardó demasiado. Reintenta la misma operación.", true)
        : new RecogidoApiError("network", identity.requestId, 502, "No se pudo contactar al servicio central. Reintenta la misma operación.", true);
    console.warn("Dispatch central", {
      operation,
      requestId: safeId,
      code: safeError.code,
      statusCode: safeError.statusCode,
      durationMs: Date.now() - startedAt,
    });
    throw safeError;
  } finally {
    clearTimeout(timeout);
  }
}

async function startMakeTimer(input: {
  restaurantId: string;
  restaurantPhone: string;
  deliveryCount: number;
}, request: DispatchRequest, generation: string): Promise<void> {
  const config = getBackendConfig("create");
  if (!config.makeWebhookUrl || !config.makeTimerSecret) {
    throw new RecogidoApiError("not_configured", request.requestId, 503, "El temporizador de Make todavía no está configurado.", false);
  }
  const timerKey = `${request.requestId}:${generation}`;
  const startedTimers = globalThis.recogidoMakeTimersStarted ??= new Set<string>();
  if (startedTimers.has(timerKey)) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(config.makeWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": timerKey },
      body: new URLSearchParams({
        requestId: request.requestId,
        restaurantId: input.restaurantId,
        restaurantPhone: input.restaurantPhone,
        deliveryCount: String(input.deliveryCount),
        timerGeneration: generation,
        secret: config.makeTimerSecret,
      }),
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new RecogidoApiError("http", request.requestId, 502, "No se pudo iniciar el temporizador de despacho.", response.status >= 500 || response.status === 429);
    }
    startedTimers.add(timerKey);
    console.info("Dispatch central", {
      operation: "make_timer",
      requestId: request.requestId,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
    });
  } catch (error: unknown) {
    const timerFailure = error instanceof RecogidoApiError ? error :
      controller.signal.aborted
        ? new RecogidoApiError("timeout", request.requestId, 504, "El temporizador de despacho tardó demasiado en iniciar.", true)
        : new RecogidoApiError("network", request.requestId, 502, "No se pudo iniciar el temporizador de despacho.", true);
    const safeError = new RecogidoApiError(
      "timer_error",
      request.requestId,
      202,
      "Solicitud creada en Twilio, pero no se pudo confirmar el temporizador de alertas.",
      timerFailure.retryable,
    );
    safeError.createdRequest = request;
    console.warn("Dispatch central", {
      operation: "make_timer",
      requestId: request.requestId,
      code: safeError.code,
      statusCode: safeError.statusCode,
      durationMs: Date.now() - startedAt,
    });
    throw safeError;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getRestaurantConfiguration(input: {
  restaurantId: string;
  fallback: RestaurantPublic;
}): Promise<RestaurantPublic> {
  if (resolveDispatchMode(input.restaurantId) !== "twilio") return { ...input.fallback };
  const value = await centralRequest("config", { restaurantId: input.restaurantId }, { restaurantId: input.restaurantId });
  const configuration = normalizeConfiguration(value, input.restaurantId);
  if (input.restaurantId === "restaurant-test" &&
    (configuration.maxDeliveries !== 3 || configuration.assignmentMode !== "individual" ||
      configuration.maxActiveDeliveriesPerDriver !== 1 || configuration.active === false || configuration.deliveryEnabled === false)) {
    throw new RecogidoApiError("invalid_response", undefined, 503, "La configuración de prueba no coincide con el perfil autorizado.", false);
  }
  return configuration;
}

export async function createDeliveryRequest(input: CreateDeliveryRequestInput): Promise<DispatchRequest> {
  const value = await centralRequest("create", input, {
    restaurantId: input.restaurantId,
    restaurantName: input.restaurantName,
    restaurantPhone: input.restaurantPhone,
    deliveryCount: String(input.deliveryCount),
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
  });
  const request = normalizeRequest(value, { restaurantId: input.restaurantId }, input.configuration, true);
  if (!request) throw new RecogidoApiError("invalid_response", input.requestId, 502, "Respuesta inválida del servicio central.", false);
  await startMakeTimer(input, request, "initial");
  return request;
}

export async function getDeliveryRequestStatus(input: Identity & { configuration: RestaurantPublic }): Promise<DispatchRequest | null> {
  const value = await centralRequest("status", input, {
    restaurantId: input.restaurantId,
    requestId: input.requestId ?? "",
  });
  return normalizeRequest(value, input, input.configuration);
}

export async function cancelDeliveryRequest(input: Identity & { requestId: string; configuration: RestaurantPublic }): Promise<DispatchRequest> {
  const value = await centralRequest("cancel", input, { restaurantId: input.restaurantId, requestId: input.requestId });
  const request = normalizeRequest(value, input, input.configuration);
  if (!request) throw new RecogidoApiError("invalid_response", input.requestId, 502, "Respuesta inválida del servicio central.", false);
  return request;
}

export async function resendDeliveryRequest(input: Identity & {
  requestId: string;
  configuration: RestaurantPublic;
  openRequestIds: string[];
  restaurantPhone: string;
}): Promise<DispatchRequest> {
  const value = await centralRequest("resend", input, {
    restaurantId: input.restaurantId,
    requestId: input.requestId,
    openRequestIds: input.openRequestIds.join(","),
  });
  const request = normalizeRequest(value, input, input.configuration);
  if (!request) throw new RecogidoApiError("invalid_response", input.requestId, 502, "Respuesta inválida del servicio central.", false);
  await startMakeTimer({
    restaurantId: input.restaurantId,
    restaurantPhone: input.restaurantPhone,
    deliveryCount: request.deliveryCount,
  }, request, `resend:${request.updatedAt ?? request.createdAt}`);
  return request;
}

export async function getRecentDeliveryRequests(input: Identity & { configuration: RestaurantPublic }): Promise<DispatchRequest[]> {
  const value = await centralRequest("history", input, { restaurantId: input.restaurantId });
  if (!isRecord(value) || value.success !== true || value.restaurantId !== input.restaurantId || !Array.isArray(value.requests)) {
    throw new RecogidoApiError("invalid_response", undefined, 502, "Historial inválido del servicio central.", false);
  }
  if (value.requests.length > 5) throw new RecogidoApiError("invalid_response", undefined, 502, "Historial inválido del servicio central.", false);
  return value.requests.map((request) => normalizeRequest({ success: true, restaurantId: input.restaurantId, request }, input, input.configuration))
    .filter((request): request is DispatchRequest => request !== null);
}
