import { dispatchRequestIdPattern, dispatchStatusLabels, historyStatuses, isCentralDeliveryStatus, isCentralRequestStatus, isOnBoard, orderNumberPattern, type ActiveDispatchSnapshot, type DispatchHistoryRecord, type DispatchHistorySnapshot, type DispatchRequest, type DispatchSnapshot, type RestaurantPublic } from "./dispatch-types";

export class DispatchApiError extends Error {
  constructor(public readonly statusCode: number, message: string, public readonly code?: string) {
    super(message);
  }
}

function isRequest(value: unknown): value is DispatchRequest {
  return !!value && typeof value === "object" &&
    "requestId" in value && typeof value.requestId === "string" && dispatchRequestIdPattern.test(value.requestId) &&
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
      (!("assignedAt" in delivery) || (typeof delivery.assignedAt === "string" && Number.isFinite(Date.parse(delivery.assignedAt)))) &&
      isOptionalOrderNumber((delivery as Record<string, unknown>).orderNumber) &&
      ((delivery as Record<string, unknown>).pickedUp === undefined || typeof (delivery as Record<string, unknown>).pickedUp === "boolean") &&
      isOptionalDate((delivery as Record<string, unknown>).pickedUpAt) &&
      isOptionalDate((delivery as Record<string, unknown>).completedAt) &&
      isOptionalDate((delivery as Record<string, unknown>).cancelledAt) &&
      isOptionalDate((delivery as Record<string, unknown>).createdAt) &&
      ((delivery as Record<string, unknown>).centralStatus === undefined || isCentralDeliveryStatus((delivery as Record<string, unknown>).centralStatus)) &&
      isOptionalDate((delivery as Record<string, unknown>).updatedAt)) &&
     isOptionalOrderNumber((value as Record<string, unknown>).orderNumber) &&
     isOptionalOrderNumber((value as Record<string, unknown>).baseOrderNumber) &&
     ((value as Record<string, unknown>).centralStatus === undefined || isCentralRequestStatus((value as Record<string, unknown>).centralStatus)) &&
     isOptionalCount((value as Record<string, unknown>).pickedUpDeliveries) &&
     isOptionalCount((value as Record<string, unknown>).inTransitDeliveries) &&
     isOptionalCount((value as Record<string, unknown>).cancelledDeliveries) &&
     isOptionalDate((value as Record<string, unknown>).pickedUpAt) &&
     isOptionalDate((value as Record<string, unknown>).completedAt) &&
     isOptionalDate((value as Record<string, unknown>).cancelledAt) &&
    (!("driverName" in value) || typeof value.driverName === "string") &&
    (!("completedDeliveries" in value) || (typeof value.completedDeliveries === "number" && Number.isInteger(value.completedDeliveries) && value.completedDeliveries >= 0)) &&
    (!("activeDeliveries" in value) || (typeof value.activeDeliveries === "number" && Number.isInteger(value.activeDeliveries) && value.activeDeliveries >= 0)) &&
    (!("noDriverAlerted" in value) || typeof value.noDriverAlerted === "boolean");
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
    (!("operationStatus" in value) || value.operationStatus === "created_with_timer_error") &&
    (!("cancelledDeliveries" in value) || (typeof value.cancelledDeliveries === "number" &&
      Number.isInteger(value.cancelledDeliveries) && value.cancelledDeliveries >= 0 && value.cancelledDeliveries <= 20));
}

function combineSignalWithTimeout(signal?: AbortSignal, timeoutMs = 15_000): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new Error("Timeout de solicitud"));
  }, timeoutMs);

  const onAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      controller.abort(signal.reason);
    } else {
      signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); },
  };
}

export async function activeDispatchApi(restaurantId: string, token: string, signal: AbortSignal): Promise<ActiveDispatchSnapshot> {
  const guard = combineSignalWithTimeout(signal);
  try {
    const response = await fetch(`/api/dispatch/restaurants/${encodeURIComponent(restaurantId)}/active`, {
      headers: { "X-Device-Token": token },
      cache: "no-store",
      signal: guard.signal,
    });
    const data: unknown = await response.json();
    if (!response.ok) {
      const error = data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error : "No se pudo consultar la cola.";
      throw new DispatchApiError(response.status, error);
    }
    if (!data || typeof data !== "object" || !("restaurantId" in data) || data.restaurantId !== restaurantId ||
      !("requests" in data) || !Array.isArray(data.requests) || !data.requests.every((item) => isRequest(item) && isOnBoard(item)) ||
      !("count" in data) || data.count !== data.requests.length) {
      throw new Error("La cola del servidor no tiene el formato esperado.");
    }
    return { restaurantId, count: data.requests.length, requests: data.requests };
  } finally {
    guard.cleanup();
  }
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

const historyChildIdPattern = /^(?:WEB[A-F0-9]{32}|WEB_[a-f0-9]{32})_[1-9]\d*$/i;
const historyDeliveryStatuses = ["open", "assigned", "completed", "cancelled"];

function isCount(value: unknown, max = 20): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= max;
}

function isOptionalDate(value: unknown) {
  return value === undefined || (typeof value === "string" && Number.isFinite(Date.parse(value)));
}

function isOptionalCount(value: unknown) {
  return value === undefined || isCount(value);
}

function isOptionalOrderNumber(value: unknown) {
  return value === undefined || (typeof value === "string" && orderNumberPattern.test(value));
}

function isHistoryRecord(value: unknown): value is DispatchHistoryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return typeof record.requestId === "string" && dispatchRequestIdPattern.test(record.requestId) &&
    typeof record.status === "string" && (historyStatuses as readonly string[]).includes(record.status) &&
    isCount(record.totalDeliveries) && (record.totalDeliveries as number) >= 1 &&
    isCount(record.assignedDeliveries) && isCount(record.completedDeliveries) && isCount(record.cancelledDeliveries) &&
    isCount(record.pendingDeliveries) && isCount(record.activeDeliveries) &&
    Array.isArray(record.driverNames) && record.driverNames.length <= 20 && record.driverNames.every((name) => typeof name === "string") &&
    typeof record.createdAt === "string" && Number.isFinite(Date.parse(record.createdAt)) &&
    (record.finalizedAt === null || (typeof record.finalizedAt === "string" && Number.isFinite(Date.parse(record.finalizedAt)))) &&
    Array.isArray(record.deliveries) && record.deliveries.length <= 20 && record.deliveries.every((delivery: unknown) => {
      if (!delivery || typeof delivery !== "object") return false;
      const child = delivery as Record<string, unknown>;
      return typeof child.requestId === "string" && historyChildIdPattern.test(child.requestId) &&
        typeof child.deliveryNumber === "number" && Number.isInteger(child.deliveryNumber) && child.deliveryNumber >= 1 &&
        typeof child.status === "string" && historyDeliveryStatuses.includes(child.status) &&
        (child.driverName === undefined || typeof child.driverName === "string") &&
        isOptionalOrderNumber(child.orderNumber) && isOptionalDate(child.pickedUpAt) &&
        isOptionalDate(child.completedAt) && isOptionalDate(child.cancelledAt) &&
        isOptionalDate(child.assignedAt) && isOptionalDate(child.finalizedAt);
    }) && isOptionalOrderNumber(record.orderNumber);
}

/** Loads the authenticated restaurant's real delivery history. The server decides the restaurant from the token. */
export async function historyDispatchApi(restaurantId: string, token: string, signal?: AbortSignal): Promise<DispatchHistorySnapshot> {
  const guard = combineSignalWithTimeout(signal);
  try {
    const response = await fetch(`/api/dispatch/restaurants/${encodeURIComponent(restaurantId)}/history`, {
      headers: { "X-Device-Token": token },
      cache: "no-store",
      signal: guard.signal,
    });
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      data = null;
    }
    if (!response.ok) {
      const error = data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error : "No se pudo consultar el historial.";
      const code = data && typeof data === "object" && "code" in data && typeof data.code === "string" ? data.code : undefined;
      throw new DispatchApiError(response.status, error, code);
    }
    if (!data || typeof data !== "object" || !("restaurantId" in data) || data.restaurantId !== restaurantId ||
      !("requests" in data) || !Array.isArray(data.requests) || data.requests.length > 50 || !data.requests.every(isHistoryRecord) ||
      !("count" in data) || data.count !== data.requests.length) {
      throw new Error("El historial del servidor no tiene el formato esperado.");
    }
    return { restaurantId, count: data.requests.length, requests: data.requests };
  } finally {
    guard.cleanup();
  }
}
