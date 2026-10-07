import { dispatchStatusLabels, type DispatchRequest, type DispatchSnapshot } from "./dispatch-types";

export class DispatchApiError extends Error {
  constructor(public readonly statusCode: number, message: string) {
    super(message);
  }
}

function isRequest(value: unknown): value is DispatchRequest {
  return !!value && typeof value === "object" &&
    "requestId" in value && typeof value.requestId === "string" && /^WEB_\d{13}_[a-f0-9]{16}$/.test(value.requestId) &&
    "deliveryCount" in value && typeof value.deliveryCount === "number" && Number.isInteger(value.deliveryCount) && value.deliveryCount >= 1 && value.deliveryCount <= 9 &&
    "status" in value && typeof value.status === "string" && Object.hasOwn(dispatchStatusLabels, value.status) &&
    "createdAt" in value && typeof value.createdAt === "string" && Number.isFinite(Date.parse(value.createdAt)) &&
    (!("driverName" in value) || typeof value.driverName === "string");
}

function isSnapshot(value: unknown): value is DispatchSnapshot {
  return !!value && typeof value === "object" &&
    "mockMode" in value && typeof value.mockMode === "boolean" &&
    "restaurant" in value && !!value.restaurant && typeof value.restaurant === "object" &&
    "slug" in value.restaurant && typeof value.restaurant.slug === "string" &&
    "name" in value.restaurant && typeof value.restaurant.name === "string" &&
    "request" in value && (value.request === null || isRequest(value.request)) &&
    "history" in value && Array.isArray(value.history) && value.history.length <= 5 && value.history.every(isRequest);
}

export async function dispatchApi(
  path: "request" | "cancel" | "status",
  restaurant: string,
  token: string,
  signal: AbortSignal,
  body?: Record<string, string | number>,
) {
  const response = await fetch(
    path === "status" ? `/api/dispatch/status?restaurant=${encodeURIComponent(restaurant)}` : `/api/dispatch/${path}`,
    {
      method: path === "status" ? "GET" : "POST",
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
