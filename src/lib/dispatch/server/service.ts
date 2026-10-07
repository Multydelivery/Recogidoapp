import "server-only";
import { randomBytes } from "node:crypto";
import { cancelDeliveryRequest, getDeliveryRequestStatus, submitDeliveryRequest } from "../recogido-api";
import { isOpenRequest, type DeliveryRequestResult, type DispatchRequest, type DispatchSnapshot } from "../dispatch-types";
import { DispatchError, isDispatchMockMode, type RestaurantConfig } from "./config";
import { cancelRequest, createRequest, snapshot } from "./mock-store";

function realSnapshot(restaurant: RestaurantConfig, result: DeliveryRequestResult | null): DispatchSnapshot {
  let request: DispatchRequest | null = null;
  if (result) {
    if (result.deliveryCount === undefined || result.createdAt === undefined) {
      throw new DispatchError(502, "Respuesta incompleta del servicio central.");
    }
    request = {
      requestId: result.requestId,
      deliveryCount: result.deliveryCount,
      status: result.status,
      createdAt: result.createdAt,
      ...(result.driverName ? { driverName: result.driverName } : {}),
    };
  }
  return { mockMode: false, restaurant: { slug: restaurant.slug, name: restaurant.name }, request, history: request ? [request] : [] };
}

export async function submitDispatch(restaurant: RestaurantConfig, deliveryCount: number, idempotencyKey: string) {
  if (isDispatchMockMode()) {
    const result = createRequest(restaurant, deliveryCount, idempotencyKey);
    return { data: result.data, statusCode: result.reused ? 200 : 201 };
  }
  const requestId = `WEB_${Date.now()}_${randomBytes(8).toString("hex")}`;
  const result = await submitDeliveryRequest({
    restaurantId: restaurant.slug,
    restaurantName: restaurant.name,
    restaurantPhone: restaurant.phone,
    deliveryCount,
    requestId,
    idempotencyKey,
  });
  if (!result || result.deliveryCount !== deliveryCount) throw new DispatchError(502, "Respuesta incompleta del servicio central.");
  return { data: realSnapshot(restaurant, result), statusCode: 200 };
}

export async function statusDispatch(restaurant: RestaurantConfig, requestId?: string) {
  if (isDispatchMockMode()) return snapshot(restaurant, requestId);
  return realSnapshot(restaurant, await getDeliveryRequestStatus({ restaurantId: restaurant.slug, requestId }));
}

export async function cancelDispatch(restaurant: RestaurantConfig, requestId: string) {
  if (isDispatchMockMode()) return cancelRequest(restaurant, requestId);
  // The central backend validates ownership on reads and atomically on cancel.
  const current = await getDeliveryRequestStatus({ restaurantId: restaurant.slug, requestId });
  if (!current) throw new DispatchError(404, "Solicitud no encontrada para este restaurante.");
  if (current.status === "cancelled") return realSnapshot(restaurant, current);
  if (!isOpenRequest(current.status)) throw new DispatchError(409, "No se puede cancelar esta solicitud.");
  const cancelled = await cancelDeliveryRequest({ restaurantId: restaurant.slug, requestId });
  if (!cancelled || cancelled.status !== "cancelled") throw new DispatchError(502, "El servicio central no confirmó la cancelación.");
  return realSnapshot(restaurant, cancelled);
}
