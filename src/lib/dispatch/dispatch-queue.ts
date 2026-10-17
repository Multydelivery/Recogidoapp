import { isFinalHistoryStatus, isOnBoard, isOpenRequest, type DeliveryAssignment, type DispatchCapabilities, type DispatchHistoryDelivery, type DispatchHistoryRecord, type DispatchRequest } from "./dispatch-types";

export type DispatchDisplayStatus =
  | "open"
  | "no_driver_alerted"
  | "partially_claimed"
  | "fully_assigned"
  | "completed"
  | "cancelled"
  | "closed";

export const dispatchDisplayLabels: Record<DispatchDisplayStatus, string> = {
  open: "Buscando conductor",
  no_driver_alerted: "Sin respuesta — sigue disponible",
  partially_claimed: "Asignación parcial",
  fully_assigned: "Todas asignadas",
  completed: "Entrega completada",
  cancelled: "Solicitud cancelada",
  closed: "Solicitud cerrada",
};

export function displayStatus(request: DispatchRequest): DispatchDisplayStatus {
  switch (request.status) {
    case "open":
      return request.noDriverAlerted ? "no_driver_alerted" : "open";
    case "partially_claimed":
      return request.noDriverAlerted && request.assignedDeliveries === 0 ? "no_driver_alerted" : "partially_claimed";
    case "claimed":
    case "fully_assigned":
      return "fully_assigned";
    case "cancelled":
      return "cancelled";
    case "closed":
      return request.assignedDeliveries > 0 && request.assignedDeliveries === request.totalDeliveries ? "completed" : "closed";
  }
}

export function displayLabel(request: DispatchRequest) {
  return dispatchDisplayLabels[displayStatus(request)];
}

const urgency: Partial<Record<DispatchDisplayStatus, number>> = {
  no_driver_alerted: 0,
  partially_claimed: 1,
  open: 2,
};

export function sortActiveRequests(requests: readonly DispatchRequest[]) {
  return [...requests].sort((left, right) => {
    const byUrgency = (urgency[displayStatus(left)] ?? 3) - (urgency[displayStatus(right)] ?? 3);
    return byUrgency || Date.parse(right.createdAt) - Date.parse(left.createdAt);
  });
}

export interface DispatchSummaryCounts {
  searching: number;
  assigned: number;
  pending: number;
}

/** Only requests still on the board count; finished or cancelled requests never add pending deliveries. */
export function summarizeActiveRequests(requests: readonly DispatchRequest[]): DispatchSummaryCounts {
  return requests.filter(isOnBoard).reduce((summary, request) => ({
    searching: summary.searching + (isSearching(request) ? 1 : 0),
    assigned: summary.assigned + request.assignedDeliveries,
    pending: summary.pending + request.remainingDeliveries,
  }), { searching: 0, assigned: 0, pending: 0 });
}

export function shortRequestId(requestId: string) {
  return `#${requestId.replace(/^WEB_?/i, "").slice(-6).toUpperCase()}`;
}

export function canResendRequest(request: DispatchRequest, capabilities: Pick<DispatchCapabilities, "canResend">) {
  return capabilities.canResend && isOpenRequest(request.status) && request.remainingDeliveries > 0;
}

export function canCancelRequest(request: DispatchRequest, capabilities: Pick<DispatchCapabilities, "canCancel">) {
  return capabilities.canCancel && isOpenRequest(request.status) && request.remainingDeliveries > 0;
}

function pendingWord(count: number) {
  return count === 1 ? "entrega pendiente" : "entregas pendientes";
}

/** "CANCELAR SOLICITUD" when nothing is assigned yet; otherwise names how many pending deliveries go away. */
export function cancelActionLabel(request: DispatchRequest) {
  const pending = request.remainingDeliveries;
  if (request.assignedDeliveries === 0) return "CANCELAR SOLICITUD";
  return `CANCELAR ${pending} ${pending === 1 ? "PENDIENTE" : "PENDIENTES"}`;
}

export function cancelConfirmationText(request: DispatchRequest) {
  const pending = request.remainingDeliveries;
  const assigned = request.assignedDeliveries;
  if (pending === 0) return "La solicitud ya no tiene entregas pendientes.";
  return `Se cancelará${pending === 1 ? "" : "n"} ${pending} ${pendingWord(pending)}. ` + (assigned === 0
    ? "Esta solicitud no tiene entregas asignadas."
    : `${assigned === 1 ? "La entrega ya asignada no será afectada" : `Las ${assigned} entregas ya asignadas no serán afectadas`}.`);
}

/** Text of the single notification shown after the server confirms a cancellation. */
export function cancellationResultText(cancelledDeliveries: number) {
  if (cancelledDeliveries === 0) return "La solicitud ya no tiene entregas pendientes.";
  return cancelledDeliveries === 1
    ? "Se canceló 1 entrega pendiente."
    : `Se cancelaron ${cancelledDeliveries} entregas pendientes.`;
}

export function deliveryStateLabel(delivery: Pick<DeliveryAssignment, "status">) {
  return delivery.status === "claimed" ? "Asignada" :
    delivery.status === "closed" ? "Completada" :
      delivery.status === "cancelled" ? "Cancelada" : "Buscando conductor";
}

/** Batch requests have no child records, so they are presented as a single delivery group. */
export function presentedDeliveries(request: DispatchRequest): DeliveryAssignment[] {
  if (request.assignmentMode === "individual" && request.deliveries.length > 0) {
    return [...request.deliveries].sort((left, right) => left.deliveryNumber - right.deliveryNumber);
  }
  const status = request.status === "cancelled" ? "cancelled" :
    request.status === "closed" ? "closed" :
      request.status === "claimed" || request.status === "fully_assigned" ? "claimed" : "open";
  const pickedUp = status === "claimed" && (!!request.pickedUpAt ||
    (request.pickedUpDeliveries ?? 0) >= request.totalDeliveries);
  return [{
    requestId: request.requestId,
    deliveryNumber: 1,
    status,
    ...(request.orderNumber ? { orderNumber: request.orderNumber } : {}),
    ...(status !== "open" && request.driverName ? { driverName: request.driverName } : {}),
    ...(status !== "open" && request.assignedAt ? { assignedAt: request.assignedAt } : {}),
    ...(pickedUp ? { pickedUp: true } : {}),
    ...((status === "claimed" || status === "closed") && request.pickedUpAt ? { pickedUpAt: request.pickedUpAt } : {}),
    ...(status === "closed" && request.completedAt ? { completedAt: request.completedAt } : {}),
    ...(status === "cancelled" && request.cancelledAt ? { cancelledAt: request.cancelledAt } : {}),
    ...(request.updatedAt ? { updatedAt: request.updatedAt } : {}),
  }];
}

export function formatClock(value: string | number | Date) {
  return new Intl.DateTimeFormat("es-US", { timeZone: dispatchTimeZone, hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function formatElapsed(fromIso: string, nowMs: number) {
  const seconds = Math.max(0, Math.floor((nowMs - Date.parse(fromIso)) / 1000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${minutes % 60} min`;
}

export function formatLastUpdate(lastUpdatedMs: number | null, nowMs: number) {
  if (lastUpdatedMs === null) return "Sin actualizar todavía";
  const seconds = Math.max(0, Math.round((nowMs - lastUpdatedMs) / 1000));
  if (seconds < 2) return "Última actualización: ahora mismo";
  if (seconds < 60) return `Última actualización: hace ${seconds} segundos`;
  const minutes = Math.floor(seconds / 60);
  return `Última actualización: hace ${minutes} ${minutes === 1 ? "minuto" : "minutos"}`;
}

/** Section A: still looking for drivers for at least one delivery. */
export function isSearching(request: DispatchRequest) {
  return isOpenRequest(request.status) && request.remainingDeliveries > 0;
}

/** Splits the live board into "Buscando conductor" and "Entregas en curso". Nothing pending ⇒ in progress. */
export function partitionActive(requests: readonly DispatchRequest[]) {
  const onBoard = sortActiveRequests(requests.filter(isOnBoard));
  return {
    searching: onBoard.filter(isSearching),
    inProgress: onBoard.filter((request) => !isSearching(request)),
  };
}

export function completedDeliveryCount(request: DispatchRequest) {
  if (request.completedDeliveries !== undefined) return request.completedDeliveries;
  return request.assignmentMode === "batch"
    ? (request.status === "closed" ? request.totalDeliveries : 0)
    : request.deliveries.filter((delivery) => delivery.status === "closed").length;
}

/** Assigned deliveries that have not been confirmed as delivered yet (never counts fully_assigned as completed). */
export function activeDeliveryCount(request: DispatchRequest) {
  if (request.activeDeliveries !== undefined) return request.activeDeliveries;
  return Math.max(0, request.assignedDeliveries - completedDeliveryCount(request));
}

export function requestDriverNames(request: DispatchRequest) {
  const names = presentedDeliveries(request)
    .filter((delivery) => (delivery.status === "claimed" || delivery.status === "closed") && delivery.driverName)
    .map((delivery) => delivery.driverName as string);
  return [...new Set(names)];
}

/** Most recent assignment time, or null when the server did not report one. */
export function lastAssignedAt(request: DispatchRequest) {
  const times = presentedDeliveries(request)
    .map((delivery) => delivery.assignedAt)
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)));
  if (request.assignedAt && Number.isFinite(Date.parse(request.assignedAt))) times.push(request.assignedAt);
  if (!times.length) return null;
  return times.reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest);
}

export const noDriverWarningMs = 20_000;

/** True once the request has waited 20 seconds or the server already sent the no-driver alert. */
export function needsAttention(request: DispatchRequest, nowMs: number) {
  return isSearching(request) && (request.noDriverAlerted === true || nowMs - Date.parse(request.createdAt) >= noDriverWarningMs);
}

export type HistoryOutcome = "completed" | "partially_completed" | "cancelled" | "closed" | "in_progress";

export const historyOutcomeLabels: Record<HistoryOutcome, string> = {
  completed: "Completada",
  partially_completed: "Completada parcialmente",
  cancelled: "Cancelada",
  closed: "Cerrada",
  in_progress: "En curso",
};

/** Presentation only: the original server status is never rewritten. */
export function historyOutcome(record: DispatchHistoryRecord): HistoryOutcome {
  if (!isFinalHistoryStatus(record.status)) return "in_progress";
  if (record.completedDeliveries > 0 && record.cancelledDeliveries > 0) return "partially_completed";
  if (record.status === "completed") return "completed";
  if (record.status === "cancelled") return "cancelled";
  if (record.status === "closed") return record.completedDeliveries > 0 ? "completed" : "closed";
  return "in_progress";
}

function historyTime(record: DispatchHistoryRecord) {
  const finalized = record.finalizedAt ? Date.parse(record.finalizedAt) : Number.NaN;
  if (Number.isFinite(finalized)) return finalized;
  const created = Date.parse(record.createdAt);
  return Number.isFinite(created) ? created : 0;
}

/** Most recently finalized first; records without finalizedAt fall back to their creation time. */
export function sortHistory(records: readonly DispatchHistoryRecord[]) {
  return [...records].sort((left, right) => historyTime(right) - historyTime(left));
}

export function historyDeliveryLabel(delivery: Pick<DispatchHistoryDelivery, "status">) {
  return delivery.status === "completed" ? "Completada" :
    delivery.status === "cancelled" ? "Cancelada" :
      delivery.status === "assigned" ? "Asignada" : "Sin asignar";
}

export const dispatchTimeZone = "America/New_York";

const dateTimeFormatter = new Intl.DateTimeFormat("es-US", {
  timeZone: dispatchTimeZone,
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Restaurant-local date and time (America/New_York). Null or invalid values never break the UI. */
export function formatDateTime(value: string | number | Date | null | undefined) {
  if (value === null || value === undefined || value === "") return "Fecha no disponible";
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "Fecha no disponible";
  return dateTimeFormatter.format(date);
}
