import "server-only";
import { twilioRequestIdPattern as rootIdPattern, twilioChildRequestIdPattern, isValidIdempotencyKey, isOpenRequest, isOnBoard, historyStatuses, cleanOrderNumber, childOrderNumber, fallbackOrderNumber, orderBase, isCentralRequestStatus, isCentralDeliveryStatus } from "./dispatch-types";
import type {
  AssignmentMode,
  DeliveryAssignment,
  DispatchHistoryDelivery,
  DispatchHistoryRecord,
  DispatchHistorySnapshot,
  DispatchHistoryStatus,
  DispatchRequest,
  DispatchStatus,
  RestaurantPublic,
  ActiveDispatchSnapshot,
} from "./dispatch-types";
import { DispatchError, getBackendConfig, resolveDispatchMode, type BackendOperation } from "./server/config";

export type BackendErrorCode = "not_configured" | "timeout" | "network" | "http" | "invalid_response" | "rejected" | "timer_error";

export class RecogidoApiError extends DispatchError {
  public createdRequest?: DispatchRequest;
  /** Safe server-side diagnostic: name of the rejected field and, for statuses only, the rejected value. */
  public diagnostic?: { field: string; status?: string };

  constructor(
    public readonly code: BackendErrorCode,
    public readonly requestId: string | undefined,
    statusCode: number,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(statusCode, message, code === "not_configured" ? "NOT_CONFIGURED" :
      code === "timer_error" ? "CREATED_WITH_TIMER_ERROR" : "CENTRAL_API_ERROR");
  }

}

interface Identity {
  restaurantId: string;
  requestId?: string;
}

export interface CreateDeliveryRequestInput {
  restaurantId: string;
  restaurantPhone: string;
  deliveryCount: number;
  idempotencyKey: string;
  configuration: RestaurantPublic;
}

const statusValues: DispatchStatus[] = ["open", "partially_claimed", "claimed", "fully_assigned", "cancelled", "closed"];

/** Canonical status for each central request status. picked_up/assigned are resolved against pending counts later. */
const canonicalRequestStatus: Record<string, DispatchStatus> = {
  open: "open",
  no_driver_alerted: "open",
  partially_claimed: "partially_claimed",
  partially_assigned: "partially_claimed",
  claimed: "claimed",
  assigned: "fully_assigned",
  fully_assigned: "fully_assigned",
  picked_up: "fully_assigned",
  completed: "closed",
  closed: "closed",
  cancelled: "cancelled",
  canceled: "cancelled",
};

const canonicalDeliveryStatus: Record<string, DeliveryAssignment["status"]> = {
  open: "open",
  no_driver_alerted: "open",
  claimed: "claimed",
  assigned: "claimed",
  picked_up: "claimed",
  completed: "closed",
  closed: "closed",
  cancelled: "cancelled",
  canceled: "cancelled",
};

/** Status values are short enum tokens; anything else is never echoed to logs. */
function safeStatusToken(value: unknown) {
  return typeof value === "string" && /^[a-z_]{1,32}$/.test(value) ? value : typeof value;
}

function fieldNames(value: unknown) {
  return isRecord(value) ? Object.keys(value).filter((key) => /^[A-Za-z_][A-Za-z0-9_]{0,40}$/.test(key)).sort() : [];
}

declare global {
  var recogidoMakeTimersStarted: Set<string> | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | null {
  const parsed = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof parsed === "number" && Number.isInteger(parsed) && parsed >= minimum && parsed <= maximum ? parsed : null;
}

function safeText(value: unknown, maximum = 100) {
  return typeof value === "string" && value.length <= maximum && !/[\u0000-\u001f]/.test(value) &&
    !value.includes("://") && !value.includes("@") ? value : undefined;
}

function safeDriverName(value: unknown) {
  const name = safeText(value);
  return name && !/(?:^|\D)\+?[1-9]\d{7,14}(?:\D|$)/.test(name) ? name : undefined;
}

function isoDate(value: unknown) {
  const date = safeText(value, 40);
  if (!date || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(date)) return undefined;
  const timestamp = Date.parse(date);
  if (!Number.isFinite(timestamp)) return undefined;
  return new Date(timestamp).toISOString() === date.replace(/Z$/, date.includes(".") ? "Z" : ".000Z")
    ? date : undefined;
}

/** Optional ISO timestamp: absent/null/"" means "not available", anything else must be a valid ISO date. */
function optionalIsoDate(value: unknown, invalid: () => Error): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const date = isoDate(value);
  if (!date) throw invalid();
  return date;
}

function containsSensitiveValue(value: unknown, sensitiveValues: string[]): boolean {
  if (typeof value === "string") return sensitiveValues.some((sensitive) => sensitive && value.includes(sensitive));
  if (Array.isArray(value)) return value.some((entry) => containsSensitiveValue(entry, sensitiveValues));
  return isRecord(value) && Object.values(value).some((entry) => containsSensitiveValue(entry, sensitiveValues));
}

function requestPayload(value: unknown, identity: Identity): Record<string, unknown> | null {
  if (!isRecord(value) || value.success !== true) {
    throw new RecogidoApiError("invalid_response", identity.requestId, 502, "Respuesta inválida del servicio central.", false);
  }
  if ("request" in value && value.request === null) {
    if (value.restaurantId !== undefined && value.restaurantId !== identity.restaurantId) {
      throw new RecogidoApiError("invalid_response", identity.requestId, 502, "Respuesta inválida del servicio central.", false);
    }
    return null;
  }
  if (value.request !== undefined && !isRecord(value.request)) {
    throw new RecogidoApiError("invalid_response", identity.requestId, 502, "Respuesta inválida del servicio central.", false);
  }
  const nested = isRecord(value.request) ? value.request : undefined;
  const payload: Record<string, unknown> = nested ? {
    ...value,
    ...nested,
    ...(nested.deliveryCount !== undefined || nested.requestedDeliveries !== undefined
      ? { deliveryCount: nested.deliveryCount !== undefined ? nested.deliveryCount : nested.requestedDeliveries } : {}),
    ...(nested.children !== undefined && nested.deliveries === undefined ? { deliveries: undefined } : {}),
  } : { ...value };
  if (payload.restaurantId !== identity.restaurantId ||
    (value.restaurantId !== undefined && value.restaurantId !== identity.restaurantId)) {
    throw new RecogidoApiError("invalid_response", identity.requestId, 502, "Respuesta inválida del servicio central.", false);
  }
  if (payload.requestedDeliveries !== undefined && payload.deliveryCount === undefined) {
    payload.deliveryCount = payload.requestedDeliveries;
  }
  if (Array.isArray(payload.children) && payload.deliveries === undefined) {
    payload.deliveries = payload.children.map((child) => {
      if (!isRecord(child)) return child;
      return {
        ...child,
        driverName: child.driverName ?? child.winnerName,
        assignedAt: child.assignedAt ?? child.claimedAt,
      };
    });
  }
  if (identity.requestId && payload.requestId !== identity.requestId) {
    throw new RecogidoApiError("invalid_response", identity.requestId, 502, "Respuesta inválida del servicio central.", false);
  }
  return payload;
}

export function normalizeRequest(
  value: unknown,
  identity: Identity,
  configuration: RestaurantPublic,
  initialCreateResponse = false,
): DispatchRequest | null {
  const payload = requestPayload(value, identity);
  if (!payload) return null;
  const invalid = (field = "request", status?: unknown) => {
    const error = new RecogidoApiError("invalid_response", identity.requestId, 502, "Respuesta inválida del servicio central.", false);
    error.diagnostic = { field, ...(status !== undefined ? { status: safeStatusToken(status) } : {}) };
    return error;
  };
  const requestId = payload.requestId;
  const deliveryCount = boundedInteger(payload.deliveryCount, 1, configuration.maxDeliveries);
  const createdAt = payload.createdAt === undefined && initialCreateResponse
    ? new Date().toISOString() : isoDate(payload.createdAt);
  const rawStatus = payload.status === undefined && initialCreateResponse ? "open" : payload.status;
  const centralStatus = isCentralRequestStatus(rawStatus) ? rawStatus :
    rawStatus === "canceled" ? "cancelled" : rawStatus === "partially_assigned" ? "partially_claimed" : undefined;
  let status: DispatchStatus | undefined = typeof rawStatus === "string" && Object.hasOwn(canonicalRequestStatus, rawStatus)
    ? canonicalRequestStatus[rawStatus] : undefined;
  if (typeof requestId !== "string" || !rootIdPattern.test(requestId) ||
    (identity.requestId && requestId !== identity.requestId)) throw invalid("requestId");
  if (!status || !statusValues.includes(status)) throw invalid("status", rawStatus);
  if (deliveryCount === null) throw invalid("requestedDeliveries");
  if (!createdAt || !Number.isFinite(Date.parse(createdAt))) throw invalid("createdAt");

  const assignmentMode: AssignmentMode = payload.assignmentMode === "batch" || payload.assignmentMode === "individual"
    ? payload.assignmentMode : configuration.assignmentMode;
  const requestType = payload.requestType === "batch" || payload.requestType === "parent"
    ? payload.requestType : assignmentMode === "batch" ? "batch" : "parent";
  if ((requestType === "batch") !== (assignmentMode === "batch")) throw invalid("requestType");

  const childIds = Array.isArray(payload.childRequestIds) ? payload.childRequestIds : [];
  for (const items of [payload.children, payload.deliveries, payload.childRequestIds]) {
    if (items !== undefined && !Array.isArray(items)) throw invalid("children");
  }
  if (childIds.some((id) => typeof id !== "string" || !twilioChildRequestIdPattern.test(id) ||
    id.slice(0, id.lastIndexOf("_")).toUpperCase() !== requestId.toUpperCase())) throw invalid("childRequestIds");

  const deliveries: DispatchRequest["deliveries"] = [];
  // Server-owned public label: the central orderNumber, or a short display-only fallback for older records.
  const publicOrderNumber = orderBase(cleanOrderNumber(payload.orderNumber) ?? cleanOrderNumber(payload.baseOrderNumber) ??
    fallbackOrderNumber(requestId));
  if (Array.isArray(payload.deliveries)) {
    if (payload.deliveries.length > configuration.maxDeliveries) throw invalid("children");
    for (const [index, delivery] of payload.deliveries.entries()) {
      if (!isRecord(delivery)) throw invalid("children");
      const number = boundedInteger(delivery.deliveryNumber, 1, configuration.maxDeliveries);
      const id = delivery.requestId;
      const pickedUp = delivery.status === "picked_up";
      const status = typeof delivery.status === "string" && Object.hasOwn(canonicalDeliveryStatus, delivery.status)
        ? canonicalDeliveryStatus[delivery.status] : undefined;
      if (number === null) throw invalid("children.deliveryNumber");
      if (typeof id !== "string" || !twilioChildRequestIdPattern.test(id) ||
        id.toUpperCase() !== `${requestId}_${number}`.toUpperCase()) throw invalid("children.requestId");
      if (!status) throw invalid("children.status", delivery.status);
      const driverName = safeDriverName(typeof delivery.driverName === "string"
        ? delivery.driverName.trim() : delivery.driverName);
      const assignedAt = isoDate(delivery.assignedAt);
      const unassigned = status === "open" || status === "cancelled";
      const emptyName = delivery.driverName === undefined ||
        (unassigned && (delivery.driverName === null || delivery.driverName === ""));
      const emptyTime = delivery.assignedAt === undefined || ((unassigned || pickedUp) && delivery.assignedAt === null);
      if (!emptyName && !driverName) throw invalid("children.winnerName");
      if (!emptyTime && !assignedAt) throw invalid("children.claimedAt");
      // A picked-up delivery always names its driver; its claim time may be omitted by the central service.
      if (status === "claimed" && !driverName) throw invalid("children.winnerName", delivery.status);
      if (status === "claimed" && !assignedAt && !pickedUp) throw invalid("children.claimedAt", delivery.status);
      const pickedUpAt = optionalIsoDate(delivery.pickedUpAt, () => invalid("children.pickedUpAt"));
      const completedAt = optionalIsoDate(delivery.completedAt, () => invalid("children.completedAt"));
      const cancelledAt = optionalIsoDate(delivery.cancelledAt ?? delivery.canceledAt, () => invalid("children.cancelledAt"));
      const childCreatedAt = optionalIsoDate(delivery.createdAt, () => invalid("children.createdAt"));
      const childUpdatedAt = optionalIsoDate(delivery.updatedAt, () => invalid("children.updatedAt"));
      const assigned = status === "claimed" || status === "closed";
      const childCentralStatus = isCentralDeliveryStatus(delivery.status) ? delivery.status :
        delivery.status === "canceled" ? "cancelled" : undefined;
      deliveries.push({
        requestId: id,
        deliveryNumber: number,
        status,
        ...(childCentralStatus && childCentralStatus !== status ? { centralStatus: childCentralStatus } : {}),
        orderNumber: cleanOrderNumber(delivery.orderNumber) ?? childOrderNumber(publicOrderNumber, number),
        ...(driverName ? { driverName } : {}),
        ...(assignedAt ? { assignedAt } : {}),
        ...(pickedUp || (status === "claimed" && pickedUpAt) ? { pickedUp: true } : {}),
        ...(assigned && pickedUpAt ? { pickedUpAt } : {}),
        ...(status === "closed" && completedAt ? { completedAt } : {}),
        ...(status === "cancelled" && cancelledAt ? { cancelledAt } : {}),
        ...(childCreatedAt ? { createdAt: childCreatedAt } : {}),
        ...(childUpdatedAt ? { updatedAt: childUpdatedAt } : {}),
      });
      if (number !== index + 1) throw invalid("children.deliveryNumber");
    }
  } else if (requestType === "parent" && childIds.length) {
    childIds.forEach((id, index) => deliveries.push({
      requestId: id as string,
      deliveryNumber: index + 1,
      status: "open",
      orderNumber: childOrderNumber(publicOrderNumber, index + 1),
    }));
  }
  const openRequestIds = payload.openRequestIds;
  if (openRequestIds !== undefined) {
    if (!Array.isArray(openRequestIds) || openRequestIds.some((id) => typeof id !== "string" || !childIds.includes(id))) throw invalid("openRequestIds");
  }
  if (childIds.length && deliveries.length && childIds.some((id, index) => id !== deliveries[index]?.requestId)) throw invalid("childRequestIds");
  const aggregateCreateResponse = initialCreateResponse && childIds.length === 0 &&
    (payload.deliveries === undefined || (Array.isArray(payload.children) && payload.children.length === 0 && deliveries.length === 0));
  if (requestType === "parent" && deliveries.length !== deliveryCount && !aggregateCreateResponse) throw invalid("children");
  const childrenAuthoritative = requestType === "parent" && !aggregateCreateResponse;
  const assignedFromItems = deliveries.filter((delivery) => delivery.status === "claimed" || delivery.status === "closed").length;
  const openFromItems = deliveries.filter((delivery) => delivery.status === "open").length;
  for (const [field, count] of [
    ["assignedDeliveries", payload.assignedDeliveries],
    ["pendingDeliveries", payload.pendingDeliveries],
    ["remainingDeliveries", payload.remainingDeliveries],
  ] as const) {
    if (count !== undefined && boundedInteger(count, 0, deliveryCount) === null) throw invalid(field);
  }
  if (payload.totalDeliveries !== undefined && boundedInteger(payload.totalDeliveries, 1, configuration.maxDeliveries) !== deliveryCount) throw invalid("totalDeliveries");
  const reportedAssigned = boundedInteger(payload.assignedDeliveries, 0, deliveryCount);
  if (childrenAuthoritative && reportedAssigned !== null) {
    // Parent requests carry one child per delivery: the children are the source of truth for assignment.
    // The central service may count picked-up and/or completed deliveries outside assignedDeliveries.
    const completedFromItems = deliveries.filter((delivery) => delivery.status === "closed").length;
    const pickedUpFromItems = deliveries.filter((delivery) => delivery.status === "claimed" && delivery.pickedUp).length;
    const accepted = new Set([
      assignedFromItems,
      assignedFromItems - completedFromItems,
      assignedFromItems - pickedUpFromItems,
      assignedFromItems - completedFromItems - pickedUpFromItems,
    ]);
    if (!accepted.has(reportedAssigned)) throw invalid("assignedDeliveries", rawStatus);
  }
  const assignedDeliveries = childrenAuthoritative ? assignedFromItems : reportedAssigned ??
    (requestType === "batch" && ["claimed", "fully_assigned"].includes(String(status)) ? deliveryCount : assignedFromItems);
  const remainingDeliveries = boundedInteger(payload.pendingDeliveries ?? payload.remainingDeliveries, 0, deliveryCount) ??
    (aggregateCreateResponse && status === "open" ? deliveryCount - assignedDeliveries :
      requestType === "batch" ? (assignedDeliveries === deliveryCount ? 0 : deliveryCount) :
      openFromItems);
  if ((reportedAssigned ?? assignedDeliveries) + remainingDeliveries > deliveryCount) throw invalid("assignedDeliveries");
  if (assignedDeliveries + remainingDeliveries > deliveryCount) throw invalid("pendingDeliveries");
  // picked_up/assigned describe the drivers' progress, not whether every delivery has a driver yet.
  if ((rawStatus === "picked_up" || rawStatus === "assigned") && assignedDeliveries > 0 && remainingDeliveries > 0) {
    status = "partially_claimed";
  }
  // Cancelled/closed requests can contain unassigned deliveries that are no longer pending.
  // A fully assigned request may also contain deliveries whose pending part was cancelled earlier.
  const cancelledFromItems = status === "fully_assigned"
    ? deliveries.filter((delivery) => delivery.status === "cancelled").length : 0;
  if (status !== "cancelled" && status !== "closed" &&
    assignedDeliveries + remainingDeliveries + cancelledFromItems !== deliveryCount) throw invalid("pendingDeliveries", rawStatus);
  if (status === "fully_assigned" && (assignedDeliveries === 0 || remainingDeliveries !== 0)) throw invalid("status", rawStatus);
  if (status === "partially_claimed" && (assignedDeliveries === 0 || remainingDeliveries === 0)) throw invalid("status", rawStatus);
  if (childrenAuthoritative && remainingDeliveries !== openFromItems) throw invalid("pendingDeliveries", rawStatus);
  const totalDeliveries = boundedInteger(payload.totalDeliveries, 1, configuration.maxDeliveries) ?? deliveryCount;
  const parentRequestId = payload.parentRequestId === undefined ? requestId : payload.parentRequestId;
  if (parentRequestId !== requestId) throw invalid("parentRequestId");
  const driverName = safeDriverName(payload.driverName);
  const assignedAt = optionalIsoDate(payload.assignedAt, () => invalid("assignedAt"));
  const updatedAt = optionalIsoDate(payload.updatedAt, () => invalid("updatedAt"));
  const optionalCount = (field: string, count: unknown) => {
    if (count === undefined || count === null) return undefined;
    const parsed = boundedInteger(count, 0, deliveryCount);
    if (parsed === null) throw invalid(field);
    return parsed;
  };
  const completedDeliveries = optionalCount("completedDeliveries", payload.completedDeliveries);
  const activeDeliveries = optionalCount("activeDeliveries", payload.activeDeliveries);
  const pickedUpCount = optionalCount("pickedUpDeliveries", payload.pickedUpDeliveries);
  const inTransitCount = optionalCount("inTransitDeliveries", payload.inTransitDeliveries);
  const cancelledCount = optionalCount("cancelledDeliveries", payload.cancelledDeliveries);
  if ((completedDeliveries ?? 0) + (activeDeliveries ?? 0) > deliveryCount) throw invalid("activeDeliveries");
  if ((pickedUpCount ?? 0) > assignedDeliveries) throw invalid("pickedUpDeliveries", rawStatus);
  if ((inTransitCount ?? 0) > assignedDeliveries) throw invalid("inTransitDeliveries", rawStatus);
  const parentPickedUpAt = optionalIsoDate(payload.pickedUpAt, () => invalid("pickedUpAt"));
  const parentCompletedAt = optionalIsoDate(payload.completedAt, () => invalid("completedAt"));
  const parentCancelledAt = optionalIsoDate(payload.cancelledAt ?? payload.canceledAt, () => invalid("cancelledAt"));
  const restaurantName = safeText(payload.restaurantName);
  if (payload.alertSent !== undefined && payload.alertSent !== null && typeof payload.alertSent !== "boolean") throw invalid("alertSent");
  // Batch requests have no child records: their pick-up is reported on the root.
  const pickedUpDeliveries = pickedUpCount ??
    (requestType === "batch" && (payload.status === "picked_up" || parentPickedUpAt) ? deliveryCount :
      requestType === "parent" && deliveries.some((delivery) => delivery.pickedUp)
        ? deliveries.filter((delivery) => delivery.pickedUp && delivery.status === "claimed").length : undefined);
  const inTransitDeliveries = inTransitCount ??
    (requestType === "batch" ? ((pickedUpDeliveries ?? 0) > 0 && (status === "claimed" || status === "fully_assigned") ? deliveryCount : undefined) :
      deliveries.some((delivery) => delivery.pickedUp && delivery.status === "claimed")
        ? deliveries.filter((delivery) => delivery.pickedUp && delivery.status === "claimed").length : undefined);
  return {
    requestId,
    requestType,
    parentRequestId: requestId,
    deliveryCount,
    totalDeliveries,
    assignedDeliveries,
    remainingDeliveries,
    assignmentMode,
    status,
    ...(payload.status !== undefined && centralStatus && centralStatus !== status ? { centralStatus } : {}),
    ...(typeof payload.alertSent === "boolean" ? { alertSent: payload.alertSent } : {}),
    childRequestIds: deliveries.map((delivery) => delivery.requestId),
    deliveries,
    orderNumber: publicOrderNumber,
    ...(cleanOrderNumber(payload.baseOrderNumber) ? { baseOrderNumber: publicOrderNumber } : {}),
    ...(restaurantName ? { restaurantName } : {}),
    ...(driverName ? { driverName } : {}),
    ...(assignedAt ? { assignedAt } : {}),
    createdAt,
    ...(updatedAt ? { updatedAt } : {}),
    ...(payload.status === "no_driver_alerted" ? { noDriverAlerted: true } : {}),
    ...(completedDeliveries !== undefined ? { completedDeliveries } : {}),
    ...(activeDeliveries !== undefined ? { activeDeliveries } : {}),
    ...(pickedUpDeliveries !== undefined ? { pickedUpDeliveries } : {}),
    ...(inTransitDeliveries !== undefined ? { inTransitDeliveries } : {}),
    ...(cancelledCount !== undefined ? { cancelledDeliveries: cancelledCount } : {}),
    ...(parentPickedUpAt ? { pickedUpAt: parentPickedUpAt } : {}),
    ...(parentCompletedAt ? { completedAt: parentCompletedAt } : {}),
    ...(parentCancelledAt ? { cancelledAt: parentCancelledAt } : {}),
  };
}

export function normalizeConfiguration(value: unknown, restaurantId: string): RestaurantPublic {
  const invalid = () => new RecogidoApiError("invalid_response", undefined, 502, "Configuración inválida del servicio central.", false);
  if (!isRecord(value) || value.success !== true) throw invalid();
  if (value.restaurantId !== undefined && value.restaurantId !== restaurantId) throw invalid();
  const payload = isRecord(value.restaurant) ? value.restaurant : value;
  if (!isRecord(payload)) throw invalid();
  if (payload.restaurantId !== undefined && payload.restaurantId !== restaurantId) throw invalid();
  if (payload.slug !== undefined && payload.slug !== restaurantId) throw invalid();
  const slug = payload.restaurantId ?? payload.slug ?? value.restaurantId;
  const maxDeliveries = boundedInteger(payload.maxDeliveries, 1, 20);
  const maxActiveDeliveriesPerDriver = boundedInteger(payload.maxActiveDeliveriesPerDriver, 1, 20);
  const name = safeText(payload.name);
  if (slug !== restaurantId || !name || maxDeliveries === null || maxActiveDeliveriesPerDriver === null ||
    (payload.assignmentMode !== "individual" && payload.assignmentMode !== "batch") ||
    typeof payload.active !== "boolean" || typeof payload.deliveryEnabled !== "boolean") throw invalid();
  return {
    slug: restaurantId,
    name,
    maxDeliveries,
    maxActiveDeliveriesPerDriver,
    assignmentMode: payload.assignmentMode,
    active: payload.active,
    deliveryEnabled: payload.deliveryEnabled,
  };
}

async function centralRequest(
  operation: BackendOperation,
  identity: Identity,
  fields: Record<string, string>,
): Promise<unknown> {
  let config: ReturnType<typeof getBackendConfig>;
  try {
    const legacyDirectAdapterTest = process.env.DISPATCH_LIVE_TEST_ENABLED !== "true" && process.env.DISPATCH_MOCK_MODE === "false";
    if (resolveDispatchMode(identity.restaurantId) !== "twilio" && !legacyDirectAdapterTest) {
      throw new DispatchError(503, "El modo de integración no está disponible.");
    }
    config = getBackendConfig(operation);
  } catch (error: unknown) {
    const notConfigured = error instanceof DispatchError && error.code === "NOT_CONFIGURED";
    throw new RecogidoApiError(
      notConfigured ? "not_configured" : "invalid_response",
      identity.requestId,
      error instanceof DispatchError ? error.statusCode : 503,
      notConfigured ? "La operación todavía no está disponible para producción." : "La integración central no está habilitada o configurada correctamente.",
      false,
    );
  }
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const safeId = identity.requestId && rootIdPattern.test(identity.requestId) ? identity.requestId : "latest";
  try {
    const response = await fetch(config.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        ...(config.authorization ? { Authorization: config.authorization } : {}),
      },
      body: new URLSearchParams({ ...fields, ...(config.secret ? { secret: config.secret } : {}) }),
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) {
      // Upstream 401/403 means server-to-server credentials were refused; map to 502 so the
      // terminal never confuses it with a wrong restaurant PIN.
      const upstreamAuth = response.status === 401 || response.status === 403;
      const statusCode = response.status === 404 ? 404 : response.status === 409 ? 409 : response.status === 429 ? 429 : 502;
      throw new RecogidoApiError(upstreamAuth ? "rejected" : "http", identity.requestId, statusCode,
        upstreamAuth ? "El servicio central rechazó la autorización del servidor. Contacte a soporte de Recogido." :
          statusCode === 404 ? "Solicitud no encontrada para este restaurante." :
            statusCode === 409 ? "La operación entra en conflicto con el estado del servicio central." :
              statusCode === 429 ? "Demasiadas operaciones. Espera un momento y vuelve a intentar." :
                "El servicio central no pudo completar la operación.",
        !upstreamAuth && (response.status >= 500 || response.status === 429));
    }
    try {
      const data: unknown = await response.json();
      if (containsSensitiveValue(data, [
        config.secret ?? "",
        config.url,
        config.makeWebhookUrl ?? "",
        config.authorization ?? "",
        config.username ?? "",
        config.password ?? "",
        fields.idempotencyKey ?? "",
      ])) {
        throw new RecogidoApiError("invalid_response", identity.requestId, 502, "Respuesta inválida del servicio central.", false);
      }
      console.info("Dispatch central", {
        operation,
        requestId: safeId,
        statusCode: response.status,
        durationMs: Date.now() - startedAt,
      });
      return data;
    } catch {
      if (controller.signal.aborted) throw new RecogidoApiError("timeout", identity.requestId, 504, "El servicio central tardó demasiado. Reintenta la misma operación.", true);
      throw new RecogidoApiError("invalid_response", identity.requestId, 502, "Respuesta inválida del servicio central.", false);
    }
  } catch (error: unknown) {
    const safeError = error instanceof RecogidoApiError ? error :
      controller.signal.aborted
        ? new RecogidoApiError("timeout", identity.requestId, 504, "El servicio central tardó demasiado. Reintenta la misma operación.", true)
        : new RecogidoApiError("network", identity.requestId, 502, "No se pudo contactar al servicio central. Reintenta la misma operación.", true);
    console.warn("Dispatch central", {
      operation,
      requestId: safeId,
      code: safeError.code,
      statusCode: safeError.statusCode,
      durationMs: Date.now() - startedAt,
    });
    throw safeError;
  } finally {
    clearTimeout(timeout);
  }
}

async function startMakeTimer(input: {
  restaurantId: string;
  restaurantPhone: string;
  deliveryCount: number;
}, request: DispatchRequest, generation: string): Promise<void> {
  const config = getBackendConfig("create");
  if (!config.makeWebhookUrl || !config.makeTimerSecret) {
    throw new RecogidoApiError("not_configured", request.requestId, 503, "El temporizador de Make todavía no está configurado.", false);
  }
  const timerKey = `${request.requestId}:${generation}`;
  const startedTimers = globalThis.recogidoMakeTimersStarted ??= new Set<string>();
  if (startedTimers.has(timerKey)) return;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetch(config.makeWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": timerKey },
      body: new URLSearchParams({
        requestId: request.requestId,
        restaurantId: input.restaurantId,
        restaurantPhone: input.restaurantPhone,
        deliveryCount: String(input.deliveryCount),
        timerGeneration: generation,
        secret: config.makeTimerSecret,
      }),
      signal: controller.signal,
      redirect: "error",
      cache: "no-store",
    });
    if (!response.ok) {
      throw new RecogidoApiError("http", request.requestId, 502, "No se pudo iniciar el temporizador de despacho.", response.status >= 500 || response.status === 429);
    }
    startedTimers.add(timerKey);
    console.info("Dispatch central", {
      operation: "make_timer",
      requestId: request.requestId,
      statusCode: response.status,
      durationMs: Date.now() - startedAt,
    });
  } catch (error: unknown) {
    const timerFailure = error instanceof RecogidoApiError ? error :
      controller.signal.aborted
        ? new RecogidoApiError("timeout", request.requestId, 504, "El temporizador de despacho tardó demasiado en iniciar.", true)
        : new RecogidoApiError("network", request.requestId, 502, "No se pudo iniciar el temporizador de despacho.", true);
    const safeError = new RecogidoApiError(
      "timer_error",
      request.requestId,
      202,
      "Solicitud creada en Twilio, pero no se pudo confirmar el temporizador de alertas.",
      timerFailure.retryable,
    );
    safeError.createdRequest = request;
    console.warn("Dispatch central", {
      operation: "make_timer",
      requestId: request.requestId,
      code: safeError.code,
      statusCode: safeError.statusCode,
      durationMs: Date.now() - startedAt,
    });
    throw safeError;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getRestaurantConfiguration(input: {
  restaurantId: string;
  fallback: RestaurantPublic;
}): Promise<RestaurantPublic> {
  if (resolveDispatchMode(input.restaurantId) !== "twilio") return { ...input.fallback };
  const value = await centralRequest("config", { restaurantId: input.restaurantId }, { restaurantId: input.restaurantId });
  const configuration = normalizeConfiguration(value, input.restaurantId);
  if (input.restaurantId === "restaurant-test" &&
    (configuration.maxDeliveries !== 3 || configuration.assignmentMode !== "individual" ||
      configuration.maxActiveDeliveriesPerDriver !== 1 || configuration.active === false || configuration.deliveryEnabled === false)) {
    throw new RecogidoApiError("invalid_response", undefined, 503, "La configuración de prueba no coincide con el perfil autorizado.", false);
  }
  return configuration;
}

export async function createDeliveryRequest(input: CreateDeliveryRequestInput): Promise<DispatchRequest> {
  if (!isValidIdempotencyKey(input.idempotencyKey)) {
    throw new DispatchError(400, "Clave de idempotencia inválida.");
  }
  const value = await centralRequest("create", { restaurantId: input.restaurantId }, {
    restaurantId: input.restaurantId,
    deliveryCount: String(input.deliveryCount),
    idempotencyKey: input.idempotencyKey,
  });
  const request = normalizeRequest(value, { restaurantId: input.restaurantId }, input.configuration, true);
  if (!request || request.deliveryCount !== input.deliveryCount) {
    throw new RecogidoApiError("invalid_response", undefined, 502, "Respuesta inválida del servicio central.", false);
  }
  await startMakeTimer(input, request, "initial");
  return request;
}

export async function getDeliveryRequestStatus(input: Identity & { configuration: RestaurantPublic }): Promise<DispatchRequest | null> {
  const value = await centralRequest("status", input, {
    restaurantId: input.restaurantId,
    requestId: input.requestId ?? "",
  });
  return normalizeRequest(value, input, input.configuration);
}

export function normalizeActiveRequests(
  value: unknown, identity: Identity, configuration: RestaurantPublic,
): ActiveDispatchSnapshot {
  const invalid = (field: string, status?: unknown) => {
    const error = new RecogidoApiError("invalid_response", undefined, 502, "Cola inválida del servicio central.", false);
    error.diagnostic = { field, ...(status !== undefined ? { status: safeStatusToken(status) } : {}) };
    return error;
  };
  let current: unknown;
  try {
    if (!isRecord(value) || value.success !== true) throw invalid("success");
    if (value.restaurantId !== identity.restaurantId) throw invalid("restaurantId");
    if (!Array.isArray(value.requests)) throw invalid("requests");
    if (!Number.isInteger(value.count) || value.count !== value.requests.length) throw invalid("count");
    const ids = new Set<string>();
    const requests = value.requests.map((item) => {
      current = item;
      if (!isRecord(item)) throw invalid("requests");
      if (!isCentralRequestStatus(item.status)) throw invalid("status", item.status);
      if (item.alertSent !== undefined && item.alertSent !== null && typeof item.alertSent !== "boolean") throw invalid("alertSent");
      let request: DispatchRequest | null;
      try {
        request = normalizeRequest({ success: true, request: item }, identity, configuration);
      } catch (error: unknown) {
        if (!(error instanceof RecogidoApiError)) throw error;
        const queueError = invalid("request");
        queueError.diagnostic = error.diagnostic ?? { field: "request" };
        throw queueError;
      }
      if (!request) throw invalid("request");
      if (ids.has(request.requestId.toUpperCase())) throw invalid("requestId");
      ids.add(request.requestId.toUpperCase());
      return withActiveCounts(request, identity.restaurantId);
    }).filter(isOnBoard);
    return { restaurantId: identity.restaurantId, count: requests.length, requests };
  } catch (error: unknown) {
    if (error instanceof RecogidoApiError) logActiveDiagnostic(value, current, error);
    throw error;
  }
}

/** Active-queue counters are always present: absent central values fall back to the children, then to 0. */
function withActiveCounts(request: DispatchRequest, restaurantId: string): DispatchRequest {
  const children = request.deliveries;
  const batch = request.requestType === "batch";
  const completed = request.completedDeliveries ??
    (batch ? (request.status === "closed" ? request.totalDeliveries : 0) : children.filter((item) => item.status === "closed").length);
  const cancelled = request.cancelledDeliveries ?? children.filter((item) => item.status === "cancelled").length;
  const pickedUp = request.pickedUpDeliveries ?? 0;
  const inTransit = request.inTransitDeliveries ?? 0;
  const active = request.activeDeliveries ?? Math.max(0, request.assignedDeliveries - completed);
  return {
    ...request,
    restaurantId,
    completedDeliveries: completed,
    cancelledDeliveries: cancelled,
    pickedUpDeliveries: pickedUp,
    inTransitDeliveries: inTransit,
    activeDeliveries: active,
  };
}

/** Logs only field names and the rejected field/status: never values, credentials, phones or URLs. */
function logActiveDiagnostic(value: unknown, item: unknown, error: RecogidoApiError) {
  const firstChild = isRecord(item) && Array.isArray(item.children) ? item.children.find(isRecord) : undefined;
  console.warn("Dispatch central active normalization failed", {
    operation: "active",
    responseFields: fieldNames(value),
    requestFields: fieldNames(item),
    childFields: fieldNames(firstChild),
    rejectedField: error.diagnostic?.field ?? "unknown",
    ...(error.diagnostic?.status ? { rejectedStatus: error.diagnostic.status } : {}),
  });
}

export async function getActiveDeliveryRequests(input: Identity & { configuration: RestaurantPublic }): Promise<ActiveDispatchSnapshot> {
  const value = await centralRequest("active", input, { restaurantId: input.restaurantId });
  return normalizeActiveRequests(value, input, input.configuration);
}

export const cancelPendingAction = "cancel_pending";

/**
 * Cancels only the still-pending deliveries of a root request. The action is fixed server-side;
 * callers can never choose another URL or action.
 */
export async function cancelDeliveryRequest(input: Identity & { requestId: string; configuration: RestaurantPublic }): Promise<{
  request: DispatchRequest;
  cancelledDeliveries?: number;
}> {
  const value = await centralRequest("cancel", input, {
    restaurantId: input.restaurantId,
    requestId: input.requestId,
    action: cancelPendingAction,
  });
  const invalid = () => new RecogidoApiError("invalid_response", input.requestId, 502, "Respuesta inválida del servicio central.", false);
  if (isRecord(value) && value.action !== undefined && value.action !== cancelPendingAction) throw invalid();
  const request = normalizeRequest(value, input, input.configuration);
  if (!request) throw invalid();
  // After cancel_pending nothing may remain pending and the root can no longer be open.
  if (isOpenRequest(request.status) || request.remainingDeliveries !== 0) throw invalid();
  const rawCount = isRecord(value) ? value.cancelledDeliveries : undefined;
  if (rawCount === undefined) return { request };
  const cancelledDeliveries = boundedInteger(rawCount, 0, request.deliveryCount);
  if (cancelledDeliveries === null || typeof rawCount !== "number") throw invalid();
  return { request, cancelledDeliveries };
}

export async function resendDeliveryRequest(input: Identity & {
  requestId: string;
  configuration: RestaurantPublic;
  openRequestIds: string[];
  restaurantPhone: string;
}): Promise<DispatchRequest> {
  const value = await centralRequest("resend", input, {
    restaurantId: input.restaurantId,
    requestId: input.requestId,
    openRequestIds: input.openRequestIds.join(","),
  });
  const request = normalizeRequest(value, input, input.configuration);
  if (!request) throw new RecogidoApiError("invalid_response", input.requestId, 502, "Respuesta inválida del servicio central.", false);
  await startMakeTimer({
    restaurantId: input.restaurantId,
    restaurantPhone: input.restaurantPhone,
    deliveryCount: request.deliveryCount,
  }, request, `resend:${request.updatedAt ?? request.createdAt}`);
  return request;
}

export async function getRecentDeliveryRequests(input: Identity & { configuration: RestaurantPublic }): Promise<DispatchRequest[]> {
  const value = await centralRequest("history", input, { restaurantId: input.restaurantId });
  if (!isRecord(value) || value.success !== true || value.restaurantId !== input.restaurantId || !Array.isArray(value.requests)) {
    throw new RecogidoApiError("invalid_response", undefined, 502, "Historial inválido del servicio central.", false);
  }
  if (value.requests.length > 5) throw new RecogidoApiError("invalid_response", undefined, 502, "Historial inválido del servicio central.", false);
  return value.requests.map((request) => normalizeRequest({ success: true, restaurantId: input.restaurantId, request }, input, input.configuration))
    .filter((request): request is DispatchRequest => request !== null);
}

export const historyRequestLimit = 50;

/** Accepts an optional ISO timestamp: absent/null/"" means "not available", anything else must be a valid ISO date. */
function optionalHistoryDate(value: unknown, invalid: () => Error): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const date = isoDate(value);
  if (!date) throw invalid();
  return date;
}

function optionalHistoryDriver(value: unknown, invalid: () => Error): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw invalid();
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const name = safeDriverName(trimmed);
  if (!name) throw invalid();
  return name;
}

const historyDeliveryStatuses: Record<string, DispatchHistoryDelivery["status"]> = {
  open: "open",
  claimed: "assigned",
  assigned: "assigned",
  picked_up: "assigned",
  completed: "completed",
  closed: "completed",
  cancelled: "cancelled",
  canceled: "cancelled",
};

function normalizeHistoryRecord(item: unknown, restaurantId: string, invalid: () => Error): DispatchHistoryRecord {
  if (!isRecord(item) || item.restaurantId !== restaurantId) throw invalid();
  const requestId = item.requestId;
  const status = item.status;
  if (typeof requestId !== "string" || !rootIdPattern.test(requestId) ||
    typeof status !== "string" || !historyStatuses.includes(status as DispatchHistoryStatus)) throw invalid();
  const totalDeliveries = boundedInteger(item.totalDeliveries, 1, 20);
  if (totalDeliveries === null) throw invalid();
  const count = (value: unknown) => {
    const parsed = boundedInteger(value, 0, totalDeliveries);
    if (parsed === null) throw invalid();
    return parsed;
  };
  const assignedDeliveries = count(item.assignedDeliveries);
  const completedDeliveries = count(item.completedDeliveries);
  const cancelledDeliveries = count(item.cancelledDeliveries);
  const pendingDeliveries = count(item.pendingDeliveries);
  const activeDeliveries = count(item.activeDeliveries);
  if (completedDeliveries + cancelledDeliveries + pendingDeliveries + activeDeliveries > totalDeliveries) throw invalid();
  if ((status === "completed" || status === "cancelled" || status === "closed") && pendingDeliveries !== 0) throw invalid();
  const createdAt = isoDate(item.createdAt);
  if (!createdAt) throw invalid();
  const finalizedAt = optionalHistoryDate(item.finalizedAt, invalid) ?? null;

  if (item.driverNames !== undefined && !Array.isArray(item.driverNames)) throw invalid();
  const rawDrivers: unknown[] = Array.isArray(item.driverNames) ? item.driverNames : [];
  if (rawDrivers.length > 20) throw invalid();
  const driverNames = [...new Set(rawDrivers
    .map((name) => optionalHistoryDriver(name, invalid))
    .filter((name): name is string => name !== undefined))];

  const rawDeliveries = item.deliveries ?? item.children ?? [];
  const orderNumber = orderBase(cleanOrderNumber(item.orderNumber) ?? fallbackOrderNumber(requestId));
  if (!Array.isArray(rawDeliveries) || rawDeliveries.length > totalDeliveries) throw invalid();
  const numbers = new Set<number>();
  const deliveries = rawDeliveries.map((delivery): DispatchHistoryDelivery => {
    if (!isRecord(delivery)) throw invalid();
    const deliveryNumber = boundedInteger(delivery.deliveryNumber, 1, totalDeliveries);
    const childId = delivery.requestId;
    const childStatus = historyDeliveryStatuses[String(delivery.status)];
    if (deliveryNumber === null || numbers.has(deliveryNumber) || !childStatus ||
      typeof childId !== "string" || !twilioChildRequestIdPattern.test(childId) ||
      childId.toUpperCase() !== `${requestId}_${deliveryNumber}`.toUpperCase()) throw invalid();
    numbers.add(deliveryNumber);
    const driverName = optionalHistoryDriver(delivery.driverName ?? delivery.winnerName, invalid);
    const assignedAt = optionalHistoryDate(delivery.assignedAt ?? delivery.claimedAt, invalid);
    const pickedUpAt = optionalHistoryDate(delivery.pickedUpAt, invalid);
    const completedAt = optionalHistoryDate(delivery.completedAt, invalid);
    const cancelledAt = optionalHistoryDate(delivery.cancelledAt ?? delivery.canceledAt, invalid);
    const deliveryFinalizedAt = optionalHistoryDate(delivery.finalizedAt, invalid) ?? completedAt ?? cancelledAt;
    // Open children never carry a driver; only assigned/completed ones may name one.
    const withDriver = childStatus === "assigned" || childStatus === "completed";
    return {
      requestId: childId,
      deliveryNumber,
      status: childStatus,
      orderNumber: cleanOrderNumber(delivery.orderNumber) ?? childOrderNumber(orderNumber, deliveryNumber),
      ...(withDriver && driverName ? { driverName } : {}),
      ...(withDriver && assignedAt ? { assignedAt } : {}),
      ...(withDriver && pickedUpAt ? { pickedUpAt } : {}),
      ...(childStatus === "completed" && completedAt ? { completedAt } : {}),
      ...(childStatus === "cancelled" && cancelledAt ? { cancelledAt } : {}),
      ...(childStatus !== "open" && deliveryFinalizedAt ? { finalizedAt: deliveryFinalizedAt } : {}),
    };
  }).sort((left, right) => left.deliveryNumber - right.deliveryNumber);

  return {
    requestId,
    orderNumber,
    status: status as DispatchHistoryStatus,
    totalDeliveries,
    assignedDeliveries,
    completedDeliveries,
    cancelledDeliveries,
    pendingDeliveries,
    activeDeliveries,
    driverNames,
    createdAt,
    finalizedAt,
    deliveries,
  };
}

/**
 * Strictly validates /web-delivery-history. Every request must belong to the authenticated
 * restaurant; unknown fields (phones, internal data) are dropped, never forwarded.
 */
export function normalizeDeliveryHistory(value: unknown, restaurantId: string): DispatchHistorySnapshot {
  const invalid = () => new RecogidoApiError("invalid_response", undefined, 502, "Historial inválido del servicio central.", false);
  if (!isRecord(value) || value.success !== true || value.restaurantId !== restaurantId ||
    !Array.isArray(value.requests) || value.requests.length > historyRequestLimit ||
    !Number.isInteger(value.count) || value.count !== value.requests.length) throw invalid();
  const ids = new Set<string>();
  const requests = value.requests.map((item) => {
    const record = normalizeHistoryRecord(item, restaurantId, invalid);
    if (ids.has(record.requestId.toUpperCase())) throw invalid();
    ids.add(record.requestId.toUpperCase());
    return record;
  });
  return { restaurantId, count: requests.length, requests };
}

/** Reads the restaurant's latest history (server-owned restaurantId, fixed limit). */
export async function getDeliveryHistory(input: Identity): Promise<DispatchHistorySnapshot> {
  const value = await centralRequest("history", { restaurantId: input.restaurantId }, {
    restaurantId: input.restaurantId,
    limit: String(historyRequestLimit),
  });
  return normalizeDeliveryHistory(value, input.restaurantId);
}
