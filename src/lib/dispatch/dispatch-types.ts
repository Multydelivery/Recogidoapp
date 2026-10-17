export type AssignmentMode = "individual" | "batch";
export const twilioRequestIdPattern = /^WEB[A-F0-9]{32}$/i;
export const twilioChildRequestIdPattern = /^WEB[A-F0-9]{32}_[1-9][0-9]*$/i;
export const dispatchRequestIdPattern = /^(?:WEB[A-F0-9]{32}|WEB_[a-f0-9]{32})$/i;

export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export type DispatchStatus =
  | "open"
  | "partially_claimed"
  | "claimed"
  | "fully_assigned"
  | "cancelled"
  | "closed";

/** Request statuses exactly as the central service may report them (before canonical normalization). */
export const centralRequestStatuses = [
  "open", "no_driver_alerted", "partially_claimed", "claimed", "assigned",
  "fully_assigned", "picked_up", "completed", "cancelled", "closed",
] as const;
export type CentralRequestStatus = typeof centralRequestStatuses[number];

/** Per-delivery (child) statuses as the central service may report them. */
export const centralDeliveryStatuses = [
  "open", "no_driver_alerted", "claimed", "assigned", "picked_up", "completed", "cancelled", "closed",
] as const;
export type CentralDeliveryStatus = typeof centralDeliveryStatuses[number];

export function isCentralRequestStatus(value: unknown): value is CentralRequestStatus {
  return typeof value === "string" && (centralRequestStatuses as readonly string[]).includes(value);
}

export function isCentralDeliveryStatus(value: unknown): value is CentralDeliveryStatus {
  return typeof value === "string" && (centralDeliveryStatuses as readonly string[]).includes(value);
}

export interface RestaurantPublic {
  slug: string;
  name: string;
  active: boolean;
  deliveryEnabled: boolean;
  maxDeliveries: number;
  assignmentMode: AssignmentMode;
  maxActiveDeliveriesPerDriver: number;
}

export interface DispatchCapabilities {
  liveDispatch: boolean;
  canCreate: boolean;
  canReadStatus: boolean;
  canCancel: boolean;
  canResend: boolean;
  canLoadHistory: boolean;
  canLoadActive: boolean;
}

/** Public order number pattern (without "#"): "E814C7" for a request, "E814C7-01" for one delivery. */
export const orderNumberPattern = /^[A-Z0-9]{4,12}(?:-[0-9]{2,3})?$/;

/**
 * Normalizes an order number received from the central service. Returns undefined for anything
 * that is not a short public code (internal WEB identifiers, phone-like digit runs, URLs…).
 */
export function cleanOrderNumber(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.trim().replace(/^#/, "").toUpperCase();
  if (!orderNumberPattern.test(code) || code.startsWith("WEB") || /\d{7,}/.test(code)) return undefined;
  return code;
}

/** Order base of an order number: "E814C7-01" → "E814C7". */
export function orderBase(orderNumber: string) {
  return orderNumber.split("-")[0];
}

/**
 * Display-only fallback for older records without orderNumber: the last six alphanumeric
 * characters of the root request ID, plus "-01", "-02"… for individual deliveries.
 * The request ID itself is never used as a visible label.
 */
export function fallbackOrderNumber(requestId: string, deliveryNumber?: number) {
  const root = requestId.replace(/_[0-9]+$/, "").replace(/^WEB_?/i, "").replace(/[^A-Za-z0-9]/g, "");
  const base = root.slice(-6).toUpperCase().padStart(6, "0");
  return deliveryNumber === undefined ? base : `${base}-${String(deliveryNumber).padStart(2, "0")}`;
}

export function childOrderNumber(parentOrderNumber: string, deliveryNumber: number) {
  return `${orderBase(parentOrderNumber)}-${String(deliveryNumber).padStart(2, "0")}`;
}

export interface DeliveryAssignment {
  requestId: string;
  deliveryNumber: number;
  /** "claimed" covers assigned and picked-up deliveries; see `pickedUp`. */
  status: "open" | "claimed" | "cancelled" | "closed";
  /** Status exactly as reported by the central service (e.g. "picked_up"), when available. */
  centralStatus?: CentralDeliveryStatus;
  /** Public order number without "#", e.g. "E814C7-01". */
  orderNumber?: string;
  /** Central `winnerName`. */
  driverName?: string;
  /** Central `claimedAt`. */
  assignedAt?: string;
  createdAt?: string;
  /** True once the driver picked the order up (status picked_up in the central service). */
  pickedUp?: boolean;
  pickedUpAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  updatedAt?: string;
}

export interface DispatchRequest {
  requestId: string;
  requestType: "parent" | "batch";
  parentRequestId: string;
  deliveryCount: number;
  totalDeliveries: number;
  assignedDeliveries: number;
  remainingDeliveries: number;
  assignmentMode: AssignmentMode;
  status: DispatchStatus;
  /** Status exactly as reported by the central service (e.g. "picked_up"), when available. */
  centralStatus?: CentralRequestStatus;
  restaurantId?: string;
  alertSent?: boolean;
  childRequestIds: string[];
  deliveries: DeliveryAssignment[];
  driverName?: string;
  assignedAt?: string;
  createdAt: string;
  updatedAt?: string;
  noDriverAlerted?: boolean;
  /** Present when the central service reports it (active queue): deliveries already delivered. */
  completedDeliveries?: number;
  /** Present when the central service reports it (active queue): assigned deliveries still on the road. */
  activeDeliveries?: number;
  /** Public order number of the whole request without "#", e.g. "E814C7". */
  orderNumber?: string;
  /** Public base order number without "#" (same as `orderNumber` for root requests). */
  baseOrderNumber?: string;
  restaurantName?: string;
  pickedUpDeliveries?: number;
  /** Picked-up deliveries still on the road. */
  inTransitDeliveries?: number;
  cancelledDeliveries?: number;
  /** Batch requests only: when the single driver picked the orders up. */
  pickedUpAt?: string;
  completedAt?: string;
  cancelledAt?: string;
}

/** Statuses exactly as the central history service reports them; never rewritten by the client. */
export type DispatchHistoryStatus =
  | "open"
  | "no_driver_alerted"
  | "partially_claimed"
  | "claimed"
  | "assigned"
  | "fully_assigned"
  | "picked_up"
  | "completed"
  | "cancelled"
  | "closed";

export type DispatchHistoryDeliveryStatus = "open" | "assigned" | "completed" | "cancelled";

export interface DispatchHistoryDelivery {
  requestId: string;
  deliveryNumber: number;
  status: DispatchHistoryDeliveryStatus;
  orderNumber?: string;
  driverName?: string;
  assignedAt?: string;
  pickedUpAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  finalizedAt?: string;
}

/** One request of the restaurant's real delivery history. Contains no phone numbers or internal data. */
export interface DispatchHistoryRecord {
  requestId: string;
  orderNumber?: string;
  status: DispatchHistoryStatus;
  totalDeliveries: number;
  assignedDeliveries: number;
  completedDeliveries: number;
  cancelledDeliveries: number;
  pendingDeliveries: number;
  activeDeliveries: number;
  driverNames: string[];
  createdAt: string;
  finalizedAt: string | null;
  deliveries: DispatchHistoryDelivery[];
}

export interface DispatchHistorySnapshot {
  restaurantId: string;
  count: number;
  requests: DispatchHistoryRecord[];
}

export const historyStatuses: readonly DispatchHistoryStatus[] = centralRequestStatuses;

/** Final history statuses shown in the HISTORIAL section. */
export function isFinalHistoryStatus(status: DispatchHistoryStatus) {
  return status === "completed" || status === "cancelled" || status === "closed";
}

export interface DispatchSnapshot {
  mockMode: boolean;
  restaurant: RestaurantPublic;
  request: DispatchRequest | null;
  history: DispatchRequest[];
  operationStatus?: "created_with_timer_error";
  /** Only present on cancel responses: pending deliveries cancelled by this operation (0 when nothing was pending). */
  cancelledDeliveries?: number;
}

export interface ActiveDispatchSnapshot {
  restaurantId: string;
  count: number;
  requests: DispatchRequest[];
}

export function activeDispatchLabel(request: DispatchRequest) {
  return request.noDriverAlerted ? "Sin respuesta — continúa disponible" :
    request.status === "partially_claimed" ? "Asignación parcial" : "Buscando conductor";
}

export function isOpenRequest(status: DispatchStatus) {
  return status === "open" || status === "partially_claimed";
}

/** Still on the restaurant's board: searching for a driver or assigned and awaiting delivery. */
export function isLiveRequest(status: DispatchStatus) {
  return isOpenRequest(status) || status === "claimed" || status === "fully_assigned";
}

/** On the board: live, or cancelled pending deliveries while assigned ones are still on the road. */
export function isOnBoard(request: Pick<DispatchRequest, "status" | "activeDeliveries">) {
  return isLiveRequest(request.status) || (request.status === "cancelled" && (request.activeDeliveries ?? 0) > 0);
}

export function shouldPollDispatchRequest(request: DispatchRequest | null, requestId: string) {
  return request?.requestId === requestId && isOpenRequest(request.status);
}

export const dispatchStatusLabels: Record<DispatchStatus, string> = {
  open: "Buscando conductores",
  partially_claimed: "Parcialmente asignada",
  claimed: "Conductor asignado",
  fully_assigned: "Todas asignadas",
  cancelled: "Cancelada",
  closed: "Cerrada",
};
