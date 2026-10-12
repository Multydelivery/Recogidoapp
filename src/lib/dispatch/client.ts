import { dispatchStatusLabels, type DispatchRequest, type DispatchSnapshot, type RestaurantPublic } from "./dispatch-types";

export class DispatchApiError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

function isRequest(value: unknown): value is DispatchRequest {
  return !!value && typeof value === "object" &&
    "requestId" in value && typeof value.requestId === "string" && /^WEB_[a-f0-9]{32}$/.test(value.requestId) &&
    "requestType" in value && (value.requestType === "parent" || value.requestType === "batch") &&
    "parentRequestId" in value && value.parentRequestId === value.requestId &&
    "deliveryCount" in value && typeof value.deliveryCount === "number" && Number.isInteger(value.deliveryCount) && value.deliveryCount >= 1 && value.deliveryCount <= 20 &&
    "totalDeliveries" in value && typeof value.totalDeliveries === "number" &&
    "assignedDeliveries" in value && typeof value.assignedDeliveries === "number" &&
    "remainingDeliveries" in value && typeof value.remainingDeliveries === "number" &&
    "assignmentMode" in value && (value.assignmentMode === "individual" || value.assignmentMode === "batch") &&
    "status" in value && typeof value.status === "string" && Object.hasOwn(dispatchStatusLabels, value.status) &&
    "createdAt" in value && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt)) &&
    "childRequestIds" in value && Array.isArray(value.childRequestIds) &&
    "deliveries" in value && Array.isArray(value.deliveries) && value.deliveries.every((delivery) =>
      !!delivery && typeof delivery === "object" && "requestId" in delivery && typeof delivery.requestId === "string" &&
      "deliveryNumber" in delivery && typeof delivery.deliveryNumber === "number" &&
      "status" in delivery && ["open", "claimed", "cancelled", "closed"].includes(String(delivery.status)) &&
      (!("driverName" in delivery) || typeof delivery.driverName === "string") &&
      (!("assignedAt" in delivery) || (typeof delivery.assignedAt === "string" && Number.isFinite(Date.parse(delivery.assignedAt))))) &&
    (!("driverName" in value) || typeof value.driverName === "string");
}

function isRestaurant(value: unknown): value is RestaurantPublic {
  return !!value && typeof value === "object" &&
    "slug" in value && typeof value.slug === "string" &&
    "name" in value && typeof value.name === "string" &&
    "active" in value && typeof value.active === "boolean" &&
    "deliveryEnabled" in value && typeof value.deliveryEnabled === "boolean" &&
    "maxDeliveries" in value && typeof value.maxDeliveries === "number" && Number.isInteger(value.maxDeliveries) && value.maxDeliveries >= 1 && value.maxDeliveries <= 20 &&
    "assignmentMode" in value && (value.assignmentMode === "individual" || value.assignmentMode === "batch") &&
    "maxActiveDeliveriesPerDriver" in value && typeof value.maxActiveDeliveriesPerDriver === "number";
}

function isSnapshot(value: unknown): value is DispatchSnapshot {
  return !!value && typeof value === "object" &&
    "mockMode" in value && typeof value.mockMode === "boolean" &&
    "restaurant" in value && isRestaurant(value.restaurant) &&
    "request" in value && (value.request === null || isRequest(value.request)) &&
    "history" in value && Array.isArray(value.history) && value.history.length <= 5 && value.history.every(isRequest);
}

export async function dispatchApi(
  path: "config" | "request" | "cancel" | "resend" | "status" | "recent",
  restaurant: string,
  token: string,
  signal: AbortSignal,
  body?: Record<string, string | number>,
) {
  const response = await fetch(
    path === "status" || path === "config" || path === "recent"
      ? `/api/dispatch/${path}?restaurant=${encodeURIComponent(restaurant)}`
      : `/api/dispatch/${path}`,
    {
      method: path === "status" || path === "config" || path === "recent" ? "GET" : "POST",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      body: body ? JSON.stringify({ restaurant, ...body }) : undefined,
      cache: "no-store",
      signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    },
  );
  const data: unknown = await response.json();
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error : "El servidor no pudo completar la solicitud.";
    throw new DispatchApiError(response.status, message);
  }
  if (!isSnapshot(data) || data.restaurant.slug !== restaurant) {
    throw new Error("La respuesta del servidor no tiene el formato esperado.");
  }
  return data;
}
