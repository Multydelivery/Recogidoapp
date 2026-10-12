import "server-only";
import type { DispatchRequest, DispatchSnapshot, RestaurantPublic } from "../dispatch-types";
import {
  cancelDeliveryRequest,
  createDeliveryRequest,
  getDeliveryRequestStatus,
  getRecentDeliveryRequests,
  getRestaurantConfiguration,
  resendDeliveryRequest,
  stableLiveTestRequestId,
  RecogidoApiError,
} from "../recogido-api";
import { isOpenRequest } from "../dispatch-types";
import { DispatchError, isLiveTestPilotRequested, requireDispatchCapability, resolveDispatchMode, type RestaurantConfig } from "./config";
import {
  cancelRequest,
  createRequest,
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
  const configuration = await restaurantConfiguration(restaurant);
  if (!Number.isInteger(deliveryCount) || deliveryCount < 1 || deliveryCount > configuration.maxDeliveries) {
    throw new DispatchError(400, `La cantidad debe ser un entero entre 1 y ${configuration.maxDeliveries}.`);
  }
  if (resolveDispatchMode(restaurant.slug) === "mock") {
    const result = createRequest({ ...restaurant, ...configuration }, deliveryCount, idempotencyKey);
    return { data: result.data, statusCode: result.reused ? 200 : 201 };
  }
  const requestId = stableLiveTestRequestId(restaurant.slug, idempotencyKey);
  const restaurantPhone = restaurant.phone;
  let request: DispatchRequest;
  let operationStatus: DispatchSnapshot["operationStatus"];
  try {
    request = await createDeliveryRequest({
      restaurantId: restaurant.slug,
      restaurantName: configuration.name,
      restaurantPhone,
      deliveryCount,
      requestId,
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

export async function cancelDispatch(restaurant: RestaurantConfig, requestId: string) {
  requireDispatchCapability(restaurant.slug, "canCancel");
  const configuration = await restaurantConfiguration(restaurant);
  if (resolveDispatchMode(restaurant.slug) === "mock") return cancelRequest({ ...restaurant, ...configuration }, requestId);
  const current = await getDeliveryRequestStatus({ restaurantId: restaurant.slug, requestId, configuration });
  if (!current) throw new DispatchError(404, "Solicitud no encontrada para este restaurante.");
  if (current.status === "cancelled") return makeSnapshot(restaurant, configuration, current, [current]);
  const hasOpenDeliveries = current.assignmentMode === "batch"
    ? current.status === "open" && current.remainingDeliveries > 0
    : current.deliveries.some((delivery) => delivery.status === "open");
  if (!isOpenRequest(current.status) || !hasOpenDeliveries) {
    throw new DispatchError(409, "No quedan entregas abiertas para cancelar.");
  }
  const cancelled = await cancelDeliveryRequest({ restaurantId: restaurant.slug, requestId, configuration });
  if (current.assignmentMode === "individual") {
    const after = new Map(cancelled.deliveries.map((delivery) => [delivery.requestId, delivery]));
    for (const delivery of current.deliveries.filter((item) => item.status === "claimed")) {
      if (after.get(delivery.requestId)?.status !== "claimed") {
        throw new DispatchError(502, "El servicio central no conservó una entrega ya asignada.");
      }
    }
  }
  return makeSnapshot(
    restaurant,
    configuration,
    cancelled,
    [cancelled],
  );
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
