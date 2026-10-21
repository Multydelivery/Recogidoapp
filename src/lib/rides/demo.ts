import { assertCents, calculateRidePricing, settleRideAutomatically, type AutomaticSettlement, type RidePricing } from "./pricing";
import type { RideEvent, RideEventProcessor } from "./contracts";
import { demoPaymentGateway } from "./paymentSimulator";
import { publicStatusLabels, recordRideStatus, rideTimelineDefinition, type RideArrival, type RideDriver, type RideStatusEvent } from "./progress";

export type RideStatus = "quote_created" | "payment_pending" | "payment_authorized" | "ride_requesting" |
  "booked" | "driver_assigned" | "driver_arriving" | "driver_arrived" | "passenger_picked_up" | "in_progress" |
  "arrived_destination" | "completed" | "settled" | "cancelled" | "needs_attention" | "payment_failed";
export type PaymentStatus = "not_started" | "pending" | "authorized" | "paid" | "released" | "failed" | "additional_payment_required";
export type RequestChannel = "web" | "phone" | "operator";
export type ExceptionReason = "provider_unavailable" | "booking_error" | "final_timeout" | "webhook_error" | "additional_payment_required" | "migration";
export const scenarioLabels = {
  normal: "Viaje normal", no_driver: "Ningún conductor disponible", payment_declined: "Pago rechazado",
  free_cancellation: "Cancelación gratuita", charged_cancellation: "Cancelación con cargo",
  lower_final: "Precio final menor", higher_within: "Precio mayor dentro de la autorización",
  over_authorization: "Precio superior a la autorización", duplicate: "Evento duplicado",
  missing_final: "Falta del evento final", booking_error: "Error al reservar", webhook_error: "Error al procesar evento",
};
export type DemoScenario = keyof typeof scenarioLabels;
export const statusLabels = publicStatusLabels;
export const serviceLabels = {
  on_demand: "Bajo demanda", scheduled: "Programado", medical: "Cita médica",
  senior_assistance: "Asistencia a adultos mayores", business: "Empresarial", other: "Otro",
};
export const rideSteps: RideStatus[] = rideTimelineDefinition.map((step) => step.status);
export const demoNotice = "Modo de demostración — No se solicitará ningún viaje real ni se procesará ningún pago.";
export const cancellationPolicyVersion = "rides-demo-cancellation-v1";
export const cancellationPolicyText = "Entiendo que cualquier cargo real de cancelación aplicado por el proveedor de transporte podrá deducirse del monto autorizado.";
export const rideStorageKey = "recogido.rides.demo.v1";
export const EVENT_DELAY_MS = 1500;
export const FINAL_EVENT_TIMEOUT_MS = 15_000;

export type RideInput = {
  riderName: string; riderPhone: string; pickupAddress: string; destinationAddress: string;
  rideTiming: "now" | "scheduled"; scheduledAt: string | null; passengerCount: number;
  serviceType: keyof typeof serviceLabels; notes: string; requestChannel?: RequestChannel; scenario?: DemoScenario;
};
export type RideRequest = Omit<RideInput, "requestChannel" | "scenario"> & {
  id: string; requestSource: "web"; requestChannel: RequestChannel; scenario: DemoScenario; status: RideStatus; progressStatus: RideStatus;
  pricing: RidePricing; authorizedAmountCents: number; paymentStatus: PaymentStatus;
  cancellationPolicyAccepted: boolean; cancellationPolicyVersion: string; cancellationPolicyAcceptedAt: string | null;
  operatorInterventionRequired: boolean; operatorInterventionReason: string | null;
  providerReference: string; driverName: string; vehicleDescription: string; vehiclePlate: string;
  createdAt: string; updatedAt: string; paymentStartedAt: string | null; bookedAt: string | null;
  driverAssignedAt: string | null; completedAt: string | null; settledAt: string | null;
  nextEventAt: string | null; finalEventDeadline: string | null; attempt: number; paymentAttempt: number;
  processedEventIds: string[]; ignoredDeliveryIds: string[]; duplicateEventsIgnored: number;
  settlementOperationId: string | null; settlementCount: number; settlement: AutomaticSettlement | null;
  actualProviderCostCents: number | null; providerCancellationFeeCents: number; wasCancelled: boolean;
  exceptionReason: ExceptionReason | null; exceptionCount: number; exceptionResolvedAt: string | null;
  contactNote: string; additionalPaymentConsentCents: number; additionalPaymentConsentAt: string | null;
  additionalPaymentApprovedAt: string | null; additionalPaymentOperationId: string | null;
  legacyStatus: string | null;
  statusEvents: RideStatusEvent[]; estimatedArrival: RideArrival | null; driver: RideDriver | null;
};
export type RideSession = { version: 4; requests: RideRequest[]; currentRideId: string | null; notices: string[] };
export const emptyRideSession: RideSession = { version: 4, requests: [], currentRideId: null, notices: [] };
export type RideAction = { type: "accept_policy"; accepted: boolean } | { type: "start_payment" } |
  { type: "cancel" } | { type: "retry_booking" } | { type: "contact_customer"; note: string } |
  { type: "consent_additional"; amountCents: number } | { type: "approve_additional" } | { type: "resolve_exception" };

export function isDate(value: unknown): value is string { return typeof value === "string" && Number.isFinite(Date.parse(value)); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function hasKey<T extends object>(object: T, value: unknown): value is keyof T { return typeof value === "string" && Object.hasOwn(object, value); }
function text(value: unknown, label: string, max = 160): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) throw new Error(`${label}: completa el campo (máximo ${max} caracteres).`);
}
export function isServiceType(value: unknown): value is RideInput["serviceType"] { return hasKey(serviceLabels, value); }
export function isScenario(value: unknown): value is DemoScenario { return hasKey(scenarioLabels, value); }
export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("Importe inválido en centavos.");
  return new Intl.NumberFormat("es-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
export function money(cents: number | null) { return cents === null ? "Por definir" : formatCents(cents); }
export function parseDollarInput(value: string): number | null {
  const normalized = value.trim().replace(/^\$\s*/, "");
  if (!/^\d{1,7}([.,]\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return cents <= 100_000_000 ? cents : null;
}
export function parseMoney(value: string) {
  const cents = parseDollarInput(value);
  if (cents === null) throw new Error("Ingresa dólares válidos con un máximo de dos decimales.");
  return cents;
}
export function validateRideInput(input: RideInput, now: string, creating = true) {
  text(input.riderName, "Nombre", 100); text(input.riderPhone, "Teléfono", 30);
  if (!/^[+\d\s().-]+$/.test(input.riderPhone) || !/^\d{7,15}$/.test(input.riderPhone.replace(/\D/g, ""))) throw new Error("Usa un teléfono ficticio de 7 a 15 dígitos.");
  text(input.pickupAddress, "Recogida"); text(input.destinationAddress, "Destino");
  if (input.pickupAddress.trim().toLowerCase() === input.destinationAddress.trim().toLowerCase()) throw new Error("Recogida y destino deben ser diferentes.");
  if (input.rideTiming !== "now" && input.rideTiming !== "scheduled") throw new Error("Horario inválido.");
  if (input.rideTiming === "scheduled" ? !isDate(input.scheduledAt) || (creating && Date.parse(input.scheduledAt) <= Date.parse(now)) : input.scheduledAt !== null) throw new Error("Selecciona una fecha futura válida.");
  if (!Number.isInteger(input.passengerCount) || input.passengerCount < 1 || input.passengerCount > 8) throw new Error("El demo admite entre 1 y 8 pasajeros.");
  if (!isServiceType(input.serviceType) || typeof input.notes !== "string" || input.notes.length > 1000) throw new Error("Servicio o notas inválidos.");
  if (input.requestChannel !== undefined && !["web", "phone", "operator"].includes(input.requestChannel)) throw new Error("Canal inválido.");
  if (input.scenario !== undefined && !isScenario(input.scenario)) throw new Error("Escenario inválido.");
}
export function createRide(input: RideInput, id: string, now: string, providerEstimateCents = 2500): RideRequest {
  if (!isDate(now)) throw new Error("Fecha inválida.");
  text(id, "Identificador"); validateRideInput(input, now);
  return recordRideStatus({
    ...input, riderName: input.riderName.trim(), riderPhone: input.riderPhone.trim(), pickupAddress: input.pickupAddress.trim(),
    destinationAddress: input.destinationAddress.trim(), notes: input.notes.trim(), id, requestSource: "web",
    requestChannel: input.requestChannel ?? "web", scenario: input.scenario ?? "normal", status: "quote_created", progressStatus: "quote_created",
    pricing: calculateRidePricing(providerEstimateCents), authorizedAmountCents: 0, paymentStatus: "not_started",
    cancellationPolicyAccepted: false, cancellationPolicyVersion: "", cancellationPolicyAcceptedAt: null,
    operatorInterventionRequired: Boolean(input.requestChannel && input.requestChannel !== "web"),
    operatorInterventionReason: input.requestChannel && input.requestChannel !== "web" ? "Solicitud asistida." : null,
    providerReference: "", driverName: "", vehicleDescription: "", vehiclePlate: "", createdAt: now, updatedAt: now,
    paymentStartedAt: null, bookedAt: null, driverAssignedAt: null, completedAt: null, settledAt: null,
    nextEventAt: null, finalEventDeadline: null, attempt: 1, paymentAttempt: 0, processedEventIds: [], ignoredDeliveryIds: [],
    duplicateEventsIgnored: 0, settlementOperationId: null, settlementCount: 0, settlement: null, actualProviderCostCents: null,
    providerCancellationFeeCents: 0, wasCancelled: false, exceptionReason: null, exceptionCount: 0, exceptionResolvedAt: null,
    contactNote: "", additionalPaymentConsentCents: 0, additionalPaymentConsentAt: null,
    additionalPaymentApprovedAt: null, additionalPaymentOperationId: null, legacyStatus: null,
    statusEvents: [], estimatedArrival: null, driver: null,
  }, "customer");
}
export function hasAuthorizedPayment(ride: RideRequest) {
  return ["authorized", "paid"].includes(ride.paymentStatus) && ride.authorizedAmountCents === ride.pricing.authorizationTotalCents &&
    ride.cancellationPolicyAccepted && ride.cancellationPolicyVersion === cancellationPolicyVersion && isDate(ride.cancellationPolicyAcceptedAt);
}
export function canCancel(ride: RideRequest) {
  return !ride.settlement && !ride.completedAt &&
    !["passenger_picked_up", "in_progress", "arrived_destination", "completed", "settled", "cancelled"].includes(ride.progressStatus);
}
function schedule(now: string) { return new Date(Date.parse(now) + EVENT_DELAY_MS).toISOString(); }
export function requireAttention(ride: RideRequest, reason: ExceptionReason, now: string): RideRequest {
  if (ride.status === "needs_attention" && ride.exceptionReason === reason) return ride;
  return recordRideStatus({ ...ride, status: "needs_attention", exceptionReason: reason, exceptionCount: ride.exceptionCount + 1,
    exceptionResolvedAt: null, nextEventAt: null, estimatedArrival: null, updatedAt: now }, "system");
}
function finish(ride: RideRequest, cost: number, fee: number, now: string, cancelled: boolean): RideRequest {
  if (ride.settlementOperationId) return ride;
  assertCents(cost); assertCents(fee);
  if (!cancelled && !hasAuthorizedPayment(ride)) throw new Error("Falta autorización de pago.");
  if (cancelled && fee > 0 && !hasAuthorizedPayment(ride)) throw new Error("No hay autorización para el cargo de cancelación.");
  const cancellationFeeCents = cancelled ? Math.min(fee, ride.authorizedAmountCents) : 0;
  const operationId = `${ride.id}:close`;
  const { result } = demoPaymentGateway.settle({
    authorizedAmountCents: ride.authorizedAmountCents, providerFinalCostCents: cancelled ? 0 : cost,
    coordinationFeeCents: cancelled ? 0 : ride.pricing.coordinationFeeCents, cancellationFeeCents,
  }, operationId);
  let next: RideRequest = {
    ...ride, actualProviderCostCents: cancelled ? 0 : cost, providerCancellationFeeCents: fee, wasCancelled: cancelled,
    settlement: result, settlementOperationId: operationId, settlementCount: 1, settledAt: now,
    status: cancelled ? "cancelled" : "settled", paymentStatus: result.amountToCaptureCents ? "paid" : "released",
    progressStatus: cancelled ? ride.progressStatus : result.settlementStatus === "needs_attention" ? "completed" : "settled",
    finalEventDeadline: null, nextEventAt: null, estimatedArrival: null, updatedAt: now,
  };
  if (result.settlementStatus === "needs_attention") {
    next = requireAttention({ ...next, paymentStatus: "additional_payment_required" }, "additional_payment_required", now);
  } else if (ride.exceptionReason) next = { ...next, exceptionResolvedAt: now };
  return next;
}

const processRideEvent: RideEventProcessor = {
  process(ride, event) {
    if (event.rideId !== ride.id) throw new Error("El evento no corresponde a esta solicitud.");
    text(event.id, "ID de evento", 240); text(event.deliveryId, "ID de entrega", 260);
    if (ride.processedEventIds.includes(event.id)) {
      if (ride.ignoredDeliveryIds.includes(event.deliveryId)) return ride;
      return { ...ride, ignoredDeliveryIds: [...ride.ignoredDeliveryIds, event.deliveryId], duplicateEventsIgnored: ride.duplicateEventsIgnored + 1 };
    }
    const base = { ...ride, processedEventIds: [...ride.processedEventIds, event.id] };
    // A final result is immutable even if the provider resends it with a new event ID.
    if (ride.settlementOperationId || event.attempt !== ride.attempt || ["settled", "cancelled"].includes(ride.status)) return base;
    if (!isDate(event.at) || Date.parse(event.at) < Date.parse(ride.updatedAt)) return requireAttention(base, "webhook_error", ride.updatedAt);
    try {
      const transitions: Partial<Record<RideEvent["type"], [RideStatus, RideStatus]>> = {
        ride_requesting: ["payment_authorized", "ride_requesting"], booked: ["ride_requesting", "booked"],
        driver_assigned: ["booked", "driver_assigned"], driver_arriving: ["driver_assigned", "driver_arriving"],
        driver_arrived: ["driver_arriving", "driver_arrived"], passenger_picked_up: ["driver_arrived", "passenger_picked_up"],
        in_progress: ["passenger_picked_up", "in_progress"], arrived_destination: ["in_progress", "arrived_destination"],
        completed: ["arrived_destination", "completed"],
      };
      if (event.type === "payment_authorized" || event.type === "payment_failed") {
        if (ride.status !== "payment_pending" || !ride.cancellationPolicyAccepted ||
          ride.cancellationPolicyVersion !== cancellationPolicyVersion || !isDate(ride.cancellationPolicyAcceptedAt)) throw new Error("Pago fuera de secuencia.");
        return { ...base, status: event.type, progressStatus: event.type, authorizedAmountCents: event.type === "payment_authorized" ? ride.pricing.authorizationTotalCents : 0,
          paymentStatus: event.type === "payment_authorized" ? "authorized" : "failed",
          exceptionCount: ride.exceptionCount + (event.type === "payment_failed" ? 1 : 0),
          nextEventAt: event.type === "payment_authorized" ? schedule(event.at) : null, updatedAt: event.at };
      }
      if (["provider_unavailable", "booking_error", "webhook_error"].includes(event.type)) {
        if (!hasAuthorizedPayment(ride) || !["ride_requesting", "booked", "driver_assigned", "driver_arriving", "driver_arrived", "passenger_picked_up", "in_progress", "arrived_destination", "completed"].includes(ride.status)) throw new Error("Evento de error fuera de secuencia.");
        return requireAttention(base, event.type === "provider_unavailable" ? "provider_unavailable" : event.type === "booking_error" ? "booking_error" : "webhook_error", event.at);
      }
      if (event.type === "provider_final") {
        if (ride.status !== "completed" && !(ride.status === "needs_attention" && ride.exceptionReason === "final_timeout")) throw new Error("Falta completar el viaje.");
        if (event.providerFinalCostCents === undefined) throw new Error("Falta costo final.");
        return finish(base, event.providerFinalCostCents, 0, event.at, false);
      }
      if (event.type === "provider_cancelled") {
        if (!canCancel(ride) || event.cancellationFeeCents === undefined) throw new Error("Cancelación fuera de secuencia.");
        return finish(base, 0, event.cancellationFeeCents, event.at, true);
      }
      const transition = transitions[event.type];
      if (!transition || ride.status !== transition[0] || !hasAuthorizedPayment(ride)) throw new Error("Evento fuera de secuencia o sin pago autorizado.");
      const next: RideRequest = { ...base, status: transition[1], progressStatus: transition[1], nextEventAt: schedule(event.at), updatedAt: event.at };
      if (event.estimatedArrival !== undefined) {
        if (!validArrival(event.estimatedArrival)) throw new Error("Tiempo estimado inválido.");
        next.estimatedArrival = event.estimatedArrival;
      }
      if (event.driver !== undefined) {
        if (!validDriver(event.driver)) throw new Error("Datos públicos del conductor inválidos.");
        next.driver = event.driver;
      }
      if (event.type === "booked") { next.providerReference = `PROVEEDOR-DEMO-${ride.id}`; next.bookedAt = event.at; }
      if (event.type === "driver_assigned") {
        next.driverName = "Conductor Demo"; next.vehicleDescription = "Sedán ficticio azul"; next.vehiclePlate = "DEMO-001"; next.driverAssignedAt = event.at;
      }
      if (event.type === "completed") { next.completedAt = event.at; next.finalEventDeadline = new Date(Date.parse(event.at) + FINAL_EVENT_TIMEOUT_MS).toISOString(); }
      return next;
    } catch (error) {
      return { ...requireAttention(base, "webhook_error", event.at),
        operatorInterventionReason: error instanceof Error ? error.message : "Evento simulado inválido." };
    }
  },
};
export const rideEventProcessor: RideEventProcessor = {
  process(ride, event) {
    const next = processRideEvent.process(ride, event);
    return next.status === ride.status ? next : recordRideStatus(next,
      event.type.startsWith("payment_") ? "payment_simulator" : "provider_simulator");
  },
};
export function applyRideAction(ride: RideRequest, action: RideAction, now: string): RideRequest {
  const next = applyAction(ride, action, now);
  return next.status === ride.status ? next : recordRideStatus(next,
    ["retry_booking", "approve_additional", "resolve_exception", "contact_customer"].includes(action.type) ? "operator" : "customer");
}
function applyAction(ride: RideRequest, action: RideAction, now: string): RideRequest {
  if (!isDate(now) || Date.parse(now) < Date.parse(ride.updatedAt)) throw new Error("Fecha inválida.");
  const next = { ...ride, updatedAt: now };
  switch (action.type) {
    case "accept_policy":
      if (!["quote_created", "payment_failed"].includes(ride.status)) throw new Error("El pago ya se inició.");
      return { ...next, cancellationPolicyAccepted: action.accepted,
        cancellationPolicyVersion: action.accepted ? cancellationPolicyVersion : "", cancellationPolicyAcceptedAt: action.accepted ? now : null };
    case "start_payment":
      if (ride.status === "payment_pending") return ride;
      if (!["quote_created", "payment_failed"].includes(ride.status) || !ride.cancellationPolicyAccepted ||
        ride.cancellationPolicyVersion !== cancellationPolicyVersion || !isDate(ride.cancellationPolicyAcceptedAt)) throw new Error("Acepta el precio y la política antes del pago de prueba.");
      return { ...next, status: "payment_pending", progressStatus: "payment_pending", paymentStatus: "pending", paymentStartedAt: now,
        paymentAttempt: ride.paymentAttempt + 1, nextEventAt: schedule(now) };
    case "cancel":
      if (ride.status === "cancelled") return ride;
      if (!canCancel(ride)) throw new Error("Este viaje no se puede cancelar.");
      return finish(ride.status === "needs_attention" ? intervene(next, "Cancelación de excepción.") : next, 0, 0, now, true);
    case "retry_booking":
      if (ride.status === "ride_requesting" && ride.attempt > 1) return ride;
      if (ride.status !== "needs_attention" || !["provider_unavailable", "booking_error"].includes(ride.exceptionReason ?? "") ||
        !hasAuthorizedPayment(ride) || ride.providerReference) throw new Error("No es seguro reintentar esta reserva.");
      return { ...intervene(next, "Reintento de reserva solicitado."), status: "ride_requesting", progressStatus: "ride_requesting", attempt: ride.attempt + 1,
        nextEventAt: schedule(now), exceptionResolvedAt: now, exceptionReason: null };
    case "contact_customer":
      if (!["needs_attention", "payment_failed"].includes(ride.status)) throw new Error("No hay una excepción que contactar.");
      text(action.note, "Nota de contacto", 500);
      return { ...intervene(next, "Contacto de prueba registrado."), contactNote: action.note.trim() };
    case "consent_additional":
      if (ride.status !== "needs_attention" || ride.exceptionReason !== "additional_payment_required" || !ride.settlement ||
        action.amountCents !== ride.settlement.additionalPaymentRequiredCents || action.amountCents <= 0 || ride.additionalPaymentApprovedAt) throw new Error("No hay un importe adicional pendiente válido.");
      if (ride.additionalPaymentConsentAt) return ride;
      return { ...next, additionalPaymentConsentCents: action.amountCents, additionalPaymentConsentAt: now };
    case "approve_additional":
      if (ride.additionalPaymentOperationId) return ride;
      if (ride.status !== "needs_attention" || !ride.settlement || ride.exceptionReason !== "additional_payment_required" ||
        !ride.additionalPaymentConsentAt || ride.additionalPaymentConsentCents !== ride.settlement.additionalPaymentRequiredCents) throw new Error("El cliente debe autorizar el importe adicional exacto.");
      return { ...intervene(next, "Pago adicional de prueba consentido aprobado."), additionalPaymentApprovedAt: now,
        additionalPaymentOperationId: `${ride.id}:additional`, paymentStatus: "paid" };
    case "resolve_exception":
      if (ride.exceptionResolvedAt && ride.status !== "needs_attention") return ride;
      if (ride.status !== "needs_attention" || !ride.settlement || !ride.additionalPaymentApprovedAt) throw new Error("El problema financiero o de proveedor sigue pendiente; no puede cerrarse manualmente.");
      return { ...intervene(next, "Excepción con pago consentido resuelta."), status: "settled", progressStatus: "settled", exceptionResolvedAt: now, nextEventAt: null };
  }
}
function intervene(ride: RideRequest, reason: string): RideRequest {
  return { ...ride, operatorInterventionRequired: true, operatorInterventionReason: reason };
}
export function addRide(session: RideSession, ride: RideRequest): RideSession {
  if (session.requests.some((item) => item.id === ride.id)) throw new Error("La solicitud ya existe.");
  return { ...session, requests: [ride, ...session.requests], currentRideId: ride.id };
}
export function updateRide(session: RideSession, id: string, action: RideAction, now: string): RideSession {
  if (!session.requests.some((ride) => ride.id === id)) throw new Error("Solicitud inexistente.");
  return { ...session, requests: session.requests.map((ride) => ride.id === id ? applyRideAction(ride, action, now) : ride) };
}

function readInput(value: Record<string, unknown>): RideInput | null {
  if (typeof value.riderName !== "string" || typeof value.riderPhone !== "string" || typeof value.pickupAddress !== "string" ||
    typeof value.destinationAddress !== "string" || (value.rideTiming !== "now" && value.rideTiming !== "scheduled") ||
    !(value.scheduledAt === null || isDate(value.scheduledAt)) || typeof value.passengerCount !== "number" ||
    !isServiceType(value.serviceType) || typeof value.notes !== "string") return null;
  return { riderName: value.riderName, riderPhone: value.riderPhone, pickupAddress: value.pickupAddress,
    destinationAddress: value.destinationAddress, rideTiming: value.rideTiming, scheduledAt: value.scheduledAt,
    passengerCount: value.passengerCount, serviceType: value.serviceType, notes: value.notes };
}
function matches(value: unknown, expected: object) {
  return record(value) && Object.entries(expected).every(([key, amount]) => value[key] === amount);
}
function validPricing(value: unknown, legacy: boolean): value is RidePricing {
  if (!record(value) || typeof value.providerEstimateCents !== "number") return false;
  const expected = calculateRidePricing(value.providerEstimateCents);
  if (legacy && typeof value.temporaryReserveCents === "number") {
    assertCents(value.temporaryReserveCents, 500);
    expected.temporaryReserveCents = value.temporaryReserveCents;
    expected.authorizationTotalCents = expected.customerTotalCents + value.temporaryReserveCents;
  }
  return matches(value, expected);
}
function validArrival(value: unknown): value is RideArrival | null {
  return value === null || (record(value) && value.source === "simulation" &&
    (value.target === "pickup" || value.target === "destination") && typeof value.minutes === "number" &&
    Number.isSafeInteger(value.minutes) && value.minutes >= 0 && value.minutes <= 1440 && isDate(value.arrivesAt));
}
function validDriver(value: unknown): value is RideDriver {
  return record(value) && value.source === "simulation" &&
    ["publicName", "vehicle", "plate"].every((key) => typeof value[key] === "string" && value[key].length > 0 && value[key].length <= 160) &&
    (value.color === null || typeof value.color === "string" && value.color.length <= 80);
}
function validTracking(value: Record<string, unknown>) {
  if (!validArrival(value.estimatedArrival) || !(value.driver === null || validDriver(value.driver)) ||
    !Array.isArray(value.statusEvents) || value.statusEvents.length === 0) return false;
  const statuses = new Set<string>();
  let lastAt = Date.parse(String(value.createdAt));
  for (const [index, event] of value.statusEvents.entries()) {
    if (!record(event) || !hasKey(statusLabels, event.status) || event.label !== statusLabels[event.status] ||
      !isDate(event.occurredAt) || Date.parse(event.occurredAt) < lastAt || Date.parse(event.occurredAt) > Date.parse(String(value.updatedAt)) ||
      !["payment_simulator", "provider_simulator", "customer", "operator", "system", "migration"].includes(String(event.source)) ||
      event.sequence !== index + 1 || statuses.has(event.status)) return false;
    statuses.add(event.status); lastAt = Date.parse(event.occurredAt);
  }
  return true;
}
function validRide(value: unknown, tracking = true): value is RideRequest {
  if (!record(value)) return false;
  const input = readInput(value);
  if (!input || !isDate(value.createdAt) || !isDate(value.updatedAt) || Date.parse(value.updatedAt) < Date.parse(value.createdAt) ||
    !hasKey(statusLabels, value.status) || !hasKey(statusLabels, value.progressStatus) || !isScenario(value.scenario) || value.requestSource !== "web" ||
    !["web", "phone", "operator"].includes(String(value.requestChannel)) || !record(value.pricing) ||
    typeof value.pricing.providerEstimateCents !== "number") return false;
  try {
    if (tracking && !validTracking(value)) return false;
    validateRideInput(input, value.createdAt, false);
    text(value.id, "ID");
    if (typeof value.authorizedAmountCents !== "number") return false;
    assertCents(value.authorizedAmountCents, 200_000_000);
    if (!validPricing(value.pricing, typeof value.legacyStatus === "string")) return false;
    const strings = ["providerReference", "driverName", "vehicleDescription", "vehiclePlate", "contactNote", "cancellationPolicyVersion"];
    if (!strings.every((key) => typeof value[key] === "string")) return false;
    const dates = ["paymentStartedAt", "bookedAt", "driverAssignedAt", "completedAt", "settledAt", "nextEventAt", "finalEventDeadline",
      "cancellationPolicyAcceptedAt", "exceptionResolvedAt", "additionalPaymentConsentAt", "additionalPaymentApprovedAt"];
    if (!dates.every((key) => value[key] === null || isDate(value[key]))) return false;
    if (typeof value.operatorInterventionRequired !== "boolean" || typeof value.wasCancelled !== "boolean" ||
      typeof value.cancellationPolicyAccepted !== "boolean" || typeof value.authorizedAmountCents !== "number" ||
      !(value.operatorInterventionReason === null || typeof value.operatorInterventionReason === "string") ||
      !(value.legacyStatus === null || typeof value.legacyStatus === "string") ||
      !(value.exceptionReason === null || ["provider_unavailable", "booking_error", "final_timeout", "webhook_error", "additional_payment_required", "migration"].includes(String(value.exceptionReason)))) return false;
    for (const key of ["attempt", "paymentAttempt", "duplicateEventsIgnored", "settlementCount", "exceptionCount", "additionalPaymentConsentCents", "providerCancellationFeeCents"]) {
      if (typeof value[key] !== "number" || !Number.isSafeInteger(value[key]) || value[key] < 0) return false;
    }
    if (!Array.isArray(value.processedEventIds) || !value.processedEventIds.every((id) => typeof id === "string") ||
      !Array.isArray(value.ignoredDeliveryIds) || !value.ignoredDeliveryIds.every((id) => typeof id === "string")) return false;
    if (typeof value.attempt !== "number" || typeof value.settlementCount !== "number" ||
      typeof value.additionalPaymentConsentCents !== "number" || typeof value.providerCancellationFeeCents !== "number" ||
      value.attempt < 1 || value.settlementCount > 1 ||
      new Set(value.processedEventIds).size !== value.processedEventIds.length ||
      new Set(value.ignoredDeliveryIds).size !== value.ignoredDeliveryIds.length) return false;
    assertCents(value.additionalPaymentConsentCents);
    assertCents(value.providerCancellationFeeCents);
    if (value.cancellationPolicyAccepted ? value.cancellationPolicyVersion !== cancellationPolicyVersion || !isDate(value.cancellationPolicyAcceptedAt)
      : value.cancellationPolicyVersion !== "" || value.cancellationPolicyAcceptedAt !== null) return false;
    if (value.authorizedAmountCents > 0 && (value.authorizedAmountCents !== value.pricing.authorizationTotalCents || !value.cancellationPolicyAccepted)) return false;
    if (!["not_started", "pending", "authorized", "paid", "released", "failed", "additional_payment_required"].includes(String(value.paymentStatus))) return false;
    if (["payment_authorized", "ride_requesting", "booked", "driver_assigned", "driver_arriving", "driver_arrived", "passenger_picked_up", "in_progress", "arrived_destination", "completed"].includes(value.status) &&
      (value.authorizedAmountCents === 0 || value.paymentStatus !== "authorized")) return false;
    if (value.status === "needs_attention" && !value.exceptionReason) return false;
    if (["payment_pending", "payment_authorized", "ride_requesting", "booked", "driver_assigned", "driver_arriving",
      "driver_arrived", "passenger_picked_up", "in_progress", "arrived_destination", "completed"].includes(value.status) && !isDate(value.nextEventAt)) return false;
    if (value.status === "payment_pending" && (value.paymentStatus !== "pending" || !value.cancellationPolicyAccepted)) return false;
    if (value.status === "completed" && (!isDate(value.completedAt) || !isDate(value.finalEventDeadline))) return false;
    if (!(value.additionalPaymentOperationId === null || typeof value.additionalPaymentOperationId === "string")) return false;
    if (value.settlement === null) {
      if (value.settlementOperationId !== null || value.settlementCount !== 0 || value.actualProviderCostCents !== null || value.settledAt !== null ||
        ["settled", "cancelled"].includes(value.status)) return false;
    } else {
      if (typeof value.actualProviderCostCents !== "number" || typeof value.providerCancellationFeeCents !== "number" ||
        typeof value.settlementOperationId !== "string" || value.settlementCount !== 1 || !isDate(value.settledAt)) return false;
      const expected = settleRideAutomatically({
        authorizedAmountCents: value.authorizedAmountCents, providerFinalCostCents: value.actualProviderCostCents,
        coordinationFeeCents: value.wasCancelled ? 0 : Number(value.pricing.coordinationFeeCents),
        cancellationFeeCents: value.wasCancelled ? Math.min(value.providerCancellationFeeCents, value.authorizedAmountCents) : 0,
      });
      if (!matches(value.settlement, expected)) return false;
      if (value.additionalPaymentApprovedAt && (!value.additionalPaymentConsentAt || value.additionalPaymentConsentCents !== expected.additionalPaymentRequiredCents ||
        !value.additionalPaymentOperationId)) return false;
      if (value.status === "settled" && expected.settlementStatus !== "settled" && !value.additionalPaymentApprovedAt) return false;
    }
    return true;
  } catch { return false; }
}

function migrateRide(value: Record<string, unknown>, version: number): RideRequest | null {
  const input = readInput(value);
  const oldStatuses = ["requested", "reviewing", "quoted", "customer_approved", "quote_created", "payment_pending",
    "payment_authorized", "ready_to_book", "booked", "driver_assigned", "arriving", "picked_up", "in_progress", "completed",
    "reconciling", "reconciled", "cancelled", "payment_failed"];
  if (!input || typeof value.id !== "string" || !isDate(value.createdAt) || !isDate(value.updatedAt) ||
    typeof value.status !== "string" || !oldStatuses.includes(value.status)) return null;
  // Restore past scheduled dates without treating an already-created request as a new reservation.
  validateRideInput(input, value.createdAt, false);
  const estimate = record(value.pricing) ? value.pricing.providerEstimateCents : value.estimatedProviderCostCents;
  const ride = createRide({ ...input, rideTiming: "now", scheduledAt: null }, value.id, value.createdAt,
    typeof estimate === "number" ? estimate : 2500);
  ride.rideTiming = input.rideTiming; ride.scheduledAt = input.scheduledAt; ride.updatedAt = value.updatedAt; ride.legacyStatus = value.status;
  const legacyProgress: Record<string, RideStatus> = {
    payment_authorized: "payment_authorized", ready_to_book: "payment_authorized", booked: "booked",
    driver_assigned: "driver_assigned", arriving: "driver_arriving", picked_up: "passenger_picked_up",
    in_progress: "in_progress", completed: "completed", reconciling: "completed", reconciled: "settled",
  };
  ride.progressStatus = legacyProgress[value.status] ?? "quote_created";
  if (version === 2 && validPricing(value.pricing, true)) ride.pricing = value.pricing;
  ride.operatorInterventionRequired = true; ride.operatorInterventionReason = `Migrado de demo v${version}.`;
  ride.requestChannel = value.requestChannel === "phone" || value.requestChannel === "operator" ? value.requestChannel : "web";
  for (const key of ["providerReference", "driverName", "vehicleDescription", "vehiclePlate"] as const) {
    if (typeof value[key] === "string") ride[key] = value[key];
  }
  const paid = version === 2 && value.cancellationPolicyAccepted === true && value.cancellationPolicyVersion === cancellationPolicyVersion &&
    isDate(value.cancellationPolicyAcceptedAt) && ["authorized", "paid", "released", "additional_payment_required"].includes(String(value.paymentStatus)) &&
    value.authorizedAmountCents === ride.pricing.authorizationTotalCents;
  if (paid) {
    ride.authorizedAmountCents = ride.pricing.authorizationTotalCents; ride.paymentStatus = "authorized";
    ride.cancellationPolicyAccepted = true; ride.cancellationPolicyAcceptedAt = String(value.cancellationPolicyAcceptedAt);
    ride.cancellationPolicyVersion = cancellationPolicyVersion;
  }
  if (value.status === "cancelled") {
    const fee = paid && typeof value.providerCancellationFeeCents === "number" ? value.providerCancellationFeeCents : 0;
    return finish(ride, 0, fee, value.updatedAt, true);
  }
  if (paid && record(value.settlement) && typeof value.actualProviderCostCents === "number") {
    ride.completedAt = isDate(value.completedAt) ? value.completedAt : value.updatedAt;
    const closed = finish(ride, value.actualProviderCostCents, 0, value.updatedAt, false);
    if (!closed.settlement || !Object.entries(closed.settlement).filter(([key]) => key !== "settlementStatus")
      .every(([key, amount]) => record(value.settlement) && value.settlement[key] === amount)) throw new Error("Contabilidad histórica incompatible.");
    return closed;
  }
  if (["requested", "reviewing", "quoted", "customer_approved", "quote_created", "payment_pending", "payment_failed"].includes(value.status)) {
    // Legacy approval/payment-in-progress is not new consent for a changed automatic flow.
    return { ...ride, authorizedAmountCents: 0, paymentStatus: "not_started", cancellationPolicyAccepted: false,
      cancellationPolicyAcceptedAt: null, cancellationPolicyVersion: "" };
  }
  if (isDate(value.completedAt) || value.status === "completed" || value.status === "reconciling") ride.completedAt = isDate(value.completedAt) ? value.completedAt : value.updatedAt;
  return requireAttention(ride, "migration", value.updatedAt);
}
function migrateTracking(ride: RideRequest): RideRequest {
  const known: Array<[RideStatus, string | null]> = [
    ["quote_created", ride.createdAt], ["payment_pending", ride.paymentStartedAt], ["booked", ride.bookedAt],
    ["driver_assigned", ride.driverAssignedAt], ["completed", ride.completedAt],
    [ride.wasCancelled ? "cancelled" : "settled", ["settled", "cancelled"].includes(ride.status) ? ride.settledAt : null],
  ];
  const statusEvents: RideStatusEvent[] = known.filter((entry): entry is [RideStatus, string] => isDate(entry[1]))
    .sort((a, b) => Date.parse(a[1]) - Date.parse(b[1]))
    .map(([status, occurredAt], index) => ({ status, occurredAt, label: statusLabels[status], sequence: index + 1, source: "migration" }));
  return { ...ride, statusEvents, estimatedArrival: null, driver: ride.driverName ? {
    publicName: ride.driverName, vehicle: ride.vehicleDescription || "Vehículo demo",
    color: null, plate: ride.vehiclePlate || "Sin placa registrada", source: "simulation",
  } : null };
}
export function decodeRideSession(raw: string | null): RideSession {
  if (raw === null) return emptyRideSession;
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return { ...emptyRideSession, notices: ["Se descartaron datos JSON inválidos del demo."] }; }
  if (!record(value) || ![1, 2, 3, 4].includes(Number(value.version)) || typeof value.version !== "number" || !Array.isArray(value.requests)) {
    return { ...emptyRideSession, notices: ["Esquema inválido: se recuperó una sesión demo vacía."] };
  }
  const requests: RideRequest[] = [];
  const notices = Array.isArray(value.notices) ? value.notices.filter((notice): notice is string => typeof notice === "string") : [];
  if (value.version !== 4) notices.push("Demo migrado a v4. Se conservaron los importes y las horas conocidas; las etapas históricas sin hora no se reconstruyen. Los viajes que no pueden reanudarse con seguridad requieren atención.");
  for (const item of value.requests) {
    let ride: RideRequest | null = null;
    try {
      if (value.version === 4 && validRide(item)) ride = item;
      else if (value.version === 3 && validRide(item, false)) ride = migrateTracking(item);
      else if (value.version < 3 && record(item)) {
        const migrated = migrateRide(item, value.version);
        if (migrated) ride = migrateTracking(migrated);
      }
    } catch { notices.push("Se descartó una solicitud antigua inválida."); }
    if (ride && validRide(ride) && !requests.some((existing) => existing.id === ride.id)) requests.push(ride);
    else notices.push("Se descartó una solicitud inválida o duplicada; se conservaron las demás.");
  }
  return { version: 4, requests, currentRideId: typeof value.currentRideId === "string" && requests.some((ride) => ride.id === value.currentRideId)
    ? value.currentRideId : requests[0]?.id ?? null, notices: [...new Set(notices)] };
}
