import "server-only";
import { randomUUID } from "node:crypto";
import type { DispatchRequest, DispatchSnapshot, RestaurantPublic } from "../dispatch-types";
import {
  cancelDeliveryRequest,
  createDeliveryRequest,
  getDeliveryRequestStatus,
  getRecentDeliveryRequests,
  getRestaurantConfiguration,
  resendDeliveryRequest,
} from "../recogido-api";
import { isOpenRequest } from "../dispatch-types";
import { DispatchError, isDispatchMockMode, type RestaurantConfig } from "./config";
import {
  cancelRequest,
  createRequest,
  publicConfiguration,
  recentRequests,
  resendRequest,
  snapshot,
} from "./mock-store";

async function restaurantConfiguration(restaurant: RestaurantConfig): Promise<RestaurantPublic> {
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
    mockMode: isDispatchMockMode(),
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
  if (isDispatchMockMode()) {
    const result = createRequest({ ...restaurant, ...configuration }, deliveryCount, idempotencyKey);
    return { data: result.data, statusCode: result.reused ? 200 : 201 };
  }
  const requestId = `WEB_${randomUUID().replaceAll("-", "")}`;
  const request = await createDeliveryRequest({
    restaurantId: restaurant.slug,
    restaurantName: configuration.name,
    restaurantPhone: restaurant.phone,
    deliveryCount,
    requestId,
    idempotencyKey,
    configuration,
  });
  return {
    data: makeSnapshot(restaurant, configuration, request, [request]),
    statusCode: 201,
  };
}

export async function statusDispatch(restaurant: RestaurantConfig, requestId?: string) {
  const configuration = await restaurantConfiguration(restaurant);
  if (isDispatchMockMode()) return snapshot({ ...restaurant, ...configuration }, requestId);
  const request = await getDeliveryRequestStatus({ restaurantId: restaurant.slug, requestId, configuration });
  return makeSnapshot(restaurant, configuration, request, request ? [request] : []);
}

export async function cancelDispatch(restaurant: RestaurantConfig, requestId: string) {
  const configuration = await restaurantConfiguration(restaurant);
  if (isDispatchMockMode()) return cancelRequest({ ...restaurant, ...configuration }, requestId);
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
  const configuration = await restaurantConfiguration(restaurant);
  if (isDispatchMockMode()) return resendRequest({ ...restaurant, ...configuration }, requestId);
  const current = await getDeliveryRequestStatus({ restaurantId: restaurant.slug, requestId, configuration });
  if (!current) throw new DispatchError(404, "Solicitud no encontrada para este restaurante.");
  const openRequestIds = current.assignmentMode === "batch"
    ? (current.status === "open" ? [current.requestId] : [])
    : current.deliveries.filter((delivery) => delivery.status === "open").map((delivery) => delivery.requestId);
  if (!isOpenRequest(current.status) || openRequestIds.length === 0) {
    throw new DispatchError(409, "No hay entregas abiertas para volver a ofrecer.");
  }
  const updated = await resendDeliveryRequest({
    restaurantId: restaurant.slug,
    requestId,
    configuration,
    openRequestIds,
  });
  return makeSnapshot(
    restaurant,
    configuration,
    updated,
    [updated],
  );
}

export async function recentDispatch(restaurant: RestaurantConfig) {
  const configuration = await restaurantConfiguration(restaurant);
  if (isDispatchMockMode()) {
    return makeSnapshot(restaurant, configuration, snapshot({ ...restaurant, ...configuration }).request, recentRequests({ ...restaurant, ...configuration }));
  }
  const history = await getRecentDeliveryRequests({ restaurantId: restaurant.slug, configuration });
  const activeRequest = history.find((request) => isOpenRequest(request.status)) ?? history[0] ?? null;
  return makeSnapshot(restaurant, configuration, activeRequest, history);
}
