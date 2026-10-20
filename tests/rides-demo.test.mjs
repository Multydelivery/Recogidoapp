import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import {
  addRide, applyRideAction, canCancel, createRide, decodeRideSession, demoNotice,
  emptyRideSession, formatCents, isServiceType, money, parseDollarInput, parseMoney, rideSteps, updateRide,
} from "../src/lib/rides/demo.ts";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "next/navigation") {
      return { url: "data:text/javascript,export function useRouter(){return{push(){throw new Error('Unexpected navigation during server render')}}}", shortCircuit: true };
    }
    return nextResolve(specifier, context);
  },
});
const { RideDispatcherDemo, RideRequestDemo, RideStatusDemo } = await import("../src/components/rides/RideDemo.tsx");

const now = "2026-10-20T16:00:00.000Z";
const later = "2026-10-20T16:01:00.000Z";
const input = {
  riderName: " Cliente Demo ", riderPhone: "2015550100",
  pickupAddress: "100 Calle Demo", destinationAddress: "200 Avenida Simulada",
  rideTiming: "now", scheduledAt: null, passengerCount: 2, serviceType: "on_demand", notes: "",
};
const fresh = () => createRide(input, "RIDE-DEMO-TEST", now);
const act = (ride, action) => applyRideAction(ride, action, later);
const reviewing = () => act(fresh(), { type: "review" });
const quoted = () => act(reviewing(), { type: "quote", providerCostCents: 2000, customerPriceCents: 2800 });
const approved = () => act(quoted(), { type: "approve" });
const booked = () => act(approved(), { type: "book", providerReference: "RESERVA-DEMO-001" });
const assigned = () => act(booked(), { type: "assign", driverName: "Conductor Demo", vehicleDescription: "Sedán demo", vehiclePlate: "DEMO-001" });

test("creates the exact requested shared model without pricing or driver data", () => {
  const ride = fresh();
  assert.equal(ride.riderName, "Cliente Demo");
  assert.equal(ride.status, "requested");
  assert.equal(ride.requestSource, "web");
  assert.equal(ride.createdAt, now);
  assert.equal(ride.updatedAt, now);
  assert.deepEqual([ride.customerPriceCents, ride.estimatedMarginCents, ride.estimatedProviderCostCents], [null, null, null]);
  assert.deepEqual([ride.driverName, ride.vehicleDescription, ride.vehiclePlate, ride.providerReference], ["", "", "", ""]);
  assert.equal(Object.keys(ride).length, 21);
});

test("validates required text, phone, distinct addresses, service and passenger limits", () => {
  for (const patch of [
    { riderName: " " }, { riderName: "a".repeat(101) }, { riderPhone: "abc1234567" },
    { riderPhone: "123" }, { pickupAddress: "" }, { destinationAddress: " 100 CALLE DEMO " },
    { serviceType: "toString" }, { passengerCount: 0 }, { passengerCount: 9 },
    { passengerCount: 1.5 }, { notes: "x".repeat(1001) }, { rideTiming: "invalid" },
    { scheduledAt: later },
  ]) assert.throws(() => createRide({ ...input, ...patch }, "TEST", now));
  assert.equal(isServiceType("medical"), true);
  assert.equal(isServiceType("toString"), false);
  for (const passengerCount of [1, 8]) assert.equal(createRide({ ...input, passengerCount }, "TEST", now).passengerCount, passengerCount);
});

test("scheduled rides require a future date and survive reload after their scheduled time", () => {
  for (const scheduledAt of [null, "", "invalid", now, "2026-01-01T00:00:00Z"]) {
    assert.throws(() => createRide({ ...input, rideTiming: "scheduled", scheduledAt }, "TEST", now));
  }
  const ride = createRide({ ...input, rideTiming: "scheduled", scheduledAt: later }, "TEST", now);
  const state = addRide(emptyRideSession, ride);
  assert.deepEqual(decodeRideSession(JSON.stringify(state)), state);
});

test("money parsing is exact in cents and rejects invalid, negative and excessive amounts", () => {
  for (const [value, expected] of [["0", 0], ["0.01", 1], ["20", 2000], ["28.10", 2810], ["28,1", 2810], ["1000000.00", 100000000]]) {
    assert.equal(parseMoney(value), expected);
  }
  for (const value of ["", "-1", "NaN", "Infinity", "1e2", "2.001", "1,000.00", "1000000.01"]) {
    assert.throws(() => parseMoney(value));
  }
  assert.equal(money(null), "Por definir");
  assert.match(money(2800), /28\.00/);
});

test("dollar input accepts natural USD values with optional dollar sign without fractional cents", () => {
  for (const [value, expected] of [
    ["18.50", 1850], ["$18.50", 1850], ["21", 2100], ["21.00", 2100],
    ["$21", 2100], [" $18.50 ", 1850], ["$ 18.50", 1850], ["18,50", 1850],
    ["0", 0], ["$0.01", 1], ["0.29", 29], ["1.005", null],
    ["$1000000.00", 100000000], ["$1000000.01", null],
    ["", null], [" ", null], ["$", null], ["$-1", null], ["-18.50", null],
    ["18.501", null], ["18.", null], ["1e2", null], ["Infinity", null],
    ["NaN", null], ["21USD", null], ["$$21", null], ["21$", null],
    ["1,000.00", null], ["1.000,00", null], ["18 50", null],
  ]) {
    assert.equal(parseDollarInput(value), expected, value);
    if (expected !== null) assert.equal(Number.isInteger(parseDollarInput(value)), true);
  }
});

test("cents presentation is USD with two decimals and handles zero and negative margins", () => {
  for (const [cents, expected] of [[1850, "$18.50"], [2100, "$21.00"], [0, "$0.00"], [1, "$0.01"], [-250, "-$2.50"]]) {
    assert.equal(formatCents(cents), expected);
    assert.equal(money(cents), expected);
  }
  assert.equal(formatCents(100000000), "$1,000,000.00");
  for (const cents of [NaN, Infinity, 18.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => formatCents(cents));
  }
  for (const cents of [0, 1, 29, 1850, 2100, 99999]) {
    assert.equal(parseDollarInput(formatCents(cents).replaceAll(",", "")), cents);
  }
});

test("dollar quote input preserves integer-cent model, margin and session schema", () => {
  const ride = act(reviewing(), {
    type: "quote", providerCostCents: parseDollarInput("$18.50"), customerPriceCents: parseDollarInput("21"),
  });
  assert.deepEqual([ride.estimatedProviderCostCents, ride.customerPriceCents, ride.estimatedMarginCents], [1850, 2100, 250]);
  assert.deepEqual(decodeRideSession(JSON.stringify(addRide(emptyRideSession, ride))).requests[0], ride);
  assert.equal(ride.status, "quoted");
});

test("full sequence requires client approval, retains model data, and never mutates input", () => {
  const initial = fresh();
  let ride = initial;
  const actions = [
    { type: "review" },
    { type: "quote", providerCostCents: 2000, customerPriceCents: 2800 },
    { type: "approve" },
    { type: "book", providerReference: "DEMO-001" },
    { type: "assign", driverName: "Conductor Demo", vehicleDescription: "Auto ficticio", vehiclePlate: "DEMO-001" },
    { type: "advance" }, { type: "advance" }, { type: "advance" },
  ];
  const states = [ride.status];
  for (const action of actions) {
    ride = act(ride, action);
    states.push(ride.status);
    assert.deepEqual(decodeRideSession(JSON.stringify(addRide(emptyRideSession, ride))).requests[0], ride);
  }
  assert.deepEqual(states, rideSteps);
  assert.equal(ride.estimatedMarginCents, 800);
  assert.equal(ride.customerPriceCents, 2800);
  assert.equal(ride.status, "completed");
  assert.equal(ride.createdAt, now);
  assert.equal(ride.updatedAt, later);
  assert.equal(initial.status, "requested");
  assert.equal(canCancel(ride), false);
  assert.throws(() => act(ride, { type: "advance" }));
  assert.throws(() => act(ride, { type: "cancel" }));
});

test("rejects skipped steps, double approval, invalid quote and blank assignment", () => {
  assert.throws(() => act(fresh(), { type: "approve" }));
  assert.throws(() => act(fresh(), { type: "advance" }));
  assert.throws(() => act(fresh(), { type: "quote", providerCostCents: 1, customerPriceCents: 2 }));
  assert.throws(() => act(quoted(), { type: "book", providerReference: "DEMO" }));
  assert.throws(() => act(approved(), { type: "approve" }));
  assert.throws(() => act(approved(), { type: "quote", providerCostCents: 1, customerPriceCents: 2 }));
  assert.throws(() => act(approved(), { type: "book", providerReference: " " }));
  assert.throws(() => act(booked(), { type: "assign", driverName: "", vehicleDescription: "Demo", vehiclePlate: "DEMO" }));
  for (const price of [0, -1, NaN, 0.5, 100000001]) {
    assert.throws(() => act(reviewing(), { type: "quote", providerCostCents: 0, customerPriceCents: price }));
  }
  assert.throws(() => applyRideAction(fresh(), { type: "review" }, "invalid"));
  assert.throws(() => applyRideAction(fresh(), { type: "review" }, "2025-01-01T00:00:00Z"));
});

test("requotes recalculate margin, including an explicitly negative estimated margin", () => {
  const ride = act(quoted(), { type: "quote", providerCostCents: 3000, customerPriceCents: 2500 });
  assert.equal(ride.estimatedMarginCents, -500);
  assert.equal(ride.status, "quoted");
  assert.equal(act(ride, { type: "approve" }).customerPriceCents, 2500);
});

test("cancellation closes all pre-pickup states and cannot be undone", () => {
  for (const ride of [fresh(), reviewing(), quoted(), approved(), booked(), assigned(), act(assigned(), { type: "advance" })]) {
    const cancelled = act(ride, { type: "cancel" });
    assert.equal(cancelled.status, "cancelled");
    assert.equal(canCancel(cancelled), false);
    for (const type of ["review", "approve", "book", "assign", "advance", "cancel"]) {
      assert.throws(() => act(cancelled, { type }));
    }
  }
  const pickedUp = act(act(assigned(), { type: "advance" }), { type: "advance" });
  assert.equal(canCancel(pickedUp), false);
});

test("session reload retains all requests, current selection and updates only the targeted ride", () => {
  const first = addRide(emptyRideSession, fresh());
  const second = addRide(first, createRide(input, "RIDE-DEMO-2", now));
  assert.equal(second.currentRideId, "RIDE-DEMO-2");
  const updated = updateRide(second, "RIDE-DEMO-TEST", { type: "review" }, later);
  assert.deepEqual(decodeRideSession(JSON.stringify(updated)), updated);
  assert.deepEqual(updated.requests.map((ride) => ride.status), ["requested", "reviewing"]);
  assert.equal(updated.currentRideId, "RIDE-DEMO-2");
  assert.equal(first.requests[0].status, "requested");
  assert.throws(() => addRide(first, fresh()));
  assert.throws(() => updateRide(first, "MISSING", { type: "review" }, later));
  assert.deepEqual(decodeRideSession(null), emptyRideSession);
});

test("rejects corrupted storage rather than silently replacing it", () => {
  const valid = addRide(emptyRideSession, quoted());
  for (const raw of ["", "{", "null", "[]", '{"version":2}', JSON.stringify({ ...valid, currentRideId: "MISSING" }),
    JSON.stringify({ ...valid, requests: [fresh(), fresh()] })]) assert.throws(() => decodeRideSession(raw));
  for (const patch of [{ status: "unknown" }, { riderPhone: 123 }, { estimatedMarginCents: 999 },
    { scheduledAt: 123 }, { requestSource: "api" }, { customerPriceCents: null },
    { status: "driver_assigned", driverName: "", providerReference: "" }]) {
    assert.throws(() => decodeRideSession(JSON.stringify({ ...valid, requests: [{ ...quoted(), ...patch }] })));
  }
});

test("every page renders the permanent exact notice, brand and same-tab demo navigation on the server", () => {
  for (const component of [RideRequestDemo, RideStatusDemo, RideDispatcherDemo]) {
    const html = renderToStaticMarkup(createElement(component));
    assert.ok(html.includes(demoNotice));
    assert.match(html, /recogidoapplogo\.png/);
    for (const path of ["/rides/demo", "/rides/demo/status", "/admin/rides/demo"]) assert.ok(html.includes(`href="${path}"`));
    assert.ok(!html.includes('target="_blank"'));
    assert.ok(html.includes('lang="es"'));
  }
});

test("new demo has no API, external-service or persistent-storage integrations", () => {
  for (const path of [
    "../src/lib/rides/demo.ts", "../src/lib/rides/useRideDemo.ts", "../src/components/rides/RideDemo.tsx",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\blocalStorage\b|\bfetch\s*\(|XMLHttpRequest|sendBeacon|https?:\/\/|process\.env|\/api\//);
  }
});
