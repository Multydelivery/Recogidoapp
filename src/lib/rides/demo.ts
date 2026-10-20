export type RideStatus =
  | "requested"
  | "reviewing"
  | "quoted"
  | "customer_approved"
  | "booked"
  | "driver_assigned"
  | "arriving"
  | "picked_up"
  | "completed"
  | "cancelled";

export type RideRequest = {
  id: string;
  riderName: string;
  riderPhone: string;
  pickupAddress: string;
  destinationAddress: string;
  rideTiming: "now" | "scheduled";
  scheduledAt: string | null;
  passengerCount: number;
  serviceType:
    | "on_demand"
    | "scheduled"
    | "medical"
    | "senior_assistance"
    | "business"
    | "other";
  requestSource: "web";
  notes: string;
  status: RideStatus;
  estimatedProviderCostCents: number | null;
  customerPriceCents: number | null;
  estimatedMarginCents: number | null;
  providerReference: string;
  driverName: string;
  vehicleDescription: string;
  vehiclePlate: string;
  createdAt: string;
  updatedAt: string;
};

export type RideInput = Pick<RideRequest,
  "riderName" | "riderPhone" | "pickupAddress" | "destinationAddress" |
  "rideTiming" | "scheduledAt" | "passengerCount" | "serviceType" | "notes"
>;

export const demoNotice = "Modo de demostración — No se solicitará ningún viaje real ni se procesará ningún pago.";
export const rideStorageKey = "recogido.rides.demo.v1";
export const statusLabels: Record<RideStatus, string> = {
  requested: "Solicitud recibida",
  reviewing: "En revisión",
  quoted: "Cotización disponible",
  customer_approved: "Aprobado por el cliente",
  booked: "Reserva simulada",
  driver_assigned: "Conductor asignado",
  arriving: "Conductor en camino",
  picked_up: "Pasajero a bordo",
  completed: "Viaje completado",
  cancelled: "Solicitud cancelada",
};
export const serviceLabels: Record<RideRequest["serviceType"], string> = {
  on_demand: "Bajo demanda",
  scheduled: "Programado",
  medical: "Cita médica",
  senior_assistance: "Asistencia a adultos mayores",
  business: "Empresarial",
  other: "Otro",
};
export const rideSteps = Object.keys(statusLabels).filter((status) => status !== "cancelled") as Exclude<RideStatus, "cancelled">[];

export function isServiceType(value: unknown): value is RideRequest["serviceType"] {
  return hasKey(serviceLabels, value);
}

export type RideSession = {
  version: 1;
  requests: RideRequest[];
  currentRideId: string | null;
};
export const emptyRideSession: RideSession = { version: 1, requests: [], currentRideId: null };

export type RideAction =
  | { type: "review" }
  | { type: "quote"; providerCostCents: number; customerPriceCents: number }
  | { type: "approve" }
  | { type: "book"; providerReference: string }
  | { type: "assign"; driverName: string; vehicleDescription: string; vehiclePlate: string }
  | { type: "advance" }
  | { type: "cancel" };

function hasKey<T extends object>(object: T, key: unknown): key is keyof T {
  return typeof key === "string" && Object.hasOwn(object, key);
}

function text(value: unknown, label: string, max = 160): asserts value is string {
  if (typeof value !== "string" || !value.trim() || value.length > max) {
    throw new Error(`${label}: completa el campo (máximo ${max} caracteres).`);
  }
}

function isDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isCents(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000;
}

export function formatCents(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new Error("El importe debe ser un entero seguro en centavos.");
  return new Intl.NumberFormat("es-US", { style: "currency", currency: "USD" }).format(cents / 100);
}

export function money(cents: number | null) {
  return cents === null ? "Por definir" : formatCents(cents);
}

export function parseDollarInput(value: string): number | null {
  const normalized = value.trim().replace(/^\$\s*/, "");
  if (!/^\d{1,7}([.,]\d{1,2})?$/.test(normalized)) return null;
  const [whole, fraction = ""] = normalized.replace(",", ".").split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  return isCents(cents) ? cents : null;
}

export function parseMoney(value: string): number {
  const cents = parseDollarInput(value);
  if (cents === null) throw new Error("Ingresa un importe válido en USD, con hasta dos decimales y un máximo de $1,000,000.00.");
  return cents;
}

export function validateRideInput(input: RideInput, now: string, creating = true) {
  text(input.riderName, "Nombre", 100);
  text(input.riderPhone, "Teléfono", 30);
  if (!/^[+\d\s().-]+$/.test(input.riderPhone) || !/^\d{7,15}$/.test(input.riderPhone.replace(/\D/g, ""))) {
    throw new Error("Ingresa un teléfono ficticio de 7 a 15 dígitos.");
  }
  text(input.pickupAddress, "Dirección de recogida");
  text(input.destinationAddress, "Destino");
  if (input.pickupAddress.trim().toLowerCase() === input.destinationAddress.trim().toLowerCase()) {
    throw new Error("La recogida y el destino deben ser diferentes.");
  }
  if (input.rideTiming !== "now" && input.rideTiming !== "scheduled") throw new Error("Selecciona cuándo viajar.");
  if (input.rideTiming === "scheduled") {
    if (!isDate(input.scheduledAt) || (creating && Date.parse(input.scheduledAt) <= Date.parse(now))) {
      throw new Error("Selecciona una fecha y hora futura para el viaje.");
    }
  } else if (input.scheduledAt !== null) {
    throw new Error("Un viaje inmediato no debe tener fecha programada.");
  }
  if (!Number.isInteger(input.passengerCount) || input.passengerCount < 1 || input.passengerCount > 8) {
    throw new Error("El demo admite entre 1 y 8 pasajeros.");
  }
  if (!hasKey(serviceLabels, input.serviceType)) throw new Error("Selecciona un tipo de servicio válido.");
  if (typeof input.notes !== "string" || input.notes.length > 1000) throw new Error("Las notas admiten hasta 1000 caracteres.");
}

export function createRide(input: RideInput, id: string, now: string): RideRequest {
  if (!isDate(now)) throw new Error("Fecha de creación inválida.");
  text(id, "Identificador");
  validateRideInput(input, now);
  return {
    ...input,
    riderName: input.riderName.trim(),
    riderPhone: input.riderPhone.trim(),
    pickupAddress: input.pickupAddress.trim(),
    destinationAddress: input.destinationAddress.trim(),
    notes: input.notes.trim(),
    id, requestSource: "web", status: "requested",
    estimatedProviderCostCents: null, customerPriceCents: null, estimatedMarginCents: null,
    providerReference: "", driverName: "", vehicleDescription: "", vehiclePlate: "",
    createdAt: now, updatedAt: now,
  };
}

export function canCancel(ride: RideRequest) {
  return !["picked_up", "completed", "cancelled"].includes(ride.status);
}

export function applyRideAction(ride: RideRequest, action: RideAction, now: string): RideRequest {
  if (!isDate(now) || Date.parse(now) < Date.parse(ride.updatedAt)) throw new Error("Fecha de actualización inválida.");
  const next = { ...ride, updatedAt: now };
  switch (action.type) {
    case "review":
      if (ride.status !== "requested") throw new Error("Solo se pueden revisar solicitudes nuevas.");
      next.status = "reviewing";
      break;
    case "quote":
      if (!["reviewing", "quoted"].includes(ride.status)) throw new Error("Revisa la solicitud antes de cotizar.");
      if (!isCents(action.providerCostCents) || !isCents(action.customerPriceCents) || action.customerPriceCents === 0) {
        throw new Error("La cotización requiere un costo no negativo y un precio al cliente mayor que cero.");
      }
      next.estimatedProviderCostCents = action.providerCostCents;
      next.customerPriceCents = action.customerPriceCents;
      next.estimatedMarginCents = action.customerPriceCents - action.providerCostCents;
      next.status = "quoted";
      break;
    case "approve":
      if (ride.status !== "quoted" || ride.customerPriceCents === null) throw new Error("No hay cotización pendiente de aprobación.");
      next.status = "customer_approved";
      break;
    case "book":
      if (ride.status !== "customer_approved") throw new Error("El cliente debe aprobar el precio antes de reservar.");
      text(action.providerReference, "Referencia simulada", 100);
      next.providerReference = action.providerReference.trim();
      next.status = "booked";
      break;
    case "assign":
      if (ride.status !== "booked") throw new Error("Primero crea la reserva simulada.");
      text(action.driverName, "Conductor", 100);
      text(action.vehicleDescription, "Vehículo");
      text(action.vehiclePlate, "Placa", 30);
      next.driverName = action.driverName.trim();
      next.vehicleDescription = action.vehicleDescription.trim();
      next.vehiclePlate = action.vehiclePlate.trim();
      next.status = "driver_assigned";
      break;
    case "advance":
      if (ride.status === "driver_assigned") next.status = "arriving";
      else if (ride.status === "arriving") next.status = "picked_up";
      else if (ride.status === "picked_up") next.status = "completed";
      else throw new Error("Este viaje no puede avanzar desde su estado actual.");
      break;
    case "cancel":
      if (!canCancel(ride)) throw new Error("Este viaje ya no se puede cancelar.");
      next.status = "cancelled";
      break;
  }
  return next;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRide(value: unknown): value is RideRequest {
  if (!record(value)) return false;
  const fields = ["id", "riderName", "riderPhone", "pickupAddress", "destinationAddress", "notes",
    "providerReference", "driverName", "vehicleDescription", "vehiclePlate"] as const;
  if (!fields.every((field) => typeof value[field] === "string")) return false;
  if (!hasKey(statusLabels, value.status) || !hasKey(serviceLabels, value.serviceType) ||
    (value.rideTiming !== "now" && value.rideTiming !== "scheduled") ||
    typeof value.passengerCount !== "number" || value.requestSource !== "web" ||
    !isDate(value.createdAt) || !isDate(value.updatedAt) || Date.parse(value.updatedAt) < Date.parse(value.createdAt)) return false;
  try {
    validateRideInput({
      riderName: String(value.riderName), riderPhone: String(value.riderPhone),
      pickupAddress: String(value.pickupAddress), destinationAddress: String(value.destinationAddress),
      notes: String(value.notes), rideTiming: value.rideTiming,
      scheduledAt: typeof value.scheduledAt === "string" ? value.scheduledAt : null,
      passengerCount: value.passengerCount, serviceType: value.serviceType,
    }, value.createdAt, false);
    text(value.id, "Identificador");
  } catch {
    return false;
  }
  if (value.rideTiming === "now" ? value.scheduledAt !== null : !isDate(value.scheduledAt)) return false;
  const unquoted = value.estimatedProviderCostCents === null && value.customerPriceCents === null && value.estimatedMarginCents === null;
  const quoted = isCents(value.estimatedProviderCostCents) && isCents(value.customerPriceCents) &&
    value.customerPriceCents > 0 && value.estimatedMarginCents === value.customerPriceCents - value.estimatedProviderCostCents;
  if (!unquoted && !quoted) return false;
  if (!["requested", "reviewing", "cancelled"].includes(value.status) && !quoted) return false;
  if (["booked", "driver_assigned", "arriving", "picked_up", "completed"].includes(value.status) && !String(value.providerReference).trim()) return false;
  if (["driver_assigned", "arriving", "picked_up", "completed"].includes(value.status) &&
    ![value.driverName, value.vehicleDescription, value.vehiclePlate].every((field) => String(field).trim())) return false;
  return true;
}

export function decodeRideSession(raw: string | null): RideSession {
  if (raw === null) return emptyRideSession;
  const value: unknown = JSON.parse(raw);
  if (!record(value) || value.version !== 1 || !Array.isArray(value.requests) || !value.requests.every(isRide) ||
    !(value.currentRideId === null || typeof value.currentRideId === "string") ||
    new Set(value.requests.map((ride) => ride.id)).size !== value.requests.length ||
    (value.currentRideId !== null && !value.requests.some((ride) => ride.id === value.currentRideId))) {
    throw new Error("Los datos guardados del demo no son válidos.");
  }
  return { version: 1, requests: value.requests, currentRideId: value.currentRideId };
}

export function addRide(session: RideSession, ride: RideRequest): RideSession {
  if (session.requests.some((item) => item.id === ride.id)) throw new Error("Esta solicitud ya existe.");
  return { ...session, requests: [ride, ...session.requests], currentRideId: ride.id };
}

export function updateRide(session: RideSession, id: string, action: RideAction, now: string): RideSession {
  const ride = session.requests.find((item) => item.id === id);
  if (!ride) throw new Error("La solicitud ya no está disponible.");
  const updated = applyRideAction(ride, action, now);
  return { ...session, requests: session.requests.map((item) => item.id === id ? updated : item) };
}
