import type { PaymentGateway, RideEvent } from "./contracts";
import { settleRideAutomatically } from "./pricing";

export const demoPaymentGateway: PaymentGateway = {
  authorize(ride, at): RideEvent {
    const type = ride.scenario === "payment_declined" && ride.paymentAttempt === 1 ? "payment_failed" : "payment_authorized";
    const id = `${ride.id}:${ride.attempt}:${type}:${ride.paymentAttempt}`;
    return { id, deliveryId: `${id}:delivery`, rideId: ride.id, attempt: ride.attempt, type, at };
  },
  settle(input, operationId) {
    return { operationId, result: settleRideAutomatically(input) };
  },
};
