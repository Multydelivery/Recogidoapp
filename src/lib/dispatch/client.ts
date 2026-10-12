import { dispatchStatusLabels, type DispatchRequest, type DispatchSnapshot, type RestaurantPublic } from "./dispatch-types";

export class DispatchApiError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly code?: string) {
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
    "history" in value && Array.isArray(value.history) && value.history.length <= 5 && value.history.every(isRequest) &&
    (!("operationStatus" in value) || value.operationStatus === "created_with_timer_error");
}

function combineSignalWithTimeout(signal?: AbortSignal, timeoutMs = 15_000): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error("Timeout de solicitud"));
  }, timeoutMs);

  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      controller.abort(signal.reason);
    } else {
      signal.addEventListener("abort", () => {
        clearTimeout(timer);
        controller.abort(signal.reason);
      }, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => clearTimeout(timer),
  };
}

export async function dispatchApi(
  path: "config" | "request" | "cancel" | "resend" | "status" | "recent",
  restaurant: string,
  token: string,
  signal: AbortSignal,
  body?: Record<string, string | number>,
) {
  const isRead = path === "status" || path === "config" || path === "recent";
  const url = path === "config"
    ? `/api/dispatch/restaurants/${encodeURIComponent(restaurant)}/config`
    : path === "status" && typeof body?.requestId === "string"
      ? `/api/dispatch/requests/${encodeURIComponent(body.requestId)}?restaurantId=${encodeURIComponent(restaurant)}`
      : isRead
        ? `/api/dispatch/${path}?restaurant=${encodeURIComponent(restaurant)}`
        : `/api/dispatch/${path}`;
  const timeoutGuard = combineSignalWithTimeout(signal, 15_000);
  let response: Response;
  try {
    const bearer = "Bearer " + token;
    response = await fetch(
      url,
      {
        method: isRead ? "GET" : "POST",
        headers: {
          "X-Device-Token": token,
          Authorization: bearer,
          ...(!isRead && body ? { "Content-Type": "application/json" } : {}),
        },
        body: !isRead && body ? JSON.stringify(path === "request"
          ? { restaurantId: restaurant, ...body }
          : { restaurant, ...body }) : undefined,
        cache: "no-store",
        signal: timeoutGuard.signal,
      },
    );
  } finally {
    timeoutGuard.cleanup();
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data && typeof data.error === "string"
      ? data.error : "El servidor no pudo completar la solicitud.";
    const code = data && typeof data === "object" && "code" in data && typeof data.code === "string" ? data.code : undefined;
    throw new DispatchApiError(response.status, message, code);
  }
  if (!isSnapshot(data) || data.restaurant.slug !== restaurant) {
    throw new Error("La respuesta del servidor no tiene el formato esperado.");
  }
  return data;
}
