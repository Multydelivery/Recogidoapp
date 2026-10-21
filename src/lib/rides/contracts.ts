import type { RideRequest } from "./demo";
import type { AutomaticSettlement } from "./pricing";
import type { RideArrival, RideDriver } from "./progress";

export type RideEventType = "payment_authorized" | "payment_failed" | "ride_requesting" | "booked" |
  "driver_assigned" | "driver_arriving" | "driver_arrived" | "passenger_picked_up" | "in_progress" | "arrived_destination" | "completed" |
  "provider_final" | "provider_cancelled" | "provider_unavailable" | "booking_error" | "webhook_error";

export type RideEvent = {
  id: string;
  deliveryId: string;
  rideId: string;
  attempt: number;
  type: RideEventType;
  at: string;
  providerFinalCostCents?: number;
  cancellationFeeCents?: number;
  estimatedArrival?: RideArrival | null;
  driver?: RideDriver;
};

export interface PaymentGateway {
  authorize(ride: RideRequest, at: string): RideEvent;
  settle(input: Parameters<typeof import("./pricing").settleRideAutomatically>[0], operationId: string): {
    operationId: string; result: AutomaticSettlement;
  };
}

export interface RideProvider {
  estimate(): number;
  nextEvent(ride: RideRequest, at: string): RideEvent | null;
}

export interface RideEventProcessor {
  process(ride: RideRequest, event: RideEvent): RideRequest;
}
