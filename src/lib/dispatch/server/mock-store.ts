import "server-only";
import { randomUUID } from "node:crypto";
import { isOpenRequest, type DeliveryAssignment, type DispatchRequest, type DispatchSnapshot, type RestaurantPublic } from "../dispatch-types";
import { DispatchError, type RestaurantConfig } from "./config";

interface StoredRequest {
  restaurantSlug: string;
  idempotencyKey: string;
  request: DispatchRequest;
  makeTimerStartedAt: string;
  lastOfferedAt?: string;
  lastOfferedRequestIds?: string[];
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

function updateAggregate(request: DispatchRequest) {
  const assignments = request.deliveries;
  request.assignedDeliveries = assignments.filter((delivery) => delivery.status === "claimed" || delivery.status === "closed").length;
  request.remainingDeliveries = assignments.filter((delivery) => delivery.status === "open").length;
  if (request.assignmentMode === "batch") {
    request.assignedDeliveries = request.status === "claimed" || request.status === "fully_assigned" ? request.totalDeliveries : 0;
    request.remainingDeliveries = request.assignedDeliveries === 0 && request.status !== "cancelled" ? request.totalDeliveries : 0;
  } else if (request.remainingDeliveries === 0) {
    request.status = assignments.some((delivery) => delivery.status === "cancelled") ? "cancelled" : "fully_assigned";
  } else if (request.assignedDeliveries > 0) {
    request.status = "partially_claimed";
  } else {
    request.status = "open";
  }
}

function advance(entry: StoredRequest) {
  const request = entry.request;
  if (!isOpenRequest(request.status)) return;
  const elapsed = Date.now() - Date.parse(request.createdAt);
  if (request.assignmentMode === "batch") {
    if (elapsed >= 8_000) {
      request.status = "claimed";
      request.assignedDeliveries = request.totalDeliveries;
      request.remainingDeliveries = 0;
      request.driverName = "Conductor Demo";
      request.assignedAt ??= new Date(Date.parse(request.createdAt) + 8_000).toISOString();
      request.updatedAt = new Date().toISOString();
    }
    return;
  }
  const desired = Math.min(request.totalDeliveries, Math.floor(elapsed / 8_000));
  let assigned = request.deliveries.filter((delivery) => delivery.status === "claimed").length;
  for (const delivery of request.deliveries) {
    if (assigned >= desired) break;
    if (delivery.status !== "open") continue;
    assigned += 1;
    delivery.status = "claimed";
    delivery.driverName = `Conductor Demo ${assigned}`;
    delivery.assignedAt = new Date(Date.parse(request.createdAt) + assigned * 8_000).toISOString();
  }
  if (assigned) request.updatedAt = new Date().toISOString();
  updateAggregate(request);
}

function restaurantRequests(restaurant: RestaurantConfig) {
  return Array.from(getStore().requests.values())
    .filter((entry) => entry.restaurantSlug === restaurant.slug)
    .sort((left, right) => Date.parse(right.request.createdAt) - Date.parse(left.request.createdAt));
}

export function publicConfiguration(restaurant: RestaurantConfig): RestaurantPublic {
  const { slug, name, active, deliveryEnabled, maxDeliveries, assignmentMode, maxActiveDeliveriesPerDriver } = restaurant;
  return { slug, name, active, deliveryEnabled, maxDeliveries, assignmentMode, maxActiveDeliveriesPerDriver };
}

export function snapshot(restaurant: RestaurantConfig, requestId?: string): DispatchSnapshot {
  const entries = restaurantRequests(restaurant);
  entries.forEach(advance);
  const current = requestId
    ? entries.find((entry) => entry.request.requestId === requestId)
    : entries.find((entry) => isOpenRequest(entry.request.status)) ?? entries[0];
  if (requestId && !current) throw new DispatchError(404, "Solicitud no encontrada para este restaurante.");
  return {
    mockMode: true,
    restaurant: publicConfiguration(restaurant),
    request: current ? structuredClone(current.request) : null,
    history: entries.slice(0, 5).map((entry) => structuredClone(entry.request)),
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
  const requestId = `WEB_${randomUUID().replaceAll("-", "")}`;
  const children: DeliveryAssignment[] = restaurant.assignmentMode === "individual"
    ? Array.from({ length: deliveryCount }, (_, index) => ({
      requestId: `${requestId}_${index + 1}`,
      deliveryNumber: index + 1,
      status: "open",
    }))
    : [];
  const request: DispatchRequest = {
    requestId,
    requestType: restaurant.assignmentMode === "batch" ? "batch" : "parent",
    parentRequestId: requestId,
    deliveryCount,
    totalDeliveries: deliveryCount,
    assignedDeliveries: 0,
    remainingDeliveries: deliveryCount,
    assignmentMode: restaurant.assignmentMode,
    status: "open",
    childRequestIds: children.map((delivery) => delivery.requestId),
    deliveries: children,
    createdAt: new Date(timestamp).toISOString(),
  };
  store.requests.set(requestId, {
    restaurantSlug: restaurant.slug,
    idempotencyKey,
    request,
    makeTimerStartedAt: new Date(timestamp).toISOString(),
  });
  store.keys.set(key, requestId);
  return { data: snapshot(restaurant, requestId), reused: false };
}

function ownedRequest(restaurant: RestaurantConfig, requestId: string) {
  const entry = getStore().requests.get(requestId);
  if (!entry || entry.restaurantSlug !== restaurant.slug) {
    throw new DispatchError(404, "Solicitud no encontrada para este restaurante.");
  }
  advance(entry);
  return entry;
}

export function cancelRequest(restaurant: RestaurantConfig, requestId: string) {
  const entry = ownedRequest(restaurant, requestId);
  if (entry.request.status === "cancelled") return snapshot(restaurant, requestId);
  if (!isOpenRequest(entry.request.status)) {
    throw new DispatchError(409, "No quedan entregas abiertas para cancelar.");
  }
  if (entry.request.assignmentMode === "batch") {
    entry.request.status = "cancelled";
    entry.request.remainingDeliveries = 0;
  } else {
    entry.request.deliveries.forEach((delivery: DeliveryAssignment) => {
      if (delivery.status === "open") delivery.status = "cancelled";
    });
    entry.request.remainingDeliveries = 0;
    entry.request.status = "cancelled";
  }
  entry.request.updatedAt = new Date().toISOString();
  return snapshot(restaurant, requestId);
}

export function resendRequest(restaurant: RestaurantConfig, requestId: string) {
  const entry = ownedRequest(restaurant, requestId);
  if (!isOpenRequest(entry.request.status) || entry.request.remainingDeliveries === 0) {
    throw new DispatchError(409, "No hay entregas abiertas para volver a ofrecer.");
  }
  entry.lastOfferedAt = new Date().toISOString();
  entry.lastOfferedRequestIds = entry.request.assignmentMode === "batch"
    ? [entry.request.requestId]
    : entry.request.deliveries
      .filter((delivery: DeliveryAssignment) => delivery.status === "open")
      .map((delivery: DeliveryAssignment) => delivery.requestId);
  entry.request.updatedAt = entry.lastOfferedAt;
  return snapshot(restaurant, requestId);
}

export function recentRequests(restaurant: RestaurantConfig) {
  return snapshot(restaurant).history;
}
