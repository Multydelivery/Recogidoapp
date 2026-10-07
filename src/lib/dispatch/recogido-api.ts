import "server-only";
import { dispatchStatusLabels, type DeliveryRequestResult } from "./dispatch-types";
import { DispatchError, getBackendConfig, isDispatchMockMode } from "./server/config";

export type BackendErrorCode = "configuration" | "timeout" | "network" | "http" | "invalid_response" | "rejected";

export class RecogidoApiError extends DispatchError {
  constructor(
    public readonly code: BackendErrorCode,
    public readonly requestId: string | undefined,
    statusCode: number,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(statusCode, message);
  }
}

interface RequestIdentity {
  restaurantId: string;
  requestId?: string;
}

export interface SubmitDeliveryInput extends RequestIdentity {
  requestId: string;
  restaurantName: string;
  restaurantPhone: string;
  deliveryCount: number;
  idempotencyKey: string;
}

const requestIdPattern = /^WEB_\d{13}_[a-f0-9]{16}$/;

function isStatus(value: string): value is DeliveryRequestResult["status"] {
  return Object.hasOwn(dispatchStatusLabels, value);
}

function normalize(value: unknown, identity: RequestIdentity, sensitiveValues: string[]): DeliveryRequestResult | null {
  const invalid = () => new RecogidoApiError("invalid_response", identity.requestId, 502, "Respuesta inválida del servicio central.", false);
  if (!value || typeof value !== "object" ||
    !("success" in value) || typeof value.success !== "boolean" ||
    !("restaurantId" in value) || value.restaurantId !== identity.restaurantId) throw invalid();
  if (!value.success) throw new RecogidoApiError("rejected", identity.requestId, 502, "El servicio central no confirmó la operación.", false);
  if (!identity.requestId && "request" in value && value.request === null) return null;
  if (!("requestId" in value) || typeof value.requestId !== "string" || !requestIdPattern.test(value.requestId) ||
    !("status" in value) || typeof value.status !== "string" || !isStatus(value.status)) throw invalid();
  // Submit may return the canonical ID from an earlier idempotent attempt.
  if (identity.requestId && value.requestId !== identity.requestId) throw invalid();
  const result: DeliveryRequestResult = {
    success: true,
    requestId: value.requestId,
    status: value.status,
  };
  if ("deliveryCount" in value) {
    if (typeof value.deliveryCount !== "number" || !Number.isInteger(value.deliveryCount) || value.deliveryCount < 1 || value.deliveryCount > 9) throw invalid();
    result.deliveryCount = value.deliveryCount;
  }
  const optional: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  for (const key of ["restaurantName", "driverName", "driverPhone", "createdAt", "updatedAt"] as const) {
    if (!(key in value)) continue;
    const text = optional[key];
    if (typeof text !== "string" || text.length > 100 || /[\u0000-\u001f]/.test(text) ||
      text.includes("://") || sensitiveValues.some((secret) => secret && text.includes(secret))) throw invalid();
    if ((key === "createdAt" || key === "updatedAt") && !Number.isFinite(Date.parse(text))) throw invalid();
    if (key === "driverPhone" && !/^\+[1-9]\d{7,14}$/.test(text)) throw invalid();
    result[key] = text;
  }
  // Never pass through external messages: they can echo secrets or endpoint URLs.
  if (result.status === "error") result.message = "El servicio central informó un error en la solicitud.";
  return result;
}

async function callCentral(
  operation: "submit" | "cancel" | "status",
  identity: RequestIdentity,
  fields: Record<string, string>,
): Promise<DeliveryRequestResult | null> {
  const safeId = identity.requestId && requestIdPattern.test(identity.requestId) ? identity.requestId : "latest";
  let config: ReturnType<typeof getBackendConfig>;
  try {
    if (isDispatchMockMode()) throw new Error("mock");
    config = getBackendConfig();
  } catch {
    console.warn("Dispatch central", { operation, requestId: safeId, code: "configuration" });
    throw new RecogidoApiError("configuration", identity.requestId, 503, "El adaptador central no está habilitado o configurado correctamente.", false);
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const endpoint = operation === "submit" ? config.submitUrl : operation === "cancel" ? config.manageUrl : config.statusUrl;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, secret: config.secret }),
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) {
      const code = response.status === 404 ? 404 : response.status === 409 ? 409 : 502;
      throw new RecogidoApiError("http", identity.requestId, code,
        code === 404 ? "Solicitud no encontrada para este restaurante." :
          code === 409 ? "La operación entra en conflicto con el estado del servicio central." : "El servicio central no pudo completar la operación.",
        response.status >= 500 || response.status === 429);
    }
    let data: unknown;
    try { data = await response.json(); } catch {
      if (controller.signal.aborted) throw new RecogidoApiError("timeout", identity.requestId, 504, "El servicio central tardó demasiado. Reintenta la misma operación.", true);
      throw new RecogidoApiError("invalid_response", identity.requestId, 502, "Respuesta inválida del servicio central.", false);
    }
    const result = normalize(data, operation === "submit" ? { restaurantId: identity.restaurantId } : identity,
      [config.secret, config.submitUrl, config.manageUrl, config.statusUrl]);
    if (operation !== "status" && !result) throw new RecogidoApiError("invalid_response", identity.requestId, 502, "Respuesta inválida del servicio central.", false);
    console.info("Dispatch central", { operation, requestId: result?.requestId ?? safeId, outcome: "confirmed" });
    return result;
  } catch (error: unknown) {
    const safeError = error instanceof RecogidoApiError ? error :
      controller.signal.aborted
        ? new RecogidoApiError("timeout", identity.requestId, 504, "El servicio central tardó demasiado. Reintenta la misma operación.", true)
        : new RecogidoApiError("network", identity.requestId, 502, "No se pudo contactar al servicio central. Reintenta la misma operación.", true);
    console.warn("Dispatch central", { operation, requestId: safeId, code: safeError.code });
    throw safeError;
  } finally {
    clearTimeout(timeout);
  }
}

export async function submitDeliveryRequest(input: SubmitDeliveryInput) {
  return callCentral("submit", input, {
    restaurantId: input.restaurantId,
    restaurantName: input.restaurantName,
    restaurantPhone: input.restaurantPhone,
    deliveryCount: String(input.deliveryCount),
    requestId: input.requestId,
    idempotencyKey: input.idempotencyKey,
  });
}

export async function cancelDeliveryRequest(input: RequestIdentity & { requestId: string }) {
  return callCentral("cancel", input, { action: "cancel", restaurantId: input.restaurantId, requestId: input.requestId });
}

export async function getDeliveryRequestStatus(input: RequestIdentity) {
  return callCentral("status", input, { restaurantId: input.restaurantId, requestId: input.requestId ?? "" });
}
