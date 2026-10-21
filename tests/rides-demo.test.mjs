import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, readdirSync } from "node:fs";
import { registerHooks } from "node:module";
import {
  addRide, applyRideAction, cancellationPolicyText, cancellationPolicyVersion, canCancel, createRide, decodeRideSession,
  demoNotice, emptyRideSession, formatCents, hasAuthorizedPayment, parseDollarInput, parseMoney, rideEventProcessor,
  rideSteps, updateRide, EVENT_DELAY_MS, FINAL_EVENT_TIMEOUT_MS,
} from "../src/lib/rides/demo.ts";
import { calculateRidePricing, estimateProcessingFee, settleRideAutomatically } from "../src/lib/rides/pricing.ts";
import { advanceDemoRide, advanceDemoSession, demoPaymentGateway, demoRideProvider } from "../src/lib/rides/simulator.ts";
import { calculateRideMetrics } from "../src/lib/rides/metrics.ts";
import { arrivalText, getRideTimeline, publicRideNumber, publicStatusLabels, ridePresentation, rideTimelineDefinition } from "../src/lib/rides/progress.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/navigation") return {
      url: "data:text/javascript,export function useRouter(){return{push(){throw new Error('Unexpected navigation during server render')}}}",
      shortCircuit: true,
    };
    return nextResolve(specifier, context);
  },
});
const { RideDispatcherDemo, RideRequestDemo, RideStatusDemo } = await import("../src/components/rides/RideDemo.tsx");
const { PricingBreakdown, PaymentDemo, RideReceipt } = await import("../src/components/rides/RideEconomics.tsx");
const { RideProgressTimeline, RideExceptionCard, RideDriverCard, RideMapPlaceholder, RideProgressSummary } = await import("../src/components/rides/RideProgressTimeline.tsx");
const now = "2026-10-20T16:00:00.000Z";
const at = (ms) => new Date(Date.parse(now) + ms).toISOString();
const input = {
  riderName: "Cliente Demo", riderPhone: "2015550100", pickupAddress: "100 Calle Demo",
  destinationAddress: "200 Avenida Simulada", rideTiming: "now", scheduledAt: null,
  passengerCount: 2, serviceType: "on_demand", notes: "",
};
const fresh = (scenario = "normal", id = "RIDE-DEMO-TEST") => createRide({ ...input, scenario }, id, now);
const act = (ride, action, time = ride.updatedAt) => applyRideAction(ride, action, time);
const pending = (scenario = "normal") => act(act(fresh(scenario), { type: "accept_policy", accepted: true }), { type: "start_payment" });
const finished = (scenario = "normal") => advanceDemoRide(pending(scenario), at(60000));
function roundtrip(ride) {
  const session = addRide(emptyRideSession, ride);
  assert.deepEqual(decodeRideSession(JSON.stringify(session)), session);
  return ride;
}
function event(ride, type, extra = {}) {
  return { id: `event-${type}`, deliveryId: `delivery-${type}`, rideId: ride.id, attempt: ride.attempt, at: ride.updatedAt, type, ...extra };
}

test("seven required pilot prices and exact half-up cent rounding", () => {
  for (const [cost, fee] of [[1000, 300], [1500, 350], [2000, 400], [2500, 450], [3000, 500], [4000, 500], [10000, 500]]) {
    assert.equal(calculateRidePricing(cost).coordinationFeeCents, fee);
  }
  assert.equal(calculateRidePricing(5).coordinationFeeCents, 201);
  for (let cents = 0; cents < 12000; cents++) {
    const p = calculateRidePricing(cents);
    assert.ok(Object.values(p).every(Number.isSafeInteger));
    assert.ok(p.coordinationFeeCents <= 500 && p.temporaryReserveCents <= 500);
    assert.equal(p.customerTotalCents, cents + p.coordinationFeeCents);
    assert.equal(p.authorizationTotalCents, p.customerTotalCents + p.temporaryReserveCents);
  }
  assert.equal(calculateRidePricing(100000000).temporaryReserveCents, 500);
  assert.equal(calculateRidePricing(2500, 500).temporaryReserveCents, 125);
  assert.equal(estimateProcessingFee(2950), 116);
  for (const cents of [-1, 1.5, NaN, Infinity, 100000001]) assert.throws(() => calculateRidePricing(cents));
});
test("natural dollars parse without floating-point monetary math", () => {
  for (const [value, cents] of [["18.50", 1850], ["$18.50", 1850], ["21", 2100], ["21.00", 2100], ["0.29", 29], ["18,50", 1850]]) {
    assert.equal(parseDollarInput(value), cents); assert.equal(parseMoney(value), cents);
  }
  for (const value of ["", "$", "-1", "1e2", "1,000.00", "1.999", "$$21", "1000000.01"]) {
    assert.equal(parseDollarInput(value), null); assert.throws(() => parseMoney(value));
  }
  assert.equal(formatCents(1850), "$18.50");
});
test("normal journey is fully automatic and survives every intermediate storage roundtrip", () => {
  let ride = roundtrip(pending());
  const seen = [ride.status];
  for (let step = 1; step <= 12; step++) {
    ride = roundtrip(advanceDemoRide(ride, at(step * EVENT_DELAY_MS)));
    seen.push(ride.status);
  }
  assert.deepEqual(seen, ["payment_pending", "payment_authorized", "ride_requesting", "booked", "driver_assigned",
    "driver_arriving", "driver_arrived", "passenger_picked_up", "in_progress", "arrived_destination", "completed", "settled", "settled"]);
  assert.equal(ride.operatorInterventionRequired, false);
  assert.equal(ride.settlementCount, 1);
  assert.equal(ride.paymentStatus, "paid");
  assert.equal(ride.settlement.amountToCaptureCents, 2950);
  assert.equal(ride.settlement.amountToReleaseCents, 250);
  assert.equal(ride.actualProviderCostCents, 2500);
  assert.equal(advanceDemoRide(ride, at(90000)), ride);
});
test("accepting policy and price is centrally required, not only a button gate", () => {
  assert.throws(() => act(fresh(), { type: "start_payment" }), /política/);
  let accepted = act(fresh(), { type: "accept_policy", accepted: true });
  accepted = act(accepted, { type: "accept_policy", accepted: false });
  assert.throws(() => act(accepted, { type: "start_payment" }));
  const forged = { ...pending(), cancellationPolicyAccepted: false };
  assert.equal(rideEventProcessor.process(forged, event(forged, "payment_authorized")).status, "needs_attention");
  assert.equal(cancellationPolicyText.includes("cancelación"), true);
});
test("booking is impossible without authorized payment and correct sequence", () => {
  for (const ride of [fresh(), pending(), { ...pending(), status: "ride_requesting" }]) {
    const result = rideEventProcessor.process(ride, event(ride, "booked"));
    assert.equal(result.status, "needs_attention");
    assert.equal(result.providerReference, "");
    assert.equal(hasAuthorizedPayment(ride), false);
  }
});
test("pure automatic settlement handles lower, equal and greater than authorization", () => {
  for (const [cost, capture, release, additional, status] of [
    [2000, 2450, 750, 0, "settled"], [2750, 3200, 0, 0, "settled"], [3500, 3200, 0, 750, "needs_attention"],
  ]) {
    const result = settleRideAutomatically({ authorizedAmountCents: 3200, providerFinalCostCents: cost, coordinationFeeCents: 450, cancellationFeeCents: 0 });
    assert.deepEqual(result, { finalCustomerTotalCents: cost + 450, amountToCaptureCents: capture, amountToReleaseCents: release,
      additionalPaymentRequiredCents: additional, settlementStatus: status });
    assert.ok(result.amountToCaptureCents <= 3200);
  }
  assert.equal(demoPaymentGateway.settle({ authorizedAmountCents: 3200, providerFinalCostCents: 2500, coordinationFeeCents: 450, cancellationFeeCents: 0 }, "op-demo").operationId, "op-demo");
});
test("lower final cost releases difference automatically", () => {
  const ride = roundtrip(finished("lower_final"));
  assert.equal(ride.status, "settled");
  assert.equal(ride.actualProviderCostCents, 2000);
  assert.equal(ride.pricing.providerEstimateCents, 2500);
  assert.equal(ride.settlement.amountToReleaseCents, 750);
});
test("higher cost within authorization settles without an exception", () => {
  const ride = roundtrip(finished("higher_within"));
  assert.equal(ride.status, "settled");
  assert.equal(ride.settlement.amountToCaptureCents, 3200);
  assert.equal(ride.settlement.amountToReleaseCents, 0);
  assert.equal(ride.exceptionCount, 0);
});
test("overage goes to needs_attention, no automatic second charge or unsafe resolution", () => {
  const ride = roundtrip(finished("over_authorization"));
  assert.equal(ride.status, "needs_attention");
  assert.equal(ride.exceptionReason, "additional_payment_required");
  assert.equal(ride.settlement.amountToCaptureCents, 3200);
  assert.equal(ride.settlement.additionalPaymentRequiredCents, 750);
  assert.equal(ride.additionalPaymentOperationId, null);
  assert.equal(ride.operatorInterventionRequired, false);
  assert.throws(() => act(ride, { type: "approve_additional" }));
  assert.throws(() => act(ride, { type: "resolve_exception" }));
  assert.throws(() => act(ride, { type: "consent_additional", amountCents: 749 }));
  let consented = roundtrip(act(ride, { type: "consent_additional", amountCents: 750 }));
  assert.equal(consented.additionalPaymentApprovedAt, null);
  consented = roundtrip(act(consented, { type: "approve_additional" }));
  assert.equal(act(consented, { type: "approve_additional" }), consented);
  const resolved = roundtrip(act(consented, { type: "resolve_exception" }));
  assert.equal(resolved.status, "settled");
  assert.equal(resolved.settlementCount, 1);
  assert.equal(resolved.settlement.amountToCaptureCents, 3200);
  assert.equal(resolved.operatorInterventionRequired, true);
  const m = calculateRideMetrics([resolved], at(60000));
  assert.equal(m.coordinationRevenueCents, 450);
  assert.equal(m.totalCustomerPaymentsCents, 3950);
  assert.equal(m.estimatedProcessingFeesCents, estimateProcessingFee(3200) + estimateProcessingFee(750));
});
test("free and charged cancellations waive coordination and release unused amount", () => {
  for (const [scenario, charge] of [["free_cancellation", 0], ["charged_cancellation", 500]]) {
    const ride = roundtrip(finished(scenario));
    assert.equal(ride.status, "cancelled"); assert.equal(ride.wasCancelled, true);
    assert.equal(ride.settlement.finalCustomerTotalCents, charge);
    assert.equal(ride.settlement.amountToCaptureCents, charge);
    assert.equal(ride.settlement.amountToReleaseCents, 3200 - charge);
    assert.equal(calculateRideMetrics([ride], at(60000)).coordinationRevenueCents, 0);
  }
  const ride = advanceDemoRide(pending(), at(6000));
  const capped = roundtrip(rideEventProcessor.process(ride, event(ride, "provider_cancelled", { cancellationFeeCents: 5000 })));
  assert.equal(capped.settlement.finalCustomerTotalCents, 3200);
  assert.equal(capped.settlement.amountToCaptureCents, 3200);
  roundtrip(act(fresh(), { type: "cancel" }));
});
test("duplicate webhook is ignored, repeated delivery counted only once", () => {
  let ride = roundtrip(finished("duplicate"));
  assert.equal(ride.duplicateEventsIgnored, 1);
  assert.equal(ride.settlementCount, 1);
  const duplicate = { id: ride.processedEventIds.at(-1), deliveryId: ride.ignoredDeliveryIds[0], rideId: ride.id, attempt: 1, type: "provider_final", at: now, providerFinalCostCents: 2500 };
  assert.equal(rideEventProcessor.process(ride, duplicate), ride);
  ride = roundtrip(rideEventProcessor.process(ride, { ...duplicate, deliveryId: "another-delivery" }));
  assert.equal(ride.duplicateEventsIgnored, 2);
  assert.equal(ride.settlementCount, 1);
});
test("different final event IDs, reordered old events and late delivery cannot close twice or resurrect ride", () => {
  for (const ride of [finished(), finished("charged_cancellation")]) {
    const result = roundtrip(rideEventProcessor.process(ride, event(ride, "provider_final", { id: "new-final", at: now, providerFinalCostCents: 1 })));
    assert.deepEqual(result.settlement, ride.settlement);
    assert.equal(result.settlementCount, 1); assert.equal(result.status, ride.status);
  }
  const ride = advanceDemoRide(pending(), at(3000));
  const bad = rideEventProcessor.process(ride, event(ride, "completed"));
  assert.equal(bad.status, "needs_attention");
  assert.equal(bad.exceptionReason, "webhook_error");
});
test("missing final event times out once, permits actual late event but not manual invented final cost", () => {
  const complete = advanceDemoRide(pending("missing_final"), at(15000));
  assert.equal(complete.status, "completed");
  const waiting = advanceDemoRide(complete, at(15000 + FINAL_EVENT_TIMEOUT_MS - 1));
  assert.equal(waiting.status, "completed");
  const timedOut = roundtrip(advanceDemoRide(waiting, at(15000 + FINAL_EVENT_TIMEOUT_MS)));
  assert.equal(timedOut.status, "needs_attention");
  assert.equal(timedOut.exceptionReason, "final_timeout");
  assert.equal(timedOut.settlement, null);
  assert.equal(advanceDemoRide(timedOut, at(90000)), timedOut);
  assert.throws(() => act(timedOut, { type: "resolve_exception" }));
  assert.equal(canCancel(timedOut), false);
  const recovered = roundtrip(rideEventProcessor.process(timedOut, event(timedOut, "provider_final", { at: at(90000), providerFinalCostCents: 2500 })));
  assert.equal(recovered.status, "settled");
  assert.equal(recovered.exceptionCount, 1);
});
test("booking errors and no driver route to supervisor; safe retry progresses automatically", () => {
  for (const [scenario, reason] of [["no_driver", "provider_unavailable"], ["booking_error", "booking_error"]]) {
    const failed = roundtrip(finished(scenario));
    assert.equal(failed.status, "needs_attention"); assert.equal(failed.exceptionReason, reason);
    assert.equal(failed.providerReference, "");
    assert.equal(failed.settlement, null);
    let retry = roundtrip(act(failed, { type: "retry_booking" }, at(60000)));
    assert.equal(act(retry, { type: "retry_booking" }), retry);
    retry = roundtrip(advanceDemoRide(retry, at(90000)));
    assert.equal(retry.status, "settled"); assert.equal(retry.operatorInterventionRequired, true);
    assert.equal(retry.attempt, 2);
    const old = rideEventProcessor.process(retry, event(retry, "booking_error", { attempt: 1 }));
    assert.equal(old.status, "settled");
  }
});
test("declined payment does not book; customer can retry and complete", () => {
  const failed = roundtrip(finished("payment_declined"));
  assert.equal(failed.status, "payment_failed");
  assert.equal(failed.authorizedAmountCents, 0);
  assert.equal(failed.providerReference, "");
  assert.equal(failed.exceptionCount, 1);
  const retried = act(failed, { type: "start_payment" }, at(60000));
  assert.equal(roundtrip(advanceDemoRide(retried, at(90000))).status, "settled");
});
test("webhook processing error is explicit attention, cannot generically change state", () => {
  const failed = roundtrip(finished("webhook_error"));
  assert.equal(failed.status, "needs_attention"); assert.equal(failed.exceptionReason, "webhook_error");
  assert.throws(() => act(failed, { type: "resolve_exception" }));
  assert.throws(() => act(failed, { type: "retry_booking" }));
  const contacted = roundtrip(act(failed, { type: "contact_customer", note: "Contacto ficticio, sin envío." }));
  assert.equal(contacted.operatorInterventionRequired, true);
  assert.equal(contacted.status, "needs_attention");
});
test("exceptions preserve timeline and never reopen cancellation after pickup", () => {
  for (const time of [10500, 12000, 13500]) {
    const active = advanceDemoRide(pending(), at(time));
    const failed = roundtrip(rideEventProcessor.process(active, event(active, "webhook_error")));
    assert.equal(failed.status, "needs_attention");
    assert.equal(failed.progressStatus, active.status);
    assert.equal(canCancel(failed), false);
    assert.throws(() => act(failed, { type: "cancel" }));
  }
  const noDriver = finished("no_driver");
  assert.equal(noDriver.progressStatus, "ride_requesting");
  assert.equal(canCancel(noDriver), true);
});
test("automation requires web, zero intervention AND settled", () => {
  const settled = finished();
  const rides = [settled, fresh("normal", "second"), { ...settled, id: "third", requestChannel: "phone" },
    { ...settled, id: "fourth", operatorInterventionRequired: true }, finished("charged_cancellation")];
  const m = calculateRideMetrics(rides, at(60000));
  assert.equal(m.automaticCount, 1);
  assert.equal(m.automationBps, 2000);
  assert.equal(m.cancellationBps, 2000);
  assert.equal(m.overall, "red");
  assert.equal(calculateRideMetrics([], now).automationBps, null);
});
test("metrics retain average fare, exact accounting, 100/day projection and new supervision indicators", () => {
  const normal = finished();
  const m = calculateRideMetrics([normal], at(60000));
  assert.equal(m.automationBps, 10000);
  assert.equal(m.closedWithoutInterventionBps, 10000);
  assert.equal(m.averageProviderEstimateCents, 2500);
  assert.equal(m.coordinationRevenueCents, 450);
  assert.equal(m.estimatedProcessingFeesCents, 116);
  assert.equal(m.contributionCents, 334);
  assert.equal(m.suggestedRiskReserveCents, 59);
  assert.equal(m.monthlyHundredDaily.trips, 3000);
  assert.equal(m.monthlyHundredDaily.contributionCents, 1002000);
  assert.equal(m.averageBookingMs, 4500);
  assert.equal(m.averageAssignmentMs, 6000);
  assert.equal(m.tripsPerDay, 1);
  assert.equal(m.overall, "green");
  const exceptions = calculateRideMetrics([finished("missing_final"), finished("duplicate")], at(60000));
  assert.equal(exceptions.exceptionCount, 1);
  assert.equal(exceptions.blockedCount, 1);
  assert.equal(exceptions.duplicateEventsIgnored, 1);
});
test("session timer resumes on reload, advances all rides and no-ops when none due", () => {
  let session = addRide(emptyRideSession, pending());
  assert.equal(advanceDemoSession(session, at(1000)), session);
  session = advanceDemoSession(decodeRideSession(JSON.stringify(session)), at(60000));
  assert.equal(session.requests[0].status, "settled");
  assert.equal(advanceDemoSession(session, at(90000)), session);
  assert.throws(() => addRide(session, session.requests[0]));
  assert.throws(() => updateRide(session, "missing", { type: "cancel" }, now));
});
test("v1 migration retains input, schedule and IDs without inventing payment", () => {
  const old = { ...input, id: "RIDE-DEMO-OLD", requestSource: "web", status: "booked", providerReference: "DEMO-OLD",
    estimatedProviderCostCents: 2000, customerPriceCents: 2500, createdAt: now, updatedAt: now,
    rideTiming: "scheduled", scheduledAt: "2025-01-01T12:00:00.000Z" };
  const session = decodeRideSession(JSON.stringify({ version: 1, requests: [old], currentRideId: old.id }));
  const ride = roundtrip(session.requests[0]);
  assert.equal(ride.status, "needs_attention");
  assert.equal(ride.exceptionReason, "migration");
  assert.equal(ride.authorizedAmountCents, 0);
  assert.equal(ride.scheduledAt, old.scheduledAt);
  assert.equal(ride.providerReference, old.providerReference);
  assert.equal(ride.settlement, null);
  assert.equal(session.version, 4);
  assert.ok(session.notices.length);
});
test("v2 migration preserves historical settled amounts and configurable reserve, flags unfinished records", () => {
  for (const reserveBps of [0, 500, 1000]) {
    const pricing = calculateRidePricing(2500, reserveBps);
    const settlement = { finalCustomerTotalCents: 2950, amountToCaptureCents: 2950, amountToReleaseCents: pricing.temporaryReserveCents,
      additionalPaymentRequiredCents: 0, authorizedCancellationChargeCents: 0 };
    const old = { ...input, id: "RIDE-DEMO-V2", requestSource: "web", status: "reconciled", createdAt: now, updatedAt: now,
      cancellationPolicyAccepted: true, cancellationPolicyVersion, cancellationPolicyAcceptedAt: now,
      paymentStatus: "paid", pricing, authorizedAmountCents: pricing.authorizationTotalCents, actualProviderCostCents: 2500,
      completedAt: now, settlement };
    const migrated = decodeRideSession(JSON.stringify({ version: 2, requests: [old], currentRideId: old.id }));
    const ride = roundtrip(migrated.requests[0]);
    assert.equal(ride.status, "settled");
    assert.equal(ride.authorizedAmountCents, pricing.authorizationTotalCents);
    assert.equal(ride.settlement.amountToCaptureCents, settlement.amountToCaptureCents);
    assert.equal(ride.settlement.amountToReleaseCents, settlement.amountToReleaseCents);
    const unfinished = { ...old, status: "booked", settlement: null, actualProviderCostCents: null, completedAt: null };
    const attention = decodeRideSession(JSON.stringify({ version: 2, requests: [unfinished] })).requests[0];
    assert.equal(attention.status, "needs_attention"); assert.equal(attention.settlement, null);
    const prepay = { ...unfinished, status: "quote_created" };
    const quote = decodeRideSession(JSON.stringify({ version: 2, requests: [prepay] })).requests[0];
    assert.equal(quote.status, "quote_created"); assert.equal(quote.cancellationPolicyAccepted, false);
  }
});
test("corrupt storage discards invalid entries, preserves valid neighbors and reports recovery", () => {
  assert.equal(decodeRideSession("{").requests.length, 0);
  assert.ok(decodeRideSession("{").notices.length);
  assert.equal(decodeRideSession('{"version":999,"requests":[]}').requests.length, 0);
  for (const corrupt of [
    { paymentStatus: "invalid" }, { authorizedAmountCents: "3200" }, { attempt: -1 }, { nextEventAt: "bad" },
    { processedEventIds: ["same", "same"] }, { settlementCount: 2 }, { passengerCount: 0 },
  ]) {
    const session = decodeRideSession(JSON.stringify({ version: 4, requests: [{ ...pending(), ...corrupt }, fresh("normal", "valid")], currentRideId: "bad" }));
    assert.equal(session.requests.length, 1);
    assert.equal(session.requests[0].id, "valid");
    assert.equal(session.currentRideId, "valid");
    assert.ok(session.notices.length);
  }
});
test("input validations keep fictional rider data well formed", () => {
  for (const change of [{ riderName: "" }, { riderPhone: "abc" }, { passengerCount: 0 }, { passengerCount: 1.5 },
    { serviceType: "unknown" }, { pickupAddress: input.destinationAddress }, { scenario: "unknown" },
    { rideTiming: "scheduled", scheduledAt: now }]) assert.throws(() => createRide({ ...input, ...change }, "test", now));
});
test("customer interfaces clearly simulate payment, display pricing and receipt without technical accounting language", () => {
  const pricing = renderToStaticMarkup(createElement(PricingBreakdown, { pricing: fresh().pricing }));
  for (const label of ["Costo estimado del viaje", "Coordinación Recogido", "Total estimado", "Retención temporal", "Monto máximo autorizado"]) assert.ok(pricing.includes(label));
  assert.ok(!pricing.includes("Stripe"));
  const receipt = renderToStaticMarkup(createElement(RideReceipt, { ride: finished() }));
  for (const word of ["webhook", "PaymentIntent", "capture", "conciliación"]) assert.ok(!receipt.includes(word));
  assert.ok(receipt.includes("Recibo de prueba"));
  const payment = renderToStaticMarkup(createElement(PaymentDemo, { ride: fresh(), demo: { act() {} } }));
  assert.match(payment, /disabled=""/);
  assert.ok(payment.includes(cancellationPolicyText));
  for (const Component of [RideRequestDemo, RideStatusDemo, RideDispatcherDemo]) {
    const markup = renderToStaticMarkup(createElement(Component));
    assert.ok(markup.includes(demoNotice));
  }
  assert.deepEqual(rideSteps, ["payment_authorized", "ride_requesting", "driver_assigned", "driver_arriving", "driver_arrived", "passenger_picked_up", "in_progress", "arrived_destination", "completed"]);
});
const timelineMarkup = (ride) => renderToStaticMarkup(createElement(RideProgressTimeline, {
  status: ride.status, events: ride.statusEvents, estimatedArrival: ride.estimatedArrival, progressStatus: ride.progressStatus,
}));
test("timeline centrally defines exactly nine public stages in the required order", () => {
  assert.deepEqual(rideTimelineDefinition.map((step) => step.label), ["Solicitud confirmada", "Buscando conductor",
    "Conductor asignado", "Conductor en camino", "El conductor llegó", "Pasajero recogido", "En camino al destino",
    "Llegada al destino", "Viaje completado"]);
  assert.equal(new Set(rideTimelineDefinition.map((step) => step.status)).size, 9);
});
test("every technical state has a public label and grouped aliases share one stage", () => {
  for (const step of rideTimelineDefinition) {
    for (const status of step.statuses) assert.equal(publicStatusLabels[status], step.label);
  }
  assert.equal(publicStatusLabels.booked, "Buscando conductor");
  assert.equal(publicStatusLabels.settled, "Viaje completado");
  assert.equal(ridePresentation("ride_requesting").heading, "Estamos buscando un conductor");
  assert.equal(ridePresentation("driver_arrived").heading, "Tu conductor llegó");
  assert.equal(ridePresentation("arrived_destination").heading, "Llegaste a tu destino");
});
test("completed, current and pending phases derive from the central journey, not the page", () => {
  const ride = advanceDemoRide(pending(), at(7500));
  const steps = getRideTimeline(ride.status, ride.statusEvents, ride.progressStatus);
  assert.deepEqual(steps.map((step) => step.phase), ["completed", "completed", "completed", "current", "pending", "pending", "pending", "pending", "pending"]);
  const markup = timelineMarkup(ride);
  assert.equal((markup.match(/aria-current="step"/g) ?? []).length, 1);
  assert.match(markup, /<ol[^>]+aria-label="Progreso del viaje"/);
  assert.match(markup, /aria-live="polite"/);
  assert.match(markup, /Completada/);
  assert.match(markup, /Etapa actual/);
  assert.match(markup, /Pendiente/);
  assert.doesNotMatch(markup, />driver_arriving<|>booked<|PaymentIntent|webhook/);
});
test("each occurredAt and sequence are persisted once even across duplicated deliveries and reload", () => {
  const assigned = advanceDemoRide(pending(), at(6000));
  const arrival = demoRideProvider.nextEvent(assigned, at(7500));
  const arriving = roundtrip(rideEventProcessor.process(assigned, arrival));
  const eventAt = arriving.statusEvents.find((event) => event.status === "driver_arriving").occurredAt;
  const duplicate = roundtrip(rideEventProcessor.process(arriving, { ...arrival, deliveryId: "repeat" }));
  assert.deepEqual(duplicate.statusEvents, arriving.statusEvents);
  const restored = decodeRideSession(JSON.stringify(addRide(emptyRideSession, duplicate))).requests[0];
  const final = roundtrip(advanceDemoRide(restored, at(60000)));
  assert.equal(final.statusEvents.find((event) => event.status === "driver_arriving").occurredAt, eventAt);
  assert.equal(final.statusEvents.filter((event) => event.status === "driver_arriving").length, 1);
  assert.deepEqual(final.statusEvents.map((event) => event.sequence), final.statusEvents.map((_, index) => index + 1));
  assert.equal(new Set(final.statusEvents.map((event) => event.status)).size, final.statusEvents.length);
  assert.deepEqual(roundtrip(final).statusEvents, final.statusEvents);
});
test("booking retries retain the first search timestamp instead of appending the same stage", () => {
  const failed = finished("no_driver");
  const firstSearch = failed.statusEvents.find((event) => event.status === "ride_requesting");
  const retry = roundtrip(act(failed, { type: "retry_booking" }, at(60000)));
  const final = roundtrip(advanceDemoRide(retry, at(90000)));
  assert.equal(final.statusEvents.filter((event) => event.status === "ride_requesting").length, 1);
  assert.deepEqual(final.statusEvents.find((event) => event.status === "ride_requesting"), firstSearch);
  assert.equal(final.status, "settled");
});
test("search aliases and completed/settled display the first genuine phase timestamp", () => {
  const booked = advanceDemoRide(pending(), at(4500));
  const search = getRideTimeline(booked.status, booked.statusEvents, booked.progressStatus)[1];
  assert.equal(search.occurredAt, at(3000));
  assert.equal(search.current, true);
  const final = finished();
  const last = getRideTimeline(final.status, final.statusEvents, final.progressStatus).at(-1);
  assert.equal(last.occurredAt, at(15000));
  assert.equal(last.phase, "completed");
  assert.equal(last.current, true);
});
test("driver arrived, pickup and arrival at destination are ordered provider states with persisted events", () => {
  for (const [time, status] of [[9000, "driver_arrived"], [10500, "passenger_picked_up"], [13500, "arrived_destination"], [15000, "completed"]]) {
    const ride = roundtrip(advanceDemoRide(pending(), at(time)));
    assert.equal(ride.status, status);
    assert.equal(ride.statusEvents.at(-1).occurredAt, at(time));
    assert.equal(ride.statusEvents.at(-1).source, "provider_simulator");
  }
  const arriving = advanceDemoRide(pending(), at(7500));
  const skipped = rideEventProcessor.process(arriving, event(arriving, "passenger_picked_up"));
  assert.equal(skipped.status, "needs_attention");
});
test("ETA and driver data are supplied by simulator events and survive reload", () => {
  const assigned = roundtrip(advanceDemoRide(pending(), at(6000)));
  assert.equal(assigned.estimatedArrival.minutes, 6);
  assert.equal(assigned.estimatedArrival.target, "pickup");
  assert.equal(assigned.driver.source, "simulation");
  assert.match(arrivalText(assigned.estimatedArrival), /Conductor a 6 min/);
  assert.equal(arrivalText(null), "Calculando tiempo estimado…");
  assert.equal(advanceDemoRide(pending(), at(9000)).estimatedArrival, null);
  const pickedUp = advanceDemoRide(pending(), at(10500));
  assert.match(arrivalText(pickedUp.estimatedArrival), /Destino a 12 min/);
  assert.equal(finished().estimatedArrival, null);
  const driver = renderToStaticMarkup(createElement(RideDriverCard, { driver: assigned.driver, estimatedArrival: assigned.estimatedArrival }));
  for (const word of ["Vehículo", "Color", "Placa demo", "Conductor Demo", "Datos ficticios"]) assert.ok(driver.includes(word));
  assert.doesNotMatch(driver, /<button|tel:|mailto:/);
});
test("cancelled, declined payment and needs_attention are highlighted outside the nine normal stages", () => {
  for (const [scenario, label] of [["free_cancellation", "El viaje fue cancelado"],
    ["payment_declined", "No pudimos autorizar el pago"], ["no_driver", "Necesitamos revisar tu solicitud"]]) {
    const ride = finished(scenario);
    const steps = getRideTimeline(ride.status, ride.statusEvents, ride.progressStatus);
    assert.equal(steps.length, 9);
    assert.equal(steps.some((step) => step.status === ride.status), false);
    assert.equal(steps.some((step) => step.current), false);
    const markup = renderToStaticMarkup(createElement(RideExceptionCard, { status: ride.status }));
    assert.ok(markup.includes(label));
    assert.ok(markup.includes("Solicitar otro viaje"));
    assert.doesNotMatch(timelineMarkup(ride), /aria-current="step"/);
  }
});
test("v3 migration retains financials, IDs and exact known timestamps without inventing arrival events", () => {
  for (const current of [advanceDemoRide(pending(), at(6000)), finished(), finished("free_cancellation"), finished("over_authorization")]) {
    const { statusEvents, driver, estimatedArrival, ...old } = current;
    assert.ok(statusEvents.length); assert.ok(driver || driver === null); assert.ok(estimatedArrival || estimatedArrival === null);
    const session = decodeRideSession(JSON.stringify({ version: 3, requests: [old], currentRideId: old.id }));
    assert.equal(session.version, 4);
    const migrated = roundtrip(session.requests[0]);
    assert.equal(migrated.status, current.status);
    assert.equal(migrated.progressStatus, current.progressStatus);
    assert.deepEqual(migrated.settlement, current.settlement);
    assert.equal(migrated.authorizedAmountCents, current.authorizedAmountCents);
    assert.equal(migrated.estimatedArrival, null);
    assert.equal(migrated.statusEvents.find((event) => event.status === "driver_assigned").occurredAt, current.driverAssignedAt);
    assert.equal(migrated.statusEvents.some((event) => event.status === "driver_arrived"), false);
    assert.ok(migrated.statusEvents.every((event) => event.source === "migration"));
    assert.equal(migrated.statusEvents.some((event) => event.status === "settled"), current.status === "settled");
    assert.ok(session.notices.length);
  }
});
test("malformed or duplicate persisted timeline entries recover safely and preserve valid neighbors", () => {
  const ride = finished();
  const corruptions = [
    [],
    [...ride.statusEvents, ride.statusEvents[0]],
    ride.statusEvents.map((event, index) => index ? event : { ...event, occurredAt: "invalid" }),
    ride.statusEvents.map((event, index) => index ? event : { ...event, sequence: 999 }),
    ride.statusEvents.map((event, index) => index ? event : { ...event, source: "real" }),
    ride.statusEvents.map((event, index) => index ? event : { ...event, label: "booked" }),
  ];
  for (const statusEvents of corruptions) {
    const session = decodeRideSession(JSON.stringify({ version: 4, requests: [{ ...ride, statusEvents }, fresh("normal", "keep")] }));
    assert.equal(session.requests.length, 1);
    assert.equal(session.requests[0].id, "keep");
    assert.ok(session.notices.length);
  }
});
test("compact dispatcher progress reuses public mapping and has no normal-state action", () => {
  const ride = advanceDemoRide(pending(), at(9000));
  const markup = renderToStaticMarkup(createElement(RideProgressSummary, { ride }));
  assert.ok(markup.includes("El conductor llegó"));
  assert.ok(markup.includes(publicRideNumber(ride.id)));
  assert.ok(markup.includes("Última actualización"));
  assert.ok(markup.includes("5 de 9 etapas"));
  assert.doesNotMatch(markup, /<button|onClick/);
});
test("timeline supports reduced motion, explicit phases, focus visibility and vertical responsive layout", () => {
  const css = readFileSync("src/components/rides/RideDemo.module.css", "utf8");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?animation: none/);
  assert.match(css, /data-phase="current"[^}]*animation: ridePulse/);
  assert.match(css, /focus-visible/);
  assert.match(css, /min-height: 44px/);
  assert.match(css, /\.timeline \{[^}]*display: grid/);
  assert.match(css, /\.stepContent \{[^}]*min-width: 0/);
  assert.doesNotMatch(css, /overflow-x: hidden/);
  const map = renderToStaticMarkup(createElement(RideMapPlaceholder, { origin: input.pickupAddress, destination: input.destinationAddress }));
  assert.ok(map.includes("Mapa de demostración"));
  assert.ok(map.includes("sin ubicación real"));
  assert.doesNotMatch(map, /<iframe|<img|https?:/);
});
test("demo source has no external integrations, localStorage or manual normal-state controls", () => {
  function files(path) {
    return readdirSync(path, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? files(`${path}/${entry.name}`) : [`${path}/${entry.name}`]);
  }
  const paths = [...files("src/lib/rides"), ...files("src/components/rides"),
    "src/app/rides/demo/page.tsx", "src/app/rides/demo/status/page.tsx", "src/app/admin/rides/demo/page.tsx"];
  const code = paths.map((path) => readFileSync(path, "utf8")).join("\n");
  assert.doesNotMatch(code, /\b(fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|axios|localStorage)\b/);
  assert.doesNotMatch(code, /https?:\/\/|process\.env|window\.open|tel:|mailto:/);
  const ui = readFileSync("src/components/rides/RideDemo.tsx", "utf8") + readFileSync("src/components/rides/RideEconomics.tsx", "utf8");
  assert.doesNotMatch(ui, /Conciliar|Reconciliando|Conciliado|ReconciliationEditor|QuoteEditor|type: "advance"|type: "book"/);
  assert.equal(demoRideProvider.estimate(), 2500);
});
