import "server-only";
import { randomBytes } from "node:crypto";
import { isOpenRequest, type DispatchRequest, type DispatchSnapshot } from "../dispatch-types";
import { DispatchError, type RestaurantConfig } from "./config";

interface StoredRequest {
  restaurantSlug: string;
  restaurantName: string;
  restaurantPhone: string;
  idempotencyKey: string;
  request: DispatchRequest;
}

interface MockStore {
  requests: Map<string, StoredRequest>;
  keys: Map<string, string>;
}

declare global {
  var recogidoDispatchMock: MockStore | undefined;
}

const retentionMs = 24 * 60 * 60 * 1000;

function getStore() {
  const store = globalThis.recogidoDispatchMock ??= { requests: new Map(), keys: new Map() };
  const cutoff = Date.now() - retentionMs;
  for (const [id, entry] of store.requests) {
    if (Date.parse(entry.request.createdAt) < cutoff) {
      store.requests.delete(id);
      store.keys.delete(`${entry.restaurantSlug}:${entry.idempotencyKey}`);
    }
  }
  return store;
}

function advance(entry: StoredRequest) {
  if (!isOpenRequest(entry.request.status)) return;
  const elapsed = Date.now() - Date.parse(entry.request.createdAt);
  entry.request.status = elapsed >= 20_000 ? "claimed" : elapsed >= 10_000 ? "searching" : elapsed >= 5_000 ? "offer_sent" : "pending";
  if (entry.request.status === "claimed") entry.request.driverName = "Conductor Demo";
}

function restaurantRequests(restaurant: RestaurantConfig) {
  return Array.from(getStore().requests.values())
    .filter((entry) => entry.restaurantSlug === restaurant.slug)
    .reverse();
}

export function snapshot(restaurant: RestaurantConfig, requestId?: string): DispatchSnapshot {
  const entries = restaurantRequests(restaurant);
  entries.forEach(advance);
  const current = requestId
    ? entries.find((entry) => entry.request.requestId === requestId)
    : entries.find((entry) => isOpenRequest(entry.request.status)) ?? entries[0];
  if (requestId && !current) throw new DispatchError(404, "Solicitud no encontrada para este restaurante.");
  // Explicit public projection: no token, phone, or internal idempotency data.
  return {
    mockMode: true,
    restaurant: { slug: restaurant.slug, name: restaurant.name },
    request: current ? { ...current.request } : null,
    history: entries
      .filter((entry) => new Date(entry.request.createdAt).toDateString() === new Date().toDateString())
      .slice(0, 5)
      .map((entry) => ({ ...entry.request })),
  };
}

export function createRequest(restaurant: RestaurantConfig, deliveryCount: number, idempotencyKey: string) {
  const store = getStore();
  const key = `${restaurant.slug}:${idempotencyKey}`;
  const existingId = store.keys.get(key);
  if (existingId) {
    const existing = store.requests.get(existingId);
    if (!existing || existing.request.deliveryCount !== deliveryCount) {
      throw new DispatchError(409, "La clave de idempotencia ya corresponde a otra cantidad.");
    }
    return { data: snapshot(restaurant, existingId), reused: true };
  }
  if (restaurantRequests(restaurant).some((entry) => {
    advance(entry);
    return isOpenRequest(entry.request.status);
  })) {
    throw new DispatchError(409, "Ya existe una solicitud abierta. Actualiza su estado antes de enviar otra.");
  }
  if (store.requests.size >= 5000) throw new DispatchError(503, "El simulador alcanzó su capacidad temporal.");
  const timestamp = Date.now();
  const requestId = `WEB_${timestamp}_${randomBytes(8).toString("hex")}`;
  const request: DispatchRequest = {
    requestId,
    deliveryCount,
    status: "pending",
    createdAt: new Date(timestamp).toISOString(),
  };
  store.requests.set(requestId, {
    restaurantSlug: restaurant.slug,
    restaurantName: restaurant.name,
    restaurantPhone: restaurant.phone,
    idempotencyKey,
    request,
  });
  store.keys.set(key, requestId);
  return { data: snapshot(restaurant, requestId), reused: false };
}

export function cancelRequest(restaurant: RestaurantConfig, requestId: string) {
  const entry = getStore().requests.get(requestId);
  if (!entry || entry.restaurantSlug !== restaurant.slug) {
    throw new DispatchError(404, "Solicitud no encontrada para este restaurante.");
  }
  advance(entry);
  if (entry.request.status === "cancelled") return snapshot(restaurant, requestId);
  if (!isOpenRequest(entry.request.status)) {
    throw new DispatchError(409, "No se puede cancelar una solicitud con conductor asignado.");
  }
  entry.request.status = "cancelled";
  return snapshot(restaurant, requestId);
}
