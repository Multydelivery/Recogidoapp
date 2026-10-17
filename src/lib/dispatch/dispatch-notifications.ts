import { displayStatus, historyOutcome, type DispatchDisplayStatus } from "./dispatch-queue";
import { formatOrderNumber, requestOrderNumber } from "./delivery-progress";
import type { DispatchHistoryRecord, DispatchRequest } from "./dispatch-types";

export type DispatchEventKind =
  | "created"
  | "assigned"
  | "fully_assigned"
  | "picked_up"
  | "no_driver"
  | "completed"
  | "closed"
  | "cancelled"
  | "left_queue"
  | "connection_lost"
  | "connection_restored";

export type DispatchSound = "positive" | "complete" | "attention";
export type NotificationTone = "success" | "warning" | "info" | "danger";

export interface DispatchNotification {
  id: string;
  kind: DispatchEventKind;
  tone: NotificationTone;
  title: string;
  detail?: string;
}

export interface SeenStore {
  has(key: string): boolean;
  add(key: string): void;
  size(): number;
}

type KeyStorage = Pick<Storage, "getItem" | "setItem">;

/** Bounded set of already announced keys, mirrored to sessionStorage when available. */
export function createSeenStore(storage: KeyStorage | null, storageKey: string, limit = 200): SeenStore {
  let keys: string[] = [];
  try {
    const raw = storage?.getItem(storageKey);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    if (Array.isArray(parsed)) keys = parsed.filter((key): key is string => typeof key === "string" && key.length <= 300).slice(-limit);
  } catch {
    keys = [];
  }
  const index = new Set(keys);
  return {
    has: (key) => index.has(key),
    size: () => index.size,
    add(key) {
      if (index.has(key)) return;
      keys.push(key);
      index.add(key);
      while (keys.length > limit) index.delete(keys.shift() as string);
      try { storage?.setItem(storageKey, JSON.stringify(keys)); } catch {}
    },
  };
}

/** Deduplication key: requestId + status + updatedAt, plus the event kind and assigned count as discriminators. */
export function notificationKey(kind: DispatchEventKind, request: DispatchRequest) {
  return [kind, request.requestId, displayStatus(request), request.updatedAt ?? "", request.assignedDeliveries, request.pickedUpDeliveries ?? 0].join("|");
}

function deliveriesWord(count: number) {
  return `${count} ${count === 1 ? "entrega" : "entregas"}`;
}

export function describeEvent(kind: DispatchEventKind, request?: DispatchRequest, previous?: DispatchRequest, fallbackLabel = ""): Omit<DispatchNotification, "id"> {
  const label = request ? `Solicitud ${formatOrderNumber(requestOrderNumber(request))}` : fallbackLabel;
  switch (kind) {
    case "created":
      return { kind, tone: "success", title: `${label} creada`, detail: `${deliveriesWord(request?.totalDeliveries ?? 0)} · buscando conductor` };
    case "assigned": {
      const newDrivers = request?.deliveries
        .filter((delivery) => delivery.status === "claimed" && delivery.driverName &&
          previous?.deliveries.find((before) => before.requestId === delivery.requestId)?.status !== "claimed")
        .map((delivery) => delivery.driverName) ?? [];
      return {
        kind, tone: "success", title: `Conductor asignado · ${label}`,
        detail: `${request?.assignedDeliveries ?? 0} de ${request?.totalDeliveries ?? 0} asignadas${newDrivers.length ? ` · ${newDrivers.join(", ")}` : ""}`,
      };
    }
    case "fully_assigned":
      return { kind, tone: "success", title: `Todas asignadas · ${label}`, detail: request?.driverName ? `Conductor: ${request.driverName}` : `${deliveriesWord(request?.totalDeliveries ?? 0)} con conductor` };
    case "picked_up":
      return { kind, tone: "info", title: `Pedido recogido · ${label}`, detail: "El conductor está en camino." };
    case "no_driver":
      return { kind, tone: "warning", title: `Sin respuesta tras 20 segundos · ${label}`, detail: "La solicitud sigue disponible para los conductores." };
    case "completed":
      return { kind, tone: "success", title: `Entrega completada · ${label}` };
    case "closed":
      return { kind, tone: "info", title: `${label} cerrada` };
    case "cancelled":
      return { kind, tone: "danger", title: `${label} cancelada`, detail: "Las entregas ya asignadas se conservan." };
    case "left_queue":
      return { kind, tone: "info", title: `${label} ya no está activa`, detail: "Consulte el historial para ver el resultado final." };
    case "connection_lost":
      return { kind, tone: "danger", title: "Sin conexión con el servidor", detail: "Se muestran los últimos datos recibidos." };
    case "connection_restored":
      return { kind, tone: "success", title: "Conexión recuperada" };
  }
}

export function describeHistoryEvent(kind: DispatchEventKind, record: DispatchHistoryRecord): Omit<DispatchNotification, "id"> {
  const label = `Solicitud ${formatOrderNumber(requestOrderNumber(record))}`;
  const outcome = historyOutcome(record);
  if (outcome === "partially_completed") {
    return {
      kind, tone: "success", title: `Completada parcialmente · ${label}`,
      detail: `${deliveriesWord(record.completedDeliveries)} completada${record.completedDeliveries === 1 ? "" : "s"} · ${record.cancelledDeliveries} cancelada${record.cancelledDeliveries === 1 ? "" : "s"}`,
    };
  }
  if (kind === "completed") {
    return {
      kind, tone: "success", title: `Entrega completada · ${label}`,
      detail: `${deliveriesWord(record.completedDeliveries)} completada${record.completedDeliveries === 1 ? "" : "s"}`,
    };
  }
  return describeEvent(kind, undefined, undefined, label);
}

function transitionKinds(previous: DispatchRequest, next: DispatchRequest): DispatchEventKind[] {
  const before: DispatchDisplayStatus = displayStatus(previous);
  const after: DispatchDisplayStatus = displayStatus(next);
  const kinds: DispatchEventKind[] = [];
  if (after === "cancelled" && before !== "cancelled") kinds.push("cancelled");
  else if (after === "completed" && before !== "completed") kinds.push("completed");
  else if (after === "closed" && before !== "closed") kinds.push("closed");
  else if (after === "fully_assigned" && before !== "fully_assigned") kinds.push("fully_assigned");
  else if (next.assignedDeliveries > previous.assignedDeliveries) kinds.push("assigned");
  else if ((next.pickedUpDeliveries ?? 0) > (previous.pickedUpDeliveries ?? 0)) kinds.push("picked_up");
  if (after === "no_driver_alerted" && before !== "no_driver_alerted") kinds.push("no_driver");
  return kinds;
}

/**
 * Compares server-confirmed snapshots and emits notifications only for real transitions.
 * Identical polls, repeated renders, and reloads with unchanged data produce nothing.
 */
export class DispatchTransitionTracker {
  private known = new Map<string, DispatchRequest>();
  private baselined = false;
  private online: boolean | null = null;
  private sequence = 0;

  constructor(private readonly seen: SeenStore) {}

  reset() {
    this.known.clear();
    this.baselined = false;
    this.online = null;
  }

  isTracking(requestId: string) {
    return this.known.has(requestId);
  }

  private emit(kind: DispatchEventKind, request?: DispatchRequest, previous?: DispatchRequest): DispatchNotification[] {
    if (request) {
      const key = notificationKey(kind, request);
      if (this.seen.has(key)) return [];
      this.seen.add(key);
    }
    this.sequence += 1;
    return [{ id: `${kind}-${this.sequence}-${Date.now()}`, ...describeEvent(kind, request, previous) }];
  }

  /** Records server state silently, e.g. the first load after connecting. */
  seed(requests: readonly DispatchRequest[]) {
    for (const request of requests) this.known.set(request.requestId, request);
    this.baselined = true;
  }

  created(request: DispatchRequest) {
    this.known.set(request.requestId, request);
    this.baselined = true;
    return this.emit("created", request);
  }

  update(request: DispatchRequest) {
    const previous = this.known.get(request.requestId);
    this.known.set(request.requestId, request);
    this.baselined = true;
    if (!previous) return [];
    return transitionKinds(previous, request).flatMap((kind) => this.emit(kind, request, previous));
  }

  resolved(request: DispatchRequest) {
    const previous = this.known.get(request.requestId);
    this.known.delete(request.requestId);
    if (!previous) return [];
    return transitionKinds(previous, request).flatMap((kind) => this.emit(kind, request, previous));
  }

  /**
   * `active` is the full active queue returned by one server query. `resolved` contains final
   * server states for requests that left the queue, and `finalized` the matching real history
   * records. Requests that vanish without a known final state are announced neutrally instead of
   * assuming success. History records never announce anything for requests this terminal did not
   * see on its board, so the initial history load stays silent.
   */
  observe(active: readonly DispatchRequest[], resolved: readonly DispatchRequest[] = [], finalized: readonly DispatchHistoryRecord[] = []) {
    if (!this.baselined) {
      this.seed(active);
      return [];
    }
    const notifications: DispatchNotification[] = [];
    const activeIds = new Set(active.map((request) => request.requestId));
    for (const request of active) {
      const previous = this.known.get(request.requestId);
      this.known.set(request.requestId, request);
      if (previous) notifications.push(...transitionKinds(previous, request).flatMap((kind) => this.emit(kind, request, previous)));
    }
    for (const record of finalized) {
      if (!activeIds.has(record.requestId)) notifications.push(...this.finalized(record));
    }
    for (const request of resolved) {
      if (!activeIds.has(request.requestId)) notifications.push(...this.resolved(request));
    }
    for (const [requestId, previous] of [...this.known]) {
      if (activeIds.has(requestId)) continue;
      this.known.delete(requestId);
      notifications.push(...this.emit("left_queue", previous));
    }
    return notifications;
  }

  /** A request this terminal was following reached a final state in the real history. */
  finalized(record: DispatchHistoryRecord): DispatchNotification[] {
    const previous = this.known.get(record.requestId);
    if (!previous) return [];
    const outcome = historyOutcome(record);
    if (outcome === "in_progress") return [];
    this.known.delete(record.requestId);
    const kind: DispatchEventKind = outcome === "cancelled" ? "cancelled" : outcome === "closed" ? "closed" : "completed";
    const key = [kind, record.requestId, record.status, record.finalizedAt ?? ""].join("|");
    if (this.seen.has(key)) return [];
    this.seen.add(key);
    this.sequence += 1;
    return [{ id: `${kind}-${this.sequence}-${Date.now()}`, ...describeHistoryEvent(kind, record) }];
  }

  missingFrom(active: readonly DispatchRequest[]) {
    const activeIds = new Set(active.map((request) => request.requestId));
    return [...this.known.keys()].filter((requestId) => !activeIds.has(requestId));
  }

  connection(online: boolean) {
    const before = this.online;
    this.online = online;
    if (!online && before !== false) return this.emit("connection_lost");
    if (online && before === false) return this.emit("connection_restored");
    return [];
  }
}

export function soundForNotifications(notifications: readonly DispatchNotification[]): DispatchSound | null {
  if (notifications.some(({ kind }) => kind === "no_driver")) return "attention";
  if (notifications.some(({ kind }) => kind === "assigned" || kind === "fully_assigned")) return "positive";
  if (notifications.some(({ kind }) => kind === "completed")) return "complete";
  return null;
}

/** Plays at most one sound per batch of new notifications, and never when muted. */
export function announce(notifications: readonly DispatchNotification[], options: {
  muted: boolean;
  play: (sound: DispatchSound) => void;
  push: (notifications: readonly DispatchNotification[]) => void;
}) {
  if (notifications.length === 0) return null;
  options.push(notifications);
  const sound = soundForNotifications(notifications);
  if (sound && !options.muted) options.play(sound);
  return sound;
}
