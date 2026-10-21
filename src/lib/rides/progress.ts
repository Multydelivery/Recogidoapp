import type { RideRequest, RideStatus } from "./demo";

export type RideStatusEvent = {
  status: RideStatus;
  label: string;
  occurredAt: string;
  source: "payment_simulator" | "provider_simulator" | "customer" | "operator" | "system" | "migration";
  sequence: number;
};
export type RideArrival = {
  target: "pickup" | "destination";
  minutes: number;
  arrivesAt: string;
  source: "simulation";
};
export type RideDriver = {
  publicName: string;
  vehicle: string;
  color: string | null;
  plate: string;
  source: "simulation";
};

export const rideTimelineDefinition: ReadonlyArray<{
  status: RideStatus; statuses: readonly RideStatus[]; label: string; heading: string; description: string;
}> = [
  { status: "payment_authorized", statuses: ["payment_authorized"], label: "Solicitud confirmada",
    heading: "Tu solicitud está confirmada", description: "El pago de prueba fue autorizado. Prepararemos la solicitud al proveedor simulado." },
  { status: "ride_requesting", statuses: ["ride_requesting", "booked"], label: "Buscando conductor",
    heading: "Estamos buscando un conductor", description: "La solicitud está en curso. Aquí verás la asignación cuando el simulador la confirme." },
  { status: "driver_assigned", statuses: ["driver_assigned"], label: "Conductor asignado",
    heading: "Tu conductor fue asignado", description: "Puedes consultar los datos públicos ficticios del vehículo antes de la recogida." },
  { status: "driver_arriving", statuses: ["driver_arriving"], label: "Conductor en camino",
    heading: "Tu conductor va en camino", description: "Prepárate en el punto de recogida. El tiempo indicado es solo de demostración." },
  { status: "driver_arrived", statuses: ["driver_arrived"], label: "El conductor llegó",
    heading: "Tu conductor llegó", description: "En un viaje real, verifica el vehículo y la placa antes de subir. Aquí todos los datos son simulados." },
  { status: "passenger_picked_up", statuses: ["passenger_picked_up"], label: "Pasajero recogido",
    heading: "Ya estás en camino", description: "La recogida fue registrada por el proveedor simulado." },
  { status: "in_progress", statuses: ["in_progress"], label: "En camino al destino",
    heading: "Viajando hacia tu destino", description: "Sigue el avance aquí. No estamos mostrando una ubicación real." },
  { status: "arrived_destination", statuses: ["arrived_destination"], label: "Llegada al destino",
    heading: "Llegaste a tu destino", description: "El simulador registró la llegada. Estamos preparando el cierre del viaje." },
  { status: "completed", statuses: ["completed", "settled"], label: "Viaje completado",
    heading: "Viaje completado", description: "El recorrido terminó. El recibo de prueba aparecerá al finalizar el pago automáticamente." },
];
export const exceptionPresentation = {
  cancelled: { label: "El viaje fue cancelado", description: "Esta solicitud terminó. Consulta el detalle de cualquier cargo simulado y del saldo liberado." },
  payment_failed: { label: "No pudimos autorizar el pago", description: "No se solicitó un viaje. Puedes reintentar el pago de prueba con la política aceptada." },
  needs_attention: { label: "Necesitamos revisar tu solicitud", description: "Una etapa necesita revisión. No se hará un pago adicional sin tu autorización expresa." },
};
export function isRideException(status: RideStatus): status is keyof typeof exceptionPresentation {
  return Object.hasOwn(exceptionPresentation, status);
}
export const publicStatusLabels: Record<RideStatus, string> = {
  quote_created: "Cotización disponible", payment_pending: "Pago de prueba en proceso",
  ...Object.fromEntries(rideTimelineDefinition.flatMap((step) => step.statuses.map((status) => [status, step.label]))),
  cancelled: exceptionPresentation.cancelled.label, needs_attention: exceptionPresentation.needs_attention.label,
  payment_failed: exceptionPresentation.payment_failed.label,
} as Record<RideStatus, string>;

export function ridePresentation(status: RideStatus) {
  if (isRideException(status)) return { heading: exceptionPresentation[status].label, description: exceptionPresentation[status].description };
  const step = rideTimelineDefinition.find((item) => item.statuses.includes(status));
  return step ?? { heading: publicStatusLabels[status], description: "Acepta el precio y la política para comenzar este viaje de prueba." };
}
export function publicRideNumber(id: string) { return `DEMO-${id.slice(-8).toUpperCase()}`; }
export function arrivalText(arrival: RideArrival | null) {
  if (!arrival) return "Calculando tiempo estimado…";
  return `${arrival.target === "pickup" ? "Conductor" : "Destino"} a ${arrival.minutes} min · Simulado`;
}
export function rideTime(value: string) {
  return new Intl.DateTimeFormat("es-US", { hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true }).format(new Date(value));
}
export function getRideTimeline(status: RideStatus, events: RideStatusEvent[], progressStatus = status) {
  const current = rideTimelineDefinition.findIndex((step) => step.statuses.includes(progressStatus));
  const interrupted = isRideException(status);
  const finished = status === "completed" || status === "settled";
  return rideTimelineDefinition.map((step, index) => {
    const event = events.find((event) => step.statuses.includes(event.status));
    const phase = index < current || (interrupted && index === current) || (finished && index === current) ? "completed"
      : index === current && !interrupted ? "current" : "pending";
    return { ...step, phase, occurredAt: event?.occurredAt ?? null, current: index === current && !interrupted };
  });
}
export function recordRideStatus(ride: RideRequest, source: RideStatusEvent["source"]): RideRequest {
  if (ride.statusEvents.some((event) => event.status === ride.status)) return ride;
  return { ...ride, statusEvents: [...ride.statusEvents, {
    status: ride.status, label: publicStatusLabels[ride.status], occurredAt: ride.updatedAt, source, sequence: ride.statusEvents.length + 1,
  }] };
}
