import { EVENT_DELAY_MS, requireAttention, rideEventProcessor, type RideRequest, type RideSession, type RideStatus } from "./demo";
import type { RideEvent, RideEventType, RideProvider } from "./contracts";
import { demoPaymentGateway } from "./paymentSimulator";
export { demoPaymentGateway } from "./paymentSimulator";

function event(ride: RideRequest, type: RideEventType, at: string): RideEvent {
  const id = `${ride.id}:${ride.attempt}:${type}:${type.startsWith("payment_") ? ride.paymentAttempt : 0}`;
  return { id, deliveryId: `${id}:delivery`, rideId: ride.id, attempt: ride.attempt, type, at };
}
export const demoRideProvider: RideProvider = {
  estimate() { return 2500; },
  nextEvent(ride, at) {
    if (ride.status === "ride_requesting" && ride.attempt === 1) {
      if (ride.scenario === "no_driver") return event(ride, "provider_unavailable", at);
      if (ride.scenario === "booking_error") return event(ride, "booking_error", at);
    }
    if (ride.status === "driver_assigned") {
      if (ride.scenario === "free_cancellation" || ride.scenario === "charged_cancellation") {
        return { ...event(ride, "provider_cancelled", at), cancellationFeeCents: ride.scenario === "charged_cancellation" ? 500 : 0 };
      }
      if (ride.scenario === "webhook_error") return event(ride, "webhook_error", at);
    }
    if (ride.status === "completed") {
      if (ride.scenario === "missing_final") return null;
      const estimate = ride.pricing.providerEstimateCents;
      const cost = ride.scenario === "lower_final" ? Math.max(0, estimate - 500)
        : ride.scenario === "higher_within" ? estimate + ride.pricing.temporaryReserveCents
          : ride.scenario === "over_authorization" ? estimate + ride.pricing.temporaryReserveCents + 750 : estimate;
      return { ...event(ride, "provider_final", at), providerFinalCostCents: cost };
    }
    const transitions: Partial<Record<RideStatus, RideEventType>> = {
      payment_authorized: "ride_requesting", ride_requesting: "booked", booked: "driver_assigned",
      driver_assigned: "driver_arriving", driver_arriving: "driver_arrived", driver_arrived: "passenger_picked_up",
      passenger_picked_up: "in_progress", in_progress: "arrived_destination", arrived_destination: "completed",
    };
    const type = transitions[ride.status];
    if (!type) return null;
    const delivery = event(ride, type, at);
    if (["driver_assigned", "driver_arriving", "passenger_picked_up", "in_progress"].includes(type)) {
      const target = type === "driver_assigned" || type === "driver_arriving" ? "pickup" : "destination";
      const minutes = type === "driver_assigned" ? 6 : type === "driver_arriving" ? 3 : type === "passenger_picked_up" ? 12 : 8;
      delivery.estimatedArrival = { target, minutes, arrivesAt: new Date(Date.parse(at) + minutes * 60_000).toISOString(), source: "simulation" };
    } else if (["driver_arrived", "arrived_destination", "completed"].includes(type)) delivery.estimatedArrival = null;
    if (type === "driver_assigned") delivery.driver = {
      publicName: "Conductor Demo", vehicle: "Sedán de demostración", color: "Azul (simulado)", plate: "DEMO-001", source: "simulation",
    };
    return delivery;
  },
};

export function advanceDemoRide(ride: RideRequest, now: string): RideRequest {
  let next = ride;
  // Replay overdue simulated deliveries after navigation/reload with their persisted due times.
  for (let step = 0; step < 20 && next.nextEventAt && Date.parse(next.nextEventAt) <= Date.parse(now); step++) {
    const due = next.nextEventAt;
    if (next.status === "completed" && next.finalEventDeadline && Date.parse(due) >= Date.parse(next.finalEventDeadline)) {
      next = requireAttention(next, "final_timeout", due);
      break;
    }
    const delivery = next.status === "payment_pending" ? demoPaymentGateway.authorize(next, due) : demoRideProvider.nextEvent(next, due);
    if (!delivery) {
      next = { ...next, nextEventAt: next.status === "completed" ? next.finalEventDeadline : null };
      continue;
    }
    next = rideEventProcessor.process(next, delivery);
    if (next.scenario === "duplicate" && delivery.type === "provider_final") {
      next = rideEventProcessor.process(next, { ...delivery, deliveryId: `${delivery.id}:redelivery` });
    }
  }
  return next;
}
export function advanceDemoSession(session: RideSession, now: string): RideSession {
  const requests = session.requests.map((ride) => advanceDemoRide(ride, now));
  return requests.some((ride, index) => ride !== session.requests[index]) ? { ...session, requests } : session;
}
export const demoTickIntervalMs = Math.min(500, EVENT_DELAY_MS);
