import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DriverDemo } from "../src/components/driver/DriverDemo.tsx";
import { AvailableOffers } from "../src/components/driver/AvailableOffers.tsx";
import { ActiveDeliveryCard } from "../src/components/driver/ActiveDeliveryCard.tsx";
import { ActiveDeliveries } from "../src/components/driver/ActiveDeliveries.tsx";
import { DriverHeader } from "../src/components/driver/DriverHeader.tsx";
import { DriverHistory } from "../src/components/driver/DriverHistory.tsx";
import {
  activeDeliveryCount,
  canAcceptOffer,
  createActionGate,
  createDriverDemoState,
  driverDemoReducer,
  driverHistoryLimit,
  driverMessages,
  driverTimeline,
  isActiveDelivery,
  orderLabel,
  visibleOffers,
} from "../src/lib/driver/driver-demo.ts";

const start = Date.parse("2026-10-15T17:00:00.000Z");
const at = (minutes) => new Date(start + minutes * 60_000).toISOString();
const reduce = (state, ...actions) => actions.reduce(driverDemoReducer, state);
const fresh = () => createDriverDemoState(start);

function acceptFirst(state = fresh(), offerId = "demo-offer-1") {
  return reduce(state, { type: "accept_start", offerId }, { type: "accept_success", offerId, at: at(1) });
}

/** Picks up (if still assigned) and completes one delivery; defaults to the first active one. */
function completeFirst(state = acceptFirst(), offerId = state.activeDeliveries[0].offerId, pickupMinute = 10) {
  return reduce(state,
    { type: "pickup_start", offerId }, { type: "pickup_success", offerId, at: at(pickupMinute) },
    { type: "request_completion", offerId },
    { type: "complete_start", offerId }, { type: "complete_success", offerId, at: at(pickupMinute + 15) });
}

const DriverActiveList = ({ state }) => createElement(ActiveDeliveries, {
  deliveries: state.activeDeliveries, pendingOfferId: null, busy: false, onConfirmPickup() {}, onRequestCompletion() {},
});

test("initial demo state has Maria available with simulated offers from three restaurants", () => {
  const state = fresh();
  assert.equal(state.driver.name, "Maria Elizabeth");
  assert.equal(state.availability, "available");
  assert.deepEqual(visibleOffers(state).map((offer) => [orderLabel(offer.orderNumber), offer.restaurantId, offer.restaurantName, offer.assignmentLabel]), [
    ["#E814C7-01", "la-fonda-englewood", "La Fonda", "Entrega 1 de 3"],
    ["#A912D3-01", "brisas-englewood", "Brisas Englewood", "Entrega 1 de 2"],
    ["#B527F9-01", "jade-lee-englewood", "Jade Lee Englewood", "Entrega 1 de 2"],
    ["#E814C7-02", "la-fonda-englewood", "La Fonda", "Entrega 2 de 3"],
    ["#A912D3-02", "brisas-englewood", "Brisas Englewood", "Entrega 2 de 2"],
  ]);
  for (const offer of state.offers) {
    assert.ok(Date.parse(offer.createdAt) <= start && Date.parse(offer.createdAt) > start - 10 * 60_000);
    assert.equal(offer.status, "available");
    assert.deepEqual([offer.assignedAt, offer.pickedUpAt, offer.completedAt], [null, null, null]);
  }
  assert.equal(activeDeliveryCount(state), 0);
});

test("accepting an offer shows loading, moves it to the active deliveries and switches tab", () => {
  const loading = reduce(fresh(), { type: "accept_start", offerId: "demo-offer-1" });
  assert.deepEqual(loading.pending, { kind: "accept", offerId: "demo-offer-1" });
  assert.equal(loading.activeDeliveries.length, 0);
  const accepted = driverDemoReducer(loading, { type: "accept_success", offerId: "demo-offer-1", at: at(1) });
  assert.equal(accepted.pending, null);
  assert.equal(accepted.tab, "active");
  assert.equal(visibleOffers(accepted).some((offer) => offer.offerId === "demo-offer-1"), false);
  assert.equal(accepted.activeDeliveries.length, 1);
  const [delivery] = accepted.activeDeliveries;
  assert.equal(delivery.status, "assigned");
  assert.equal(delivery.restaurantId, "la-fonda-englewood");
  assert.equal(delivery.driverName, "Maria Elizabeth");
  assert.equal(delivery.assignedAt, at(1));
  assert.deepEqual([delivery.pickedUpAt, delivery.completedAt], [null, null]);
  assert.deepEqual(accepted.notification && [accepted.notification.tone, accepted.notification.message],
    ["success", "Entrega #E814C7-01 asignada correctamente."]);
});

test("double acceptance is blocked by the action gate and the reducer", () => {
  const gate = createActionGate();
  assert.equal(gate.tryEnter(), true);
  assert.equal(gate.tryEnter(), false, "A second tap while the simulated request runs is ignored");
  gate.leave();
  assert.equal(gate.tryEnter(), true);

  const loading = reduce(fresh(), { type: "accept_start", offerId: "demo-offer-1" });
  assert.equal(driverDemoReducer(loading, { type: "accept_start", offerId: "demo-offer-1" }), loading);
  assert.equal(driverDemoReducer(loading, { type: "accept_start", offerId: "demo-offer-2" }), loading);
  assert.equal(driverDemoReducer(loading, { type: "decline_offer", offerId: "demo-offer-2" }), loading);
  const accepted = driverDemoReducer(loading, { type: "accept_success", offerId: "demo-offer-1", at: at(1) });
  assert.equal(driverDemoReducer(accepted, { type: "accept_success", offerId: "demo-offer-1", at: at(2) }), accepted);
  assert.equal(accepted.activeDeliveries.length, 1);
});

test("Maria can hold one active delivery per restaurant, up to three in total", () => {
  const laFonda = acceptFirst(fresh(), "demo-offer-1");
  const offer = (state, id) => state.offers.find((item) => item.offerId === id);

  // A second La Fonda offer is blocked; other restaurants stay available.
  assert.deepEqual(canAcceptOffer(laFonda, offer(laFonda, "demo-offer-4")), { ok: false, reason: driverMessages.sameRestaurant });
  assert.equal(driverMessages.sameRestaurant, "Ya tiene una entrega activa de este restaurante. Puede aceptar ofertas de otros restaurantes.");
  const sameRestaurant = driverDemoReducer(laFonda, { type: "accept_start", offerId: "demo-offer-4" });
  assert.equal(sameRestaurant.pending, null);
  assert.equal(sameRestaurant.notification.tone, "error");
  assert.equal(sameRestaurant.notification.message, driverMessages.sameRestaurant);
  assert.deepEqual(canAcceptOffer(laFonda, offer(laFonda, "demo-offer-2")), { ok: true });
  assert.deepEqual(canAcceptOffer(laFonda, offer(laFonda, "demo-offer-3")), { ok: true });

  const twoActive = acceptFirst(laFonda, "demo-offer-2");
  const threeActive = acceptFirst(twoActive, "demo-offer-3");
  assert.equal(activeDeliveryCount(threeActive), 3);
  assert.deepEqual(threeActive.activeDeliveries.map((delivery) => [orderLabel(delivery.orderNumber), delivery.restaurantId, delivery.status]), [
    ["#E814C7-01", "la-fonda-englewood", "assigned"],
    ["#A912D3-01", "brisas-englewood", "assigned"],
    ["#B527F9-01", "jade-lee-englewood", "assigned"],
  ]);

  const activeHtml = renderToStaticMarkup(createElement(DriverActiveList, { state: threeActive }));
  assert.equal((activeHtml.match(/<article/g) ?? []).length, 3, "One independent card per active delivery");
  assert.equal((activeHtml.match(/CONFIRMAR RECOGIDA/g) ?? []).length, 3);

  // A fourth delivery is blocked by global capacity.
  assert.equal(driverMessages.capacity, "Alcanzó su capacidad máxima de 3 entregas activas.");
  for (const id of ["demo-offer-4", "demo-offer-5"]) {
    assert.deepEqual(canAcceptOffer(threeActive, offer(threeActive, id)), { ok: false, reason: driverMessages.capacity });
  }
  const fourth = driverDemoReducer(threeActive, { type: "accept_start", offerId: "demo-offer-5" });
  assert.equal(fourth.pending, null);
  assert.equal(fourth.notification.message, driverMessages.capacity);
  assert.equal(activeDeliveryCount(fourth), 3);

  const header = renderToStaticMarkup(createElement(DriverHeader, {
    firstName: "Maria", availability: "available", activeCount: activeDeliveryCount(threeActive), maxActive: 3, onAvailabilityChange() {},
  }));
  assert.match(header, /Capacidad activa: <strong>3 de 3<\/strong>/);

  // Pick up only Brisas.
  const brisasPicked = reduce(threeActive, { type: "pickup_start", offerId: "demo-offer-2" },
    { type: "pickup_success", offerId: "demo-offer-2", at: at(10) });
  const byRestaurant = (state) => Object.fromEntries(state.activeDeliveries.map((delivery) => [delivery.restaurantId, delivery]));
  assert.equal(byRestaurant(brisasPicked)["brisas-englewood"].status, "picked_up");
  assert.equal(byRestaurant(brisasPicked)["brisas-englewood"].pickedUpAt, at(10));
  for (const id of ["la-fonda-englewood", "jade-lee-englewood"]) {
    assert.equal(byRestaurant(brisasPicked)[id].status, "assigned");
    assert.equal(byRestaurant(brisasPicked)[id].pickedUpAt, null);
    assert.equal(byRestaurant(brisasPicked)[id], byRestaurant(threeActive)[id], "Other deliveries are untouched");
  }

  // Complete Brisas: frees one slot and only Brisas goes to history.
  const brisasDone = reduce(brisasPicked, { type: "request_completion", offerId: "demo-offer-2" },
    { type: "complete_start", offerId: "demo-offer-2" }, { type: "complete_success", offerId: "demo-offer-2", at: at(20) });
  assert.equal(activeDeliveryCount(brisasDone), 2);
  assert.equal(activeDeliveryCount(brisasDone, "brisas-englewood"), 0);
  assert.deepEqual(brisasDone.activeDeliveries.map((delivery) => [delivery.restaurantId, delivery.status]), [
    ["la-fonda-englewood", "assigned"], ["jade-lee-englewood", "assigned"],
  ]);
  assert.deepEqual(brisasDone.history.map((item) => [orderLabel(item.orderNumber), item.status, item.completedAt]), [
    ["#A912D3-01", "completed", at(20)],
  ]);

  // A new Brisas offer can be accepted again; La Fonda is still blocked.
  assert.deepEqual(canAcceptOffer(brisasDone, offer(brisasDone, "demo-offer-5")), { ok: true });
  assert.deepEqual(canAcceptOffer(brisasDone, offer(brisasDone, "demo-offer-4")), { ok: false, reason: driverMessages.sameRestaurant });
  const brisasAgain = acceptFirst(brisasDone, "demo-offer-5");
  assert.equal(activeDeliveryCount(brisasAgain), 3);
  assert.equal(byRestaurant(brisasAgain)["brisas-englewood"].orderNumber, "A912D3-02");

  // Each remaining delivery reaches history independently.
  let state = brisasAgain;
  for (const [index, id] of ["demo-offer-3", "demo-offer-1", "demo-offer-5"].entries()) {
    state = completeFirst(state, id, 30 + index * 5);
    assert.equal(activeDeliveryCount(state), 2 - index);
    assert.equal(state.history.length, index + 2);
    assert.equal(state.history[0].offerId, id);
  }
  assert.deepEqual(state.history.map((item) => orderLabel(item.orderNumber)), ["#A912D3-02", "#E814C7-01", "#B527F9-01", "#A912D3-01"]);
  assert.ok(state.history.every((item) => item.status === "completed" && item.pickedUpAt && item.completedAt));
});

test("completed, declined and cancelled deliveries never count as active", () => {
  const state = fresh();
  const base = { ...state.offers[0], driverName: "Maria Elizabeth", assignedAt: at(1), pickedUpAt: null, completedAt: null };
  state.activeDeliveries = ["completed", "declined", "cancelled", "accepted", "assigned", "picked_up"]
    .map((status, index) => ({ ...base, offerId: `x-${index}`, restaurantId: `r-${index}`, status }));
  assert.equal(activeDeliveryCount(state), 3);
  for (const status of ["completed", "declined", "cancelled"]) assert.equal(isActiveDelivery({ status }), false);
  for (const status of ["accepted", "assigned", "picked_up"]) assert.equal(isActiveDelivery({ status }), true);
});

test("declining an offer removes it from the list", () => {
  const declined = reduce(fresh(), { type: "decline_offer", offerId: "demo-offer-2" });
  assert.equal(visibleOffers(declined).length, 4);
  assert.equal(declined.offers.find((offer) => offer.offerId === "demo-offer-2").status, "declined");
  assert.equal(declined.notification.message, "Oferta #A912D3-01 rechazada.");
});

test("confirming pickup marks picked_up, stores pickedUpAt and advances the timeline", () => {
  const accepted = acceptFirst();
  assert.deepEqual(driverTimeline("accepted").map((step) => step.state), ["done", "current", "upcoming", "upcoming"]);
  const picking = reduce(accepted, { type: "pickup_start", offerId: "demo-offer-1" });
  assert.equal(picking.pending.kind, "pickup");
  assert.equal(driverDemoReducer(picking, { type: "pickup_start", offerId: "demo-offer-1" }), picking);
  const pickedUp = driverDemoReducer(picking, { type: "pickup_success", offerId: "demo-offer-1", at: at(10) });
  assert.equal(pickedUp.activeDeliveries[0].status, "picked_up");
  assert.equal(pickedUp.activeDeliveries[0].pickedUpAt, at(10));
  assert.equal(pickedUp.notification.message, "Pedido #E814C7-01 recogido. Entrega en camino.");
  assert.deepEqual(driverTimeline("picked_up").map((step) => [step.label, step.state]), [
    ["Conductor asignado", "done"], ["Pedido recogido", "done"], ["En camino", "current"], ["Entrega completada", "upcoming"],
  ]);
  const html = renderToStaticMarkup(createElement(ActiveDeliveryCard, {
    delivery: pickedUp.activeDeliveries[0], loading: false, disabled: false, onConfirmPickup() {}, onRequestCompletion() {},
  }));
  assert.ok(html.includes("COMPLETAR ENTREGA"));
  assert.ok(!html.includes("CONFIRMAR RECOGIDA"));
});

test("completing requires confirmation, then moves the delivery to history and frees the driver", () => {
  const pickedUp = reduce(acceptFirst(), { type: "pickup_start", offerId: "demo-offer-1" },
    { type: "pickup_success", offerId: "demo-offer-1", at: at(10) });
  assert.equal(driverDemoReducer(pickedUp, { type: "complete_start", offerId: "demo-offer-1" }), pickedUp,
    "Never completes without the confirmation dialog");
  const confirming = driverDemoReducer(pickedUp, { type: "request_completion", offerId: "demo-offer-1" });
  assert.equal(confirming.confirmingCompletionId, "demo-offer-1");
  assert.equal(driverDemoReducer(confirming, { type: "cancel_completion" }).activeDeliveries[0].status, "picked_up");
  const completed = completeFirst(acceptFirst());
  assert.equal(completed.activeDeliveries.length, 0);
  assert.equal(completed.confirmingCompletionId, null);
  assert.equal(completed.notification.message, "Entrega #E814C7-01 completada correctamente.");
  assert.equal(completed.history.length, 1);
  const [item] = completed.history;
  assert.equal(item.status, "completed");
  assert.equal(item.assignedAt, at(1));
  assert.equal(item.pickedUpAt, at(10));
  assert.equal(item.completedAt, at(25));
  assert.equal(item.durationMs, 24 * 60_000);
  assert.deepEqual(driverTimeline("completed").map((step) => step.state), ["done", "done", "done", "done"]);
  assert.equal(canAcceptOffer(completed, completed.offers.find((offer) => offer.offerId === "demo-offer-2")).ok, true,
    "Driver can accept again after completing");
  const html = renderToStaticMarkup(createElement(DriverHistory, { items: completed.history }));
  for (const label of ["#E814C7-01", "La Fonda", "Completada", "Asignada", "Recogida", "Finalizada", "Duración total", "24 min 0 s"]) {
    assert.ok(html.includes(label), `History missing ${label}`);
  }
});

test("history keeps only the last five completed deliveries", () => {
  let state = fresh();
  for (let index = 0; index < driverHistoryLimit + 2; index++) {
    state = reduce(state, { type: "reset_offers", now: start });
    state = completeFirst(acceptFirst(state, "demo-offer-2"));
  }
  assert.equal(state.history.length, driverHistoryLimit);
});

test("unavailable drivers cannot accept offers but keep their active delivery", () => {
  const unavailable = reduce(fresh(), { type: "set_availability", availability: "unavailable" });
  const attempt = driverDemoReducer(unavailable, { type: "accept_start", offerId: "demo-offer-2" });
  assert.equal(attempt.pending, null);
  assert.equal(attempt.activeDeliveries.length, 0);
  assert.equal(attempt.notification.tone, "error");
  assert.equal(attempt.notification.message, driverMessages.unavailable);
  const html = renderToStaticMarkup(createElement(AvailableOffers, {
    offers: visibleOffers(unavailable), nowMs: start, unavailable: true, pendingOfferId: null, busy: false,
    checkOffer: (offer) => canAcceptOffer(unavailable, offer), onAccept() {}, onDecline() {}, onReset() {},
  }));
  assert.ok(html.includes("No puede aceptar ofertas"));

  const kept = reduce(acceptFirst(), { type: "set_availability", availability: "unavailable" });
  assert.equal(kept.activeDeliveries.length, 1);
  assert.match(kept.notification.message, /entrega activa se conserva/);
  const switchedDuringRequest = reduce(fresh(), { type: "accept_start", offerId: "demo-offer-1" },
    { type: "set_availability", availability: "unavailable" },
    { type: "accept_success", offerId: "demo-offer-1", at: at(1) });
  assert.equal(switchedDuringRequest.activeDeliveries.length, 0);
  assert.equal(switchedDuringRequest.pending, null);
});

test("simulated errors release the pending action and are reported", () => {
  const failed = reduce(fresh(), { type: "accept_start", offerId: "demo-offer-1" }, { type: "action_failed" });
  assert.equal(failed.pending, null);
  assert.equal(failed.activeDeliveries.length, 0);
  assert.equal(failed.notification.tone, "error");
  assert.equal(failed.notification.message, driverMessages.simulatedError);
});

test("internal WEB request IDs are never rendered", () => {
  assert.equal(orderLabel("WEB44632F32E5CD4C10BD8A5C3C4899D1E7"), "Pedido");
  assert.equal(orderLabel("#E814C7-01"), "#E814C7-01");
  const state = fresh();
  state.offers[0] = { ...state.offers[0], orderNumber: "WEB44632F32E5CD4C10BD8A5C3C4899D1E7" };
  const offersHtml = renderToStaticMarkup(createElement(AvailableOffers, {
    offers: visibleOffers(state), nowMs: start, unavailable: false, pendingOfferId: null, busy: false,
    checkOffer: (offer) => canAcceptOffer(state, offer), onAccept() {}, onDecline() {}, onReset() {},
  }));
  assert.ok(!/WEB/.test(offersHtml));
  for (const label of ["TOMAR ENTREGA", "NO DISPONIBLE", "#A912D3-01", "#B527F9-01", "Jade Lee Englewood"]) assert.ok(offersHtml.includes(label));
  const pageHtml = renderToStaticMarkup(createElement(DriverDemo));
  assert.ok(!/WEB/.test(pageHtml));
  for (const label of ["Hola, Maria", "Modo de demostración", "Disponible", "Capacidad activa", "0 de 3", "Ofertas", "Entrega activa", "Historial", "#E814C7-01"]) {
    assert.ok(pageHtml.includes(label), `Page missing ${label}`);
  }
  assert.ok(!/\+1\d{10}|tel:/.test(pageHtml), "No phone numbers in the driver UI");
});
