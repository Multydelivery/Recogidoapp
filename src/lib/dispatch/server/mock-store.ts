import "server-only";
import { randomUUID } from "node:crypto";
import { fallbackOrderNumber, isOpenRequest, type DeliveryAssignment, type DispatchHistoryRecord, type DispatchHistorySnapshot, type DispatchRequest, type DispatchSnapshot, type RestaurantPublic } from "../dispatch-types";
import { DispatchError, type RestaurantConfig } from "./config";

interface StoredRequest {
  restaurantSlug: string;
  idempotencyKey: string;
  request: DispatchRequest;
  makeTimerStartedAt: string;
  lastOfferedAt?: string;
  lastOfferedRequestIds?: string[];
  /** When the request reached its final state (all delivered and/or cancelled). */
  finalizedAt?: string;
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

/** Simulated drivers confirm delivery this long after their assignment. */
const mockDeliveryDurationMs = 30_000;

function hasDriverOnTheRoad(request: DispatchRequest) {
  return request.assignmentMode === "batch"
    ? request.status === "claimed" || request.status === "fully_assigned"
    : request.deliveries.some((delivery) => delivery.status === "claimed");
}

/** Simulated drivers pick the order up this long after their assignment. */
const mockPickUpDelayMs = 12_000;

/** Marks assigned deliveries as picked up once the simulated driver reaches the restaurant. */
function pickUpDeliveries(request: DispatchRequest) {
  const now = Date.now();
  const pickUpTime = (assignedAt?: string) => {
    const at = assignedAt ? Date.parse(assignedAt) + mockPickUpDelayMs : Number.NaN;
    return Number.isFinite(at) && now >= at ? new Date(at).toISOString() : undefined;
  };
  if (request.assignmentMode === "batch") {
    if (request.status !== "claimed" && request.status !== "fully_assigned") return;
    const at = request.pickedUpAt ?? pickUpTime(request.assignedAt);
    if (at && !request.pickedUpAt) {
      request.pickedUpAt = at;
      request.updatedAt = at;
    }
    return;
  }
  for (const delivery of request.deliveries) {
    if (delivery.status !== "claimed" || delivery.pickedUp) continue;
    const at = pickUpTime(delivery.assignedAt);
    if (!at) continue;
    delivery.pickedUp = true;
    delivery.pickedUpAt = at;
    delivery.updatedAt = at;
    request.updatedAt = at;
  }
}

/** Marks assigned deliveries as delivered once the simulated trip is over. Never touches open or cancelled ones. */
function completeDeliveries(entry: StoredRequest) {
  const request = entry.request;
  if (!hasDriverOnTheRoad(request)) return;
  const assignedTimes = request.assignmentMode === "batch"
    ? [request.assignedAt]
    : request.deliveries.filter((delivery) => delivery.status === "claimed").map((delivery) => delivery.assignedAt);
  const lastAssigned = Math.max(...assignedTimes.map((value) => value ? Date.parse(value) : Number.NaN));
  if (!Number.isFinite(lastAssigned) || Date.now() < lastAssigned + mockDeliveryDurationMs) return;
  const finishedAt = new Date(lastAssigned + mockDeliveryDurationMs).toISOString();
  request.deliveries.forEach((delivery) => {
    if (delivery.status !== "claimed") return;
    delivery.status = "closed";
    delivery.completedAt = finishedAt;
    delivery.updatedAt = finishedAt;
  });
  if (request.status === "claimed" || request.status === "fully_assigned") {
    request.status = "closed";
    request.completedAt = finishedAt;
  }
  request.updatedAt = finishedAt;
  entry.finalizedAt ??= finishedAt;
}

/** Mirrors the central service's delivered / on-the-road counters for the simulator. */
function refreshProgressCounts(request: DispatchRequest) {
  if (request.assignmentMode === "batch") {
    const onTheRoad = request.status === "claimed" || request.status === "fully_assigned";
    request.completedDeliveries = request.status === "closed" ? request.totalDeliveries : 0;
    request.activeDeliveries = onTheRoad ? request.totalDeliveries : 0;
    request.pickedUpDeliveries = onTheRoad && request.pickedUpAt ? request.totalDeliveries : 0;
    request.cancelledDeliveries = request.status === "cancelled" ? request.totalDeliveries : 0;
    return;
  }
  request.completedDeliveries = request.deliveries.filter((delivery) => delivery.status === "closed").length;
  request.activeDeliveries = request.deliveries.filter((delivery) => delivery.status === "claimed").length;
  request.pickedUpDeliveries = request.deliveries.filter((delivery) => delivery.status === "claimed" && delivery.pickedUp).length;
  request.cancelledDeliveries = request.deliveries.filter((delivery) => delivery.status === "cancelled").length;
}

function advance(entry: StoredRequest) {
  completeDeliveries(entry);
  assignDrivers(entry);
  pickUpDeliveries(entry.request);
  refreshProgressCounts(entry.request);
}

function assignDrivers(entry: StoredRequest) {
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
      orderNumber: fallbackOrderNumber(requestId, index + 1),
    }))
    : [];
  const request: DispatchRequest = {
    requestId,
    orderNumber: fallbackOrderNumber(requestId),
    restaurantName: restaurant.name,
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

export function cancelRequest(restaurant: RestaurantConfig, requestId: string): DispatchSnapshot & { cancelledDeliveries: number } {
  const entry = ownedRequest(restaurant, requestId);
  const request = entry.request;
  const pending = !isOpenRequest(request.status) ? 0 : request.assignmentMode === "batch"
    ? (request.status === "open" ? request.remainingDeliveries : 0)
    : request.deliveries.filter((delivery: DeliveryAssignment) => delivery.status === "open").length;
  // Idempotent: repeating the cancellation or cancelling a fully assigned request changes nothing.
  if (pending === 0) return { ...snapshot(restaurant, requestId), cancelledDeliveries: 0 };
  const cancelledAt = new Date().toISOString();
  if (request.assignmentMode === "batch") {
    request.status = "cancelled";
    request.remainingDeliveries = 0;
  } else {
    request.deliveries.forEach((delivery: DeliveryAssignment) => {
      if (delivery.status !== "open") return;
      delivery.status = "cancelled";
      delivery.cancelledAt = cancelledAt;
      delivery.updatedAt = cancelledAt;
    });
    request.remainingDeliveries = 0;
    request.status = "cancelled";
  }
  request.cancelledAt = cancelledAt;
  request.updatedAt = cancelledAt;
  refreshProgressCounts(request);
  if (!hasDriverOnTheRoad(request)) entry.finalizedAt ??= request.updatedAt;
  return { ...snapshot(restaurant, requestId), cancelledDeliveries: pending };
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

/** Final (delivered and/or cancelled) simulator requests in the same shape as the real history. */
export function historyRecords(restaurant: RestaurantConfig): DispatchHistorySnapshot {
  const entries = restaurantRequests(restaurant);
  entries.forEach(advance);
  const requests = entries
    .filter((entry) => entry.finalizedAt && !isOpenRequest(entry.request.status) && !hasDriverOnTheRoad(entry.request))
    .map((entry): DispatchHistoryRecord => {
      const request = entry.request;
      const batch = request.assignmentMode === "batch";
      const completedDeliveries = batch
        ? (request.status === "closed" ? request.totalDeliveries : 0)
        : request.deliveries.filter((delivery: DeliveryAssignment) => delivery.status === "closed").length;
      const cancelledDeliveries = batch
        ? (request.status === "cancelled" ? request.totalDeliveries : 0)
        : request.deliveries.filter((delivery: DeliveryAssignment) => delivery.status === "cancelled").length;
      const deliveries = request.deliveries.map((delivery: DeliveryAssignment): DispatchHistoryRecord["deliveries"][number] => ({
        requestId: delivery.requestId,
        deliveryNumber: delivery.deliveryNumber,
        status: delivery.status === "closed" ? "completed" as const : delivery.status === "claimed" ? "assigned" as const : delivery.status,
        ...(delivery.orderNumber ? { orderNumber: delivery.orderNumber } : {}),
        ...(delivery.status === "closed" && delivery.driverName ? { driverName: delivery.driverName } : {}),
        ...(delivery.status === "closed" && delivery.assignedAt ? { assignedAt: delivery.assignedAt } : {}),
        ...(delivery.status === "closed" && delivery.pickedUpAt ? { pickedUpAt: delivery.pickedUpAt } : {}),
        ...(delivery.completedAt ? { completedAt: delivery.completedAt } : {}),
        ...(delivery.cancelledAt ? { cancelledAt: delivery.cancelledAt } : {}),
        ...(delivery.status !== "open" && entry.finalizedAt ? { finalizedAt: entry.finalizedAt } : {}),
      }));
      const driverNames = [...new Set([
        ...(batch && request.driverName ? [request.driverName] : []),
        ...deliveries.flatMap((delivery: DispatchHistoryRecord["deliveries"][number]) => delivery.driverName ? [delivery.driverName] : []),
      ])];
      return {
        requestId: request.requestId,
        ...(request.orderNumber ? { orderNumber: request.orderNumber } : {}),
        status: request.status === "closed" ? "completed" : "cancelled",
        totalDeliveries: request.totalDeliveries,
        assignedDeliveries: completedDeliveries,
        completedDeliveries,
        cancelledDeliveries,
        pendingDeliveries: 0,
        activeDeliveries: 0,
        driverNames,
        createdAt: request.createdAt,
        finalizedAt: entry.finalizedAt ?? null,
        deliveries,
      };
    })
    .sort((left, right) => Date.parse(right.finalizedAt ?? right.createdAt) - Date.parse(left.finalizedAt ?? left.createdAt))
    .slice(0, 50);
  return { restaurantId: restaurant.slug, count: requests.length, requests: structuredClone(requests) };
}
