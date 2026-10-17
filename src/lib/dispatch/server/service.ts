import "server-only";
import type { DispatchHistorySnapshot, DispatchRequest, DispatchSnapshot, RestaurantPublic } from "../dispatch-types";
import {
  cancelDeliveryRequest,
  createDeliveryRequest,
  getDeliveryHistory,
  getDeliveryRequestStatus,
  getRecentDeliveryRequests,
  getActiveDeliveryRequests,
  getRestaurantConfiguration,
  resendDeliveryRequest,
  RecogidoApiError,
} from "../recogido-api";
import { isOpenRequest, isValidIdempotencyKey } from "../dispatch-types";
import { DispatchError, isLiveTestPilotRequested, requireDispatchCapability, resolveDispatchMode, type RestaurantConfig } from "./config";
import {
  cancelRequest,
  createRequest,
  historyRecords,
  publicConfiguration,
  recentRequests,
  resendRequest,
  snapshot,
} from "./mock-store";

async function restaurantConfiguration(restaurant: RestaurantConfig): Promise<RestaurantPublic> {
  if (isLiveTestPilotRequested(restaurant.slug) && resolveDispatchMode(restaurant.slug) !== "twilio") {
    throw new DispatchError(503, "La configuración del piloto de Dispatch está incompleta.", "NOT_CONFIGURED");
  }
  if (resolveDispatchMode(restaurant.slug) !== "twilio") {
    const fallback = publicConfiguration(restaurant);
    if (!fallback.active) throw new DispatchError(403, "Este restaurante está inactivo.");
    if (!fallback.deliveryEnabled) throw new DispatchError(403, "El despacho de entregas no está habilitado para este restaurante.");
    return fallback;
  }
  const configuration = await getRestaurantConfiguration({
    restaurantId: restaurant.slug,
    fallback: publicConfiguration(restaurant),
  });
  if (!configuration.active) throw new DispatchError(403, "Este restaurante está inactivo.");
  if (!configuration.deliveryEnabled) throw new DispatchError(403, "El despacho de entregas no está habilitado para este restaurante.");
  return configuration;
}

function makeSnapshot(
  restaurant: RestaurantConfig,
  configuration: RestaurantPublic,
  request: DispatchRequest | null,
  history: DispatchRequest[],
): DispatchSnapshot {
  return {
    mockMode: resolveDispatchMode(restaurant.slug) !== "twilio",
    restaurant: configuration,
    request,
    history: history.slice(0, 5),
  };
}

export async function getDispatchConfiguration(restaurant: RestaurantConfig): Promise<DispatchSnapshot> {
  const configuration = await restaurantConfiguration(restaurant);
  return makeSnapshot(restaurant, configuration, null, []);
}

export async function submitDispatch(restaurant: RestaurantConfig, deliveryCount: number, idempotencyKey: string) {
  if (!isValidIdempotencyKey(idempotencyKey)) {
    throw new DispatchError(400, "Clave de idempotencia inválida.");
  }
  const configuration = await restaurantConfiguration(restaurant);
  if (!Number.isInteger(deliveryCount) || deliveryCount < 1 || deliveryCount > configuration.maxDeliveries) {
    throw new DispatchError(400, `La cantidad debe ser un entero entre 1 y ${configuration.maxDeliveries}.`);
  }
  if (resolveDispatchMode(restaurant.slug) === "mock") {
    const result = createRequest({ ...restaurant, ...configuration }, deliveryCount, idempotencyKey);
    return { data: result.data, statusCode: result.reused ? 200 : 201 };
  }
  const restaurantPhone = restaurant.phone;
  let request: DispatchRequest;
  let operationStatus: DispatchSnapshot["operationStatus"];
  try {
    request = await createDeliveryRequest({
      restaurantId: restaurant.slug,
      restaurantPhone,
      deliveryCount,
      idempotencyKey,
      configuration,
    });
  } catch (error: unknown) {
    if (!(error instanceof RecogidoApiError) || error.code !== "timer_error") throw error;
    operationStatus = "created_with_timer_error";
    if (!error.createdRequest) throw error;
    request = error.createdRequest;
  }
  return {
    data: {
      ...makeSnapshot(restaurant, configuration, request, [request]),
      ...(operationStatus ? { operationStatus } : {}),
    },
    statusCode: operationStatus ? 202 : 201,
  };
}

export async function statusDispatch(restaurant: RestaurantConfig, requestId?: string) {
  const configuration = await restaurantConfiguration(restaurant);
  if (resolveDispatchMode(restaurant.slug) === "mock") return snapshot({ ...restaurant, ...configuration }, requestId);
  const request = await getDeliveryRequestStatus({ restaurantId: restaurant.slug, requestId, configuration });
  return makeSnapshot(restaurant, configuration, request, request ? [request] : []);
}

export async function activeDispatch(restaurant: RestaurantConfig) {
  requireDispatchCapability(restaurant.slug, "canLoadActive");
  const configuration = await restaurantConfiguration(restaurant);
  return getActiveDeliveryRequests({ restaurantId: restaurant.slug, configuration });
}

type CancelResult = DispatchSnapshot & { cancelledDeliveries: number };

declare global {
  var recogidoDispatchCancelInFlight: Map<string, Promise<CancelResult>> | undefined;
}

/** Deliveries that cancel_pending may still touch; claimed/assigned/closed ones never count. */
function pendingDeliveries(request: DispatchRequest) {
  if (!isOpenRequest(request.status)) return 0;
  return request.assignmentMode === "batch"
    ? (request.status === "open" ? request.remainingDeliveries : 0)
    : request.deliveries.filter((delivery) => delivery.status === "open").length;
}

export async function cancelDispatch(restaurant: RestaurantConfig, requestId: string): Promise<CancelResult> {
  requireDispatchCapability(restaurant.slug, "canCancel");
  const configuration = await restaurantConfiguration(restaurant);
  if (resolveDispatchMode(restaurant.slug) === "mock") return cancelRequest({ ...restaurant, ...configuration }, requestId);
  // A double click or retried request shares the in-flight operation instead of reaching Twilio twice.
  const inFlight = globalThis.recogidoDispatchCancelInFlight ??= new Map();
  const key = `${restaurant.slug}:${requestId}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const operation = cancelPendingLive(restaurant, configuration, requestId).finally(() => inFlight.delete(key));
  inFlight.set(key, operation);
  return operation;
}

async function cancelPendingLive(restaurant: RestaurantConfig, configuration: RestaurantPublic, requestId: string): Promise<CancelResult> {
  const identity = { restaurantId: restaurant.slug, requestId, configuration };
  const unchanged = (request: DispatchRequest): CancelResult =>
    ({ ...makeSnapshot(restaurant, configuration, request, [request]), cancelledDeliveries: 0 });
  const current = await getDeliveryRequestStatus(identity);
  if (!current) throw new DispatchError(404, "Solicitud no encontrada para este restaurante.");
  const pendingBefore = pendingDeliveries(current);
  // Idempotent: nothing left to cancel is a confirmed no-op, never a second upstream call.
  if (pendingBefore === 0) return unchanged(current);

  let result: Awaited<ReturnType<typeof cancelDeliveryRequest>>;
  try {
    result = await cancelDeliveryRequest(identity);
  } catch (error: unknown) {
    // Upstream 409 means the deliveries stopped being pending meanwhile (claimed or already cancelled).
    if (error instanceof RecogidoApiError && error.statusCode === 409) {
      const latest = await getDeliveryRequestStatus(identity).catch(() => null);
      if (latest && pendingDeliveries(latest) === 0) return unchanged(latest);
    }
    throw error;
  }
  const { request: cancelled } = result;
  const invalid = () => new DispatchError(502, "El servicio central no conservó una entrega ya asignada.");
  if (cancelled.assignedDeliveries < current.assignedDeliveries) throw invalid();
  if (current.assignmentMode === "individual") {
    const after = new Map(cancelled.deliveries.map((delivery) => [delivery.requestId, delivery]));
    for (const delivery of current.deliveries.filter((item) => item.status === "claimed" || item.status === "closed")) {
      const next = after.get(delivery.requestId)?.status;
      if (next !== "claimed" && next !== "closed") throw invalid();
    }
  }
  const cancelledByDiff = current.assignmentMode === "individual"
    ? current.deliveries.filter((delivery) => delivery.status === "open" &&
      cancelled.deliveries.find((item) => item.requestId === delivery.requestId)?.status === "cancelled").length
    : cancelled.status === "cancelled" ? pendingBefore : 0;
  const cancelledDeliveries = result.cancelledDeliveries ?? cancelledByDiff;
  if (cancelledDeliveries > pendingBefore) {
    throw new DispatchError(502, "Respuesta inválida del servicio central.");
  }
  return { ...makeSnapshot(restaurant, configuration, cancelled, [cancelled]), cancelledDeliveries };
}

export async function resendDispatch(restaurant: RestaurantConfig, requestId: string) {
  requireDispatchCapability(restaurant.slug, "canResend");
  const configuration = await restaurantConfiguration(restaurant);
  if (resolveDispatchMode(restaurant.slug) === "mock") return resendRequest({ ...restaurant, ...configuration }, requestId);
  const current = await getDeliveryRequestStatus({ restaurantId: restaurant.slug, requestId, configuration });
  if (!current) throw new DispatchError(404, "Solicitud no encontrada para este restaurante.");
  const openRequestIds = current.assignmentMode === "batch"
    ? (current.status === "open" ? [current.requestId] : [])
    : current.deliveries.filter((delivery) => delivery.status === "open").map((delivery) => delivery.requestId);
  if (!isOpenRequest(current.status) || openRequestIds.length === 0) {
    throw new DispatchError(409, "No hay entregas abiertas para volver a ofrecer.");
  }
  let updated: DispatchRequest;
  let operationStatus: DispatchSnapshot["operationStatus"];
  try {
    updated = await resendDeliveryRequest({
      restaurantId: restaurant.slug,
      requestId,
      configuration,
      openRequestIds,
      restaurantPhone: restaurant.phone,
    });
  } catch (error: unknown) {
    if (!(error instanceof RecogidoApiError) || error.code !== "timer_error" || !error.createdRequest) throw error;
    updated = error.createdRequest;
    operationStatus = "created_with_timer_error";
  }
  return {
    ...makeSnapshot(restaurant, configuration, updated, [updated]),
    ...(operationStatus ? { operationStatus } : {}),
  };
}

export async function recentDispatch(restaurant: RestaurantConfig) {
  requireDispatchCapability(restaurant.slug, "canLoadHistory");
  const configuration = await restaurantConfiguration(restaurant);
  if (resolveDispatchMode(restaurant.slug) === "mock") {
    return makeSnapshot(restaurant, configuration, snapshot({ ...restaurant, ...configuration }).request, recentRequests({ ...restaurant, ...configuration }));
  }
  const history = await getRecentDeliveryRequests({ restaurantId: restaurant.slug, configuration });
  const activeRequest = history.find((request) => isOpenRequest(request.status)) ?? history[0] ?? null;
  return makeSnapshot(restaurant, configuration, activeRequest, history);
}

/**
 * Real delivery history for the authenticated restaurant. The restaurant always comes from the
 * server-side profile; mock restaurants read the in-memory simulator and never reach Twilio.
 */
export async function historyDispatch(restaurant: RestaurantConfig): Promise<DispatchHistorySnapshot> {
  requireDispatchCapability(restaurant.slug, "canLoadHistory");
  const configuration = await restaurantConfiguration(restaurant);
  if (resolveDispatchMode(restaurant.slug) === "mock") return historyRecords({ ...restaurant, ...configuration });
  return getDeliveryHistory({ restaurantId: restaurant.slug });
}
