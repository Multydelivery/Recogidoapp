import { childOrderNumber, fallbackOrderNumber, orderBase, type DeliveryAssignment, type DispatchHistoryDelivery, type DispatchHistoryRecord, type DispatchRequest } from "./dispatch-types";
import { completedDeliveryCount, dispatchTimeZone, isSearching, presentedDeliveries } from "./dispatch-queue";

/** Every status a single delivery can report, including the central service's spellings. */
export type DeliveryProgressStatus =
  | "open"
  | "no_driver_alerted"
  | "claimed"
  | "assigned"
  | "partially_claimed"
  | "fully_assigned"
  | "picked_up"
  | "completed"
  | "closed"
  | "cancelled"
  | "canceled";

export type DeliveryPhase = "searching" | "assigned" | "picked_up" | "completed" | "cancelled";

export type TimelineStepKey = "received" | "assigned" | "picked_up" | "completed";
export type TimelineStepState = "complete" | "current" | "pending" | "cancelled";

export interface DeliveryProgress {
  phase: DeliveryPhase;
  /** Visible badge text, always shown next to its icon (never color alone). */
  badge: string;
  /** Short sentence for the restaurant employee. */
  message: string;
  /** Discreet notice shown only while a request keeps waiting for a driver. */
  alert?: string;
  /** Index of the step the order is in right now; null once the order is finished. */
  currentStep: number | null;
  /** How many leading steps are already done. */
  completedSteps: number;
  /** Driver name is only shown after a driver accepted the delivery. */
  showDriver: boolean;
  /** Pending deliveries are the only ones the restaurant may cancel. */
  cancellable: boolean;
  final: boolean;
}

export const timelineSteps: ReadonlyArray<{ key: TimelineStepKey; label: string }> = [
  { key: "received", label: "Solicitud recibida" },
  { key: "assigned", label: "Conductor asignado" },
  { key: "picked_up", label: "Pedido recogido" },
  { key: "completed", label: "Entrega completada" },
];

/** Single source of truth for how each delivery status is presented. */
export function getDeliveryProgress(status: DeliveryProgressStatus): DeliveryProgress {
  switch (status) {
    case "open":
      return {
        phase: "searching", badge: "Buscando conductor", message: "Estamos buscando un conductor disponible.",
        currentStep: 1, completedSteps: 1, showDriver: false, cancellable: true, final: false,
      };
    case "no_driver_alerted":
      return {
        phase: "searching", badge: "Seguimos buscando", message: "Estamos buscando un conductor disponible.",
        alert: "La solicitud continúa disponible. Recogido está buscando un conductor.",
        currentStep: 1, completedSteps: 1, showDriver: false, cancellable: true, final: false,
      };
    case "claimed":
    case "assigned":
    case "partially_claimed":
    case "fully_assigned":
      return {
        phase: "assigned", badge: "Conductor asignado", message: "El conductor se dirige al restaurante.",
        currentStep: 1, completedSteps: 2, showDriver: true, cancellable: false, final: false,
      };
    case "picked_up":
      return {
        phase: "picked_up", badge: "En camino", message: "Pedido recogido. El conductor está en camino.",
        currentStep: 2, completedSteps: 3, showDriver: true, cancellable: false, final: false,
      };
    case "completed":
    case "closed":
      return {
        phase: "completed", badge: "Entrega completada", message: "El pedido fue entregado.",
        currentStep: null, completedSteps: 4, showDriver: true, cancellable: false, final: true,
      };
    case "cancelled":
    case "canceled":
      return {
        phase: "cancelled", badge: "Cancelada", message: "Esta entrega fue cancelada.",
        currentStep: null, completedSteps: 1, showDriver: false, cancellable: false, final: true,
      };
  }
}

/** Visible order number: the server value, or the short display-only fallback for older records. */
export function requestOrderNumber(request: Pick<DispatchRequest, "requestId" | "orderNumber">) {
  return orderBase(request.orderNumber ?? fallbackOrderNumber(request.requestId));
}

export function formatOrderNumber(orderNumber: string) {
  return `#${orderNumber}`;
}

/** One trackable order on the dashboard. It intentionally carries no internal identifier. */
export interface DeliveryOrderView {
  orderNumber: string;
  deliveryNumber: number;
  totalDeliveries: number;
  /** How many deliveries travel together (batch requests use one driver for all of them). */
  deliveriesInOrder: number;
  status: DeliveryProgressStatus;
  progress: DeliveryProgress;
  driverName?: string;
  createdAt: string;
  updatedAt?: string;
  assignedAt?: string;
  pickedUpAt?: string;
  completedAt?: string;
  cancelledAt?: string;
}

function deliveryStatus(delivery: DeliveryAssignment, request: DispatchRequest): DeliveryProgressStatus {
  switch (delivery.status) {
    case "open":
      return request.noDriverAlerted ? "no_driver_alerted" : "open";
    case "claimed":
      return delivery.pickedUp ? "picked_up" : "claimed";
    case "closed":
      return "completed";
    case "cancelled":
      return "cancelled";
  }
}

export function deliveryOrders(request: DispatchRequest): DeliveryOrderView[] {
  const base = requestOrderNumber(request);
  const batch = request.assignmentMode === "batch" || request.deliveries.length === 0;
  return presentedDeliveries(request).map((delivery) => {
    const status = deliveryStatus(delivery, request);
    const progress = getDeliveryProgress(status);
    return {
      orderNumber: batch ? base : delivery.orderNumber ?? childOrderNumber(base, delivery.deliveryNumber),
      deliveryNumber: delivery.deliveryNumber,
      totalDeliveries: batch ? 1 : request.totalDeliveries,
      deliveriesInOrder: batch ? request.totalDeliveries : 1,
      status,
      progress,
      ...(progress.showDriver && delivery.driverName ? { driverName: delivery.driverName } : {}),
      createdAt: request.createdAt,
      ...(delivery.updatedAt ?? request.updatedAt ? { updatedAt: delivery.updatedAt ?? request.updatedAt } : {}),
      ...(delivery.assignedAt ? { assignedAt: delivery.assignedAt } : {}),
      ...(delivery.pickedUpAt ? { pickedUpAt: delivery.pickedUpAt } : {}),
      ...(delivery.completedAt ? { completedAt: delivery.completedAt } : {}),
      ...(delivery.cancelledAt ? { cancelledAt: delivery.cancelledAt } : {}),
    };
  });
}

function historyDeliveryStatus(delivery: DispatchHistoryDelivery): DeliveryProgressStatus {
  if (delivery.status === "assigned") return delivery.pickedUpAt ? "picked_up" : "assigned";
  return delivery.status;
}

/** History records use the same order model so their timeline reads exactly like the live one. */
export function historyOrders(record: DispatchHistoryRecord): DeliveryOrderView[] {
  const base = orderBase(record.orderNumber ?? fallbackOrderNumber(record.requestId));
  if (record.deliveries.length === 0) {
    const status: DeliveryProgressStatus = record.completedDeliveries > 0 ? "completed" :
      record.status === "cancelled" ? "cancelled" : "completed";
    const progress = getDeliveryProgress(status);
    return [{
      orderNumber: base,
      deliveryNumber: 1,
      totalDeliveries: 1,
      deliveriesInOrder: record.totalDeliveries,
      status,
      progress,
      ...(progress.showDriver && record.driverNames[0] ? { driverName: record.driverNames.join(", ") } : {}),
      createdAt: record.createdAt,
      ...(record.finalizedAt && status === "completed" ? { completedAt: record.finalizedAt } : {}),
      ...(record.finalizedAt && status === "cancelled" ? { cancelledAt: record.finalizedAt } : {}),
    }];
  }
  return record.deliveries.map((delivery) => {
    const status = historyDeliveryStatus(delivery);
    const progress = getDeliveryProgress(status);
    const completedAt = delivery.completedAt ?? (delivery.status === "completed" ? delivery.finalizedAt : undefined);
    const cancelledAt = delivery.cancelledAt ?? (delivery.status === "cancelled" ? delivery.finalizedAt : undefined);
    return {
      orderNumber: delivery.orderNumber ?? childOrderNumber(base, delivery.deliveryNumber),
      deliveryNumber: delivery.deliveryNumber,
      totalDeliveries: record.totalDeliveries,
      deliveriesInOrder: 1,
      status,
      progress,
      ...(progress.showDriver && delivery.driverName ? { driverName: delivery.driverName } : {}),
      createdAt: record.createdAt,
      ...(delivery.assignedAt ? { assignedAt: delivery.assignedAt } : {}),
      ...(delivery.pickedUpAt ? { pickedUpAt: delivery.pickedUpAt } : {}),
      ...(completedAt ? { completedAt } : {}),
      ...(cancelledAt ? { cancelledAt } : {}),
    };
  });
}

export interface TimelineStep {
  key: TimelineStepKey;
  label: string;
  state: TimelineStepState;
  /** Extra short text under the label (e.g. driver name, "Buscando…"). */
  detail?: string;
  time?: string;
}

/**
 * Builds the four-step timeline. Cancelled orders never show later steps as done:
 * only "Solicitud recibida" stays checked and the rest are marked as cancelled.
 */
export function buildTimeline(order: DeliveryOrderView): TimelineStep[] {
  const { progress } = order;
  const times: Record<TimelineStepKey, string | undefined> = {
    received: order.createdAt,
    assigned: order.assignedAt,
    picked_up: order.pickedUpAt,
    completed: order.completedAt,
  };
  return timelineSteps.map((step, index) => {
    const state: TimelineStepState = progress.phase === "cancelled"
      ? (index === 0 ? "complete" : "cancelled")
      : index === progress.currentStep ? "current"
        : index < progress.completedSteps ? "complete" : "pending";
    const detail = step.key === "assigned" && progress.phase === "searching" ? "Buscando…" :
      step.key === "assigned" && order.driverName ? order.driverName :
        step.key === "picked_up" && progress.phase === "picked_up" ? "En camino" : undefined;
    const time = state === "complete" || state === "current" ? times[step.key] : undefined;
    return { ...step, state, ...(detail ? { detail } : {}), ...(time ? { time } : {}) };
  });
}

const dayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: dispatchTimeZone, year: "numeric", month: "2-digit", day: "2-digit" });

function restaurantDay(value: string | number) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dayFormatter.format(date) : null;
}

export interface DeliveryBoardSummary {
  searching: number;
  assigned: number;
  onTheWay: number;
  completedToday: number;
}

/**
 * Counts individual deliveries from loaded data only (no invented metrics):
 * Buscando = pending deliveries, Asignadas = accepted but not picked up, En camino = picked up,
 * Completadas hoy = delivered today (America/New_York) on the board plus today's history.
 */
export function summarizeDeliveryBoard(
  active: readonly DispatchRequest[],
  history: readonly DispatchHistoryRecord[],
  nowMs: number,
): DeliveryBoardSummary {
  const today = restaurantDay(nowMs);
  const summary: DeliveryBoardSummary = { searching: 0, assigned: 0, onTheWay: 0, completedToday: 0 };
  const activeIds = new Set(active.map((request) => request.requestId));
  for (const request of active) {
    if (isSearching(request)) summary.searching += request.remainingDeliveries;
    for (const order of deliveryOrders(request)) {
      if (order.progress.phase === "assigned") summary.assigned += order.deliveriesInOrder;
      if (order.progress.phase === "picked_up") summary.onTheWay += order.deliveriesInOrder;
    }
    const completedAt = request.completedAt ?? request.updatedAt;
    if (completedAt && restaurantDay(completedAt) === today) summary.completedToday += completedDeliveryCount(request);
  }
  for (const record of history) {
    if (activeIds.has(record.requestId)) continue;
    const finished = record.finalizedAt ?? record.createdAt;
    if (restaurantDay(finished) === today) summary.completedToday += record.completedDeliveries;
  }
  return summary;
}

/** Header for multi-delivery requests: "SOLICITUD #E814C7 · 2 de 3 asignadas". */
export function requestGroupTitle(request: DispatchRequest) {
  return `SOLICITUD ${formatOrderNumber(requestOrderNumber(request))}`;
}

export function requestGroupProgress(request: DispatchRequest) {
  return `${request.assignedDeliveries} de ${request.totalDeliveries} ${request.totalDeliveries === 1 ? "asignada" : "asignadas"}`;
}
