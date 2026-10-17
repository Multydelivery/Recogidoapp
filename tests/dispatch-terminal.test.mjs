import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ActiveDeliveriesSection } from "../src/components/dispatch/ActiveDeliveriesSection.tsx";
import { DeliveryRequestGroup } from "../src/components/dispatch/DeliveryRequestGroup.tsx";
import { ConfirmActionDialog } from "../src/components/dispatch/ConfirmActionDialog.tsx";
import { ConnectionBanner } from "../src/components/dispatch/ConnectionBanner.tsx";
import { DispatchSummary } from "../src/components/dispatch/DispatchSummary.tsx";
import { DeliveryHistorySection } from "../src/components/dispatch/DeliveryHistorySection.tsx";
import { NewDeliveryRequest } from "../src/components/dispatch/NewDeliveryRequest.tsx";
import { NotificationCenter } from "../src/components/dispatch/NotificationCenter.tsx";
import { DispatchApiError } from "../src/lib/dispatch/client.ts";
import {
  canCancelRequest,
  canResendRequest,
  cancelActionLabel,
  cancelConfirmationText,
  cancellationResultText,
  displayLabel,
  formatLastUpdate,
  formatDateTime,
  historyOutcome,
  partitionActive,
  shortRequestId,
  sortActiveRequests,
  sortHistory,
  summarizeActiveRequests,
} from "../src/lib/dispatch/dispatch-queue.ts";
import {
  announce,
  createSeenStore,
  DispatchTransitionTracker,
} from "../src/lib/dispatch/dispatch-notifications.ts";
import { createDispatchQueueController } from "../src/lib/dispatch/dispatch-queue-controller.ts";
import { activeQueuePollIntervalMs } from "../src/lib/dispatch/active-queue-poller.ts";
import {
  buildTimeline,
  deliveryOrders,
  formatOrderNumber,
  getDeliveryProgress,
  historyOrders,
  requestOrderNumber,
  summarizeDeliveryBoard,
} from "../src/lib/dispatch/delivery-progress.ts";
import { cleanOrderNumber, fallbackOrderNumber } from "../src/lib/dispatch/dispatch-types.ts";
import {
  readPendingAttempt,
  readSavedPin,
  removeSavedPin,
  savePin,
  terminalStorageKeys,
} from "../src/lib/dispatch/terminal-storage.ts";

const fakePin = "246810";
const fakePhone = "+15550100999";
const fakeBasicAuth = "Basic dXNlcjpzZWNyZXQ=";
const fakeInternalUrl = "https://internal.example.invalid/hook";
const allCapabilities = { canResend: true, canCancel: true };
const base = Date.parse("2025-01-15T15:00:00.000Z");
const iso = (offsetSeconds) => new Date(base + offsetSeconds * 1000).toISOString();

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.has(key) ? data.get(key) : null,
    setItem: (key, value) => { data.set(key, String(value)); },
    removeItem: (key) => { data.delete(key); },
    clear: () => { throw new Error("localStorage.clear() must never be used"); },
  };
}

function child(parentId, deliveryNumber, status, driverName) {
  return {
    requestId: `${parentId}_${deliveryNumber}`,
    deliveryNumber,
    status,
    ...(driverName ? { driverName, assignedAt: iso(30 + deliveryNumber) } : {}),
  };
}

function request(id, { status = "open", total = 2, assigned = 0, alerted = false, createdOffset = 0, updatedOffset = 0, drivers = [], childStatus } = {}) {
  const requestId = `WEB${id.padStart(12, "0")}`;
  const deliveries = Array.from({ length: total }, (_, index) => {
    const driver = drivers[index];
    const deliveryStatus = childStatus ?? (index < assigned ? (status === "closed" ? "closed" : "claimed") : status === "cancelled" ? "cancelled" : "open");
    return child(requestId, index + 1, deliveryStatus, index < assigned ? driver ?? `Conductor ${index + 1}` : undefined);
  });
  return {
    requestId,
    requestType: "parent",
    parentRequestId: requestId,
    deliveryCount: total,
    totalDeliveries: total,
    assignedDeliveries: assigned,
    remainingDeliveries: ["cancelled", "closed", "claimed", "fully_assigned"].includes(status) ? 0 : total - assigned,
    assignmentMode: "individual",
    status,
    childRequestIds: deliveries.map((delivery) => delivery.requestId),
    deliveries,
    createdAt: iso(createdOffset),
    updatedAt: iso(updatedOffset),
    ...(alerted ? { noDriverAlerted: true } : {}),
  };
}

function historyRecord(id, { status = "completed", total = 1, completed = 0, cancelled = 0, drivers = [], finalizedOffset = 600, createdOffset = 0 } = {}) {
  const requestId = `WEB${id.padStart(12, "0")}`;
  const deliveries = Array.from({ length: total }, (_, index) => {
    const deliveryStatus = index < completed ? "completed" : index < completed + cancelled ? "cancelled" : "assigned";
    const driverName = deliveryStatus === "completed" ? drivers[index] ?? `Conductor ${index + 1}` : undefined;
    return {
      requestId: `${requestId}_${index + 1}`,
      deliveryNumber: index + 1,
      status: deliveryStatus,
      ...(driverName ? { driverName, assignedAt: iso(createdOffset + 30) } : {}),
      finalizedAt: iso(finalizedOffset),
    };
  });
  return {
    requestId,
    restaurantId: "la-fonda",
    totalDeliveries: total,
    assignedDeliveries: completed,
    completedDeliveries: completed,
    cancelledDeliveries: cancelled,
    pendingDeliveries: 0,
    activeDeliveries: 0,
    status,
    driverNames: [...new Set(deliveries.flatMap((delivery) => delivery.driverName ? [delivery.driverName] : []))],
    createdAt: iso(createdOffset),
    finalizedAt: finalizedOffset === null ? null : iso(finalizedOffset),
    deliveries,
  };
}

function snapshot(req, history = []) {
  return {
    mockMode: true,
    restaurant: { slug: "la-fonda", name: "La Fonda", maxDeliveries: 3, maxActiveDeliveriesPerDriver: 2, assignmentMode: "individual" },
    request: req,
    history,
  };
}

function tracker(storage = memoryStorage()) {
  return new DispatchTransitionTracker(createSeenStore(storage, "recogido:dispatch-notified:la-fonda"));
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

function controllerHarness({ canLoadActive = true, canLoadHistory = true, hidden = false, storage } = {}) {
  const calls = { active: 0, status: [], history: 0 };
  const signals = [];
  const historySignals = [];
  const notifications = [];
  const states = [];
  const authErrors = [];
  const responses = { active: [], status: [], history: [] };
  const visibility = { hidden };
  const next = (queue, fallback) => {
    const value = queue.length > 1 ? queue.shift() : queue[0] ?? fallback;
    return typeof value === "function" ? value() : value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
  };
  const api = {
    active: (signal) => { calls.active += 1; signals.push(signal); return next(responses.active, { requests: [] }); },
    status: (requestId, signal) => { calls.status.push(requestId); signals.push(signal); return next(responses.status, snapshot(null)); },
    history: (signal) => { calls.history += 1; historySignals.push(signal); return next(responses.history, { restaurantId: "la-fonda", count: 0, requests: [] }); },
  };
  const controller = createDispatchQueueController({
    canLoadActive,
    canLoadHistory,
    tracker: tracker(storage),
    isHidden: () => visibility.hidden,
    now: () => base,
    onState: (state) => states.push(state),
    onAuthError: (error) => authErrors.push(error),
    onNotifications: (batch) => notifications.push(...batch),
    onSnapshot: () => {},
  });
  return { controller, api, calls, signals, historySignals, notifications, states, authErrors, responses, visibility };
}

const render = (component, props) => renderToStaticMarkup(createElement(component, props));
const SearchingSection = (props) => createElement(ActiveDeliveriesSection, {
  id: "searching", title: "Buscando conductor", emptyText: "No hay solicitudes buscando conductor.", loadingText: "Cargando solicitudes activas…", ...props,
});
const InProgressSection = (props) => createElement(ActiveDeliveriesSection, {
  id: "in-progress", title: "Entregas en curso", emptyText: "No hay entregas en curso.", loadingText: "Cargando entregas en curso…", nowMs: null, ...props,
});

function assertNoSecrets(text) {
  for (const secret of [fakePin, fakePhone, fakeBasicAuth, "dXNlcjpzZWNyZXQ", fakeInternalUrl, "internal.example"]) {
    assert.ok(!text.includes(secret), `Rendered output exposed ${secret}`);
  }
  for (const pattern of [/twilio\.com/i, /hook\.[a-z0-9]+\.make\.com/i, /Authorization/i, /\+1\d{10}/]) {
    assert.ok(!pattern.test(text), `Rendered output matched ${pattern}`);
  }
}

test("dispatch terminal", async (t) => {
  await t.test("PIN is stored per restaurant and disconnect removes only that restaurant's keys", () => {
    const storage = memoryStorage({
      "recogido:device-token:brisas": "999999",
      "recogido:dispatch-sound-muted:la-fonda": "1",
      unrelated: "keep",
    });
    assert.equal(readSavedPin(storage, "la-fonda"), null);
    savePin(storage, "la-fonda", fakePin);
    assert.equal(readSavedPin(storage, "la-fonda"), fakePin);
    storage.setItem(terminalStorageKeys("la-fonda").legacyPin, "legacy");
    savePin(storage, "la-fonda", fakePin);
    assert.equal(storage.getItem(terminalStorageKeys("la-fonda").legacyPin), null, "saving migrates the legacy key");

    const legacyOnly = memoryStorage({ "recogido.dispatch.device.jade-lee": " 135790 " });
    assert.equal(readSavedPin(legacyOnly, "jade-lee"), "135790", "automatic reconnection reads the legacy key");

    removeSavedPin(storage, "la-fonda");
    assert.equal(readSavedPin(storage, "la-fonda"), null);
    assert.equal(storage.getItem("recogido:device-token:brisas"), "999999");
    assert.equal(storage.getItem("recogido:dispatch-sound-muted:la-fonda"), "1");
    assert.equal(storage.getItem("unrelated"), "keep");

    storage.setItem(terminalStorageKeys("la-fonda").pendingAttempt, JSON.stringify({ key: "abcdefgh-1234", count: 2 }));
    assert.deepEqual(readPendingAttempt(storage, "la-fonda"), { key: "abcdefgh-1234", count: 2 });
    storage.setItem(terminalStorageKeys("la-fonda").pendingAttempt, JSON.stringify({ key: "x", count: 99 }));
    assert.equal(readPendingAttempt(storage, "la-fonda"), null);

    const terminal = readFileSync("src/components/dispatch/DispatchTerminal.tsx", "utf8");
    assert.ok(!/localStorage\.clear|sessionStorage\.clear/.test(terminal));
    assert.match(terminal, /function disconnect\(\) \{\s*clearQueue\(\);\s*resetSession\(null\);/);
    assert.match(terminal, /const resetSession = useCallback[\s\S]*?controller\.current\?\.abort\(\);[\s\S]*?removeSavedPin\(\);[\s\S]*?setToken\(null\);[\s\S]*?setPin\(""\);/);
  });

  await t.test("disconnect clears the queue state, aborts the pending fetch and stops polling", async (st) => {
    st.mock.timers.enable({ apis: ["setTimeout"] });
    const h = controllerHarness();
    let release;
    h.responses.active.push(() => new Promise((resolve) => { release = resolve; }));
    h.controller.start(h.api);
    await flush();
    assert.equal(h.calls.active, 1);
    h.controller.clear();
    assert.equal(h.signals[0].aborted, true, "AbortController aborted on disconnect");
    release({ requests: [request("1")] });
    await flush();
    assert.deepEqual(h.controller.getState().active, []);
    assert.equal(h.controller.getState().lastUpdated, null);
    st.mock.timers.tick(60_000);
    await flush();
    assert.equal(h.calls.active, 1, "no polling after disconnect");
  });

  await t.test("empty queue is distinct from a connection error", async () => {
    const h = controllerHarness();
    h.responses.active.push({ requests: [] });
    h.controller.start(h.api);
    await flush();
    const state = h.controller.getState();
    assert.deepEqual(state.active, []);
    assert.equal(state.error, null);
    assert.notEqual(state.lastUpdated, null);
    h.controller.stop();
    const html = render(SearchingSection, { requests: state.active, nowMs: base, hasLoaded: true });
    assert.ok(html.includes("No hay solicitudes buscando conductor."));
    assert.ok(!html.includes("No se pudo cargar"));
    const failed = render(SearchingSection, { requests: [], nowMs: base, hasLoaded: false, unavailable: true });
    assert.ok(failed.includes("No se pudo cargar la cola"));
    assert.ok(!failed.includes("No hay solicitudes buscando conductor"));
  });

  await t.test("multiple requests are sorted by urgency, then newest first", () => {
    const openOld = request("1", { createdOffset: 0 });
    const openNew = request("2", { createdOffset: 60 });
    const partial = request("3", { status: "partially_claimed", assigned: 1, createdOffset: 10 });
    const alerted = request("4", { alerted: true, createdOffset: 5 });
    const alertedNewer = request("5", { alerted: true, createdOffset: 50 });
    const sorted = sortActiveRequests([openOld, partial, openNew, alerted, alertedNewer]);
    assert.deepEqual(sorted.map((item) => item.requestId), [alertedNewer, alerted, partial, openNew, openOld].map((item) => item.requestId));

    const html = render(SearchingSection, { requests: sorted, nowMs: base + 90_000, hasLoaded: true });
    const positions = sorted.map((item) => html.indexOf(`SOLICITUD ${formatOrderNumber(requestOrderNumber(item))}`));
    assert.ok(positions.every((position) => position >= 0));
    assert.deepEqual([...positions].sort((a, b) => a - b), positions, "cards render in urgency order");
    assert.ok(html.includes(">5<"), "active count shown");
    assert.ok(!html.includes(openOld.requestId), "full ID is not used as the card title");
    assert.ok(!/WEB/.test(html), "no internal request ID in the HTML");
  });

  await t.test("status labels for open, no_driver_alerted, partially_claimed, fully_assigned, completed and cancelled", () => {
    const cases = [
      [request("10"), "Buscando conductor"],
      [request("11", { alerted: true }), "Sin respuesta — sigue disponible"],
      [request("12", { status: "partially_claimed", assigned: 1, total: 3 }), "Asignación parcial"],
      [request("13", { status: "claimed", assigned: 2 }), "Todas asignadas"],
      [request("14", { status: "fully_assigned", assigned: 2 }), "Todas asignadas"],
      [request("15", { status: "closed", assigned: 2 }), "Entrega completada"],
      [request("16", { status: "cancelled" }), "Solicitud cancelada"],
    ];
    for (const [item, label] of cases) {
      assert.equal(displayLabel(item), label);
      const html = render(DeliveryRequestGroup, { request: item, nowMs: base + 125_000 });
      assert.ok(html.includes(label), `card missing ${label}`);
      assert.ok(html.includes("Hace 2 min"), "elapsed time shown");
      assert.ok(html.includes("<progress"), "progress bar shown");
      assert.ok(html.includes(`Entrega 1 de ${item.totalDeliveries}`));
      assert.ok(!/WEB/.test(html), "no internal request ID in the HTML");
    }

    const open = request("20", { total: 3 });
    for (const delivery of open.deliveries) {
      assert.equal(delivery.driverName, undefined, "open children carry no winnerName");
      assert.equal(delivery.assignedAt, undefined, "open children carry no claimedAt");
    }
    const openHtml = render(DeliveryRequestGroup, { request: open, nowMs: base });
    assert.ok(openHtml.includes("Entrega 3 de 3"));
    assert.ok(!openHtml.includes("Conductor:"), "no driver shown for open deliveries");

    const partial = request("21", { status: "partially_claimed", assigned: 1, total: 3, drivers: ["Ana"] });
    const partialHtml = render(DeliveryRequestGroup, { request: partial, nowMs: base });
    assert.ok(partialHtml.includes("Conductor: <strong>Ana</strong>"));
    assert.ok(partialHtml.includes("1 de 3 asignadas"));
    assert.equal((partialHtml.match(/Conductor: /g) ?? []).length, 1, "driver only on the assigned delivery");

    const alertedHtml = render(DeliveryRequestGroup, { request: request("22", { alerted: true }), nowMs: base });
    assert.ok(alertedHtml.includes("La solicitud continúa disponible. Recogido está buscando un conductor."));
    assert.ok(alertedHtml.includes("<svg"), "status uses an icon, not only color");
  });

  await t.test("summary shows Buscando, Asignadas, En camino and Completadas hoy", () => {
    const active = [
      request("30", { total: 2 }),
      request("31", { status: "partially_claimed", total: 3, assigned: 1 }),
      request("32", { status: "closed", total: 2, assigned: 2 }),
      request("33", { status: "cancelled", total: 4 }),
    ];
    const counts = summarizeDeliveryBoard(active, [], base);
    assert.equal(counts.searching, 4, "searching counts pending deliveries of active requests only");
    assert.equal(counts.onTheWay, 0);
    const html = render(DispatchSummary, { counts });
    for (const label of ["Buscando", "Asignadas", "En camino", "Completadas hoy"]) assert.ok(html.includes(label));
  });

  await t.test("new request card offers large numeric buttons up to maxDeliveries", () => {
    const html = render(NewDeliveryRequest, {
      maxDeliveries: 4, assignmentMode: "individual", selected: 2, submitting: false,
      onSelect() {}, onSubmit() {},
    });
    assert.ok(html.includes("Nueva solicitud de entrega"));
    assert.ok(html.includes("Seleccione cuántas entregas necesita"));
    assert.ok(html.includes("SOLICITAR CONDUCTOR"));
    assert.equal((html.match(/aria-pressed="/g) ?? []).length, 4);
    assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
    assert.ok(!html.includes("spinner"), "no spinner when idle");
    const css = readFileSync("src/components/dispatch/DispatchTerminal.module.css", "utf8");
    assert.match(css, /\.terminal button \{[^}]*min-height: 48px;[^}]*min-width: 48px;/);
    assert.match(css, /:focus-visible/);
  });

  await t.test("actions only appear when the backend supports them", () => {
    const open = request("40", { total: 2 });
    const full = request("41", { status: "claimed", assigned: 2 });
    assert.equal(canResendRequest(open, allCapabilities), true);
    assert.equal(canCancelRequest(open, allCapabilities), true);
    assert.equal(canResendRequest(open, { canResend: false }), false);
    assert.equal(canCancelRequest(open, { canCancel: false }), false);
    assert.equal(canResendRequest(full, allCapabilities), false);
    assert.equal(canCancelRequest(full, allCapabilities), false);

    const actions = (overrides = {}) => ({
      canResend: true, canCancel: true, busyAction: null, disabled: false, onResend() {}, onCancel() {}, ...overrides,
    });
    const html = render(DeliveryRequestGroup, { request: open, nowMs: base, actions: actions() });
    assert.ok(html.includes("VOLVER A OFRECER"));
    assert.ok(html.includes("CANCELAR SOLICITUD"));
    assert.ok(!html.includes("ASIGNAR OTRA"), "future capability stays hidden");
    const none = render(DeliveryRequestGroup, { request: open, nowMs: base, actions: actions({ canResend: false, canCancel: false }) });
    assert.ok(!none.includes("VOLVER A OFRECER") && !none.includes("CANCELAR SOLICITUD"));
    const busy = render(DeliveryRequestGroup, { request: open, nowMs: base, actions: actions({ busyAction: "cancel", disabled: true }) });
    assert.ok(busy.includes("Cancelando…"));
    assert.ok(busy.includes('aria-busy="true"') && /<button[^>]*disabled=""[^>]*>[^<]*<span[^>]*><\/span>Cancelando…/.test(busy), "disabled while cancelling");
    const future = render(DeliveryRequestGroup, {
      request: open, nowMs: base, actions: actions({ assignAnother: { driverName: "Ana", onAssign() {} } }),
    });
    assert.ok(future.includes("ASIGNAR OTRA A ANA"), "renders only when a real capability provides it");
  });

  await t.test("cancellation requires confirmation and is applied only after the server responds", () => {
    const terminal = readFileSync("src/components/dispatch/DispatchTerminal.tsx", "utf8");
    assert.match(terminal, /onCancel: \(\) => setConfirm\(\{ kind: "cancel", request \}\)/, "card cancel opens the dialog");
    assert.match(terminal, /onConfirm=\{\(\) => \{ if \(cancelTarget\) void mutate\("cancel", cancelTarget\); \}\}/);
    assert.match(terminal, /confirmLabel=\{busyAction\?\.kind === "cancel" \? "Cancelando…" : "CANCELAR PENDIENTES"\}/);
    assert.match(terminal, /cancelLabel="VOLVER"/);
    assert.match(terminal, /const data = await dispatchApi\(kind,[\s\S]*?applyServerRequest\(returned, false, \{ silent: true \}\)/, "state changes only after the response");
    assert.match(terminal, /if \(busy\.current \|\| !token/, "double submit guard");
    assert.ok(!/window\.confirm/.test(terminal));

    const closed = render(ConfirmActionDialog, { open: false, title: "x", description: "y", confirmLabel: "z", onConfirm() {}, onCancel() {} });
    assert.equal(closed, "");
    const partial = request("40", { status: "partially_claimed", total: 3, assigned: 1 });
    const dialog = render(ConfirmActionDialog, {
      open: true, title: "¿Cancelar entregas pendientes de la solicitud #000040?", description: cancelConfirmationText(partial),
      confirmLabel: "CANCELAR PENDIENTES", cancelLabel: "VOLVER", tone: "danger", onConfirm() {}, onCancel() {},
    });
    assert.ok(dialog.includes("<dialog") && dialog.includes("CANCELAR PENDIENTES") && dialog.includes("VOLVER"));
    assert.ok(dialog.includes("Se cancelarán 2 entregas pendientes.") && dialog.includes("La entrega ya asignada no será afectada."));
    assert.ok(dialog.includes('aria-labelledby="confirm-dialog-title"'));

    const h = controllerHarness();
    const open = request("40", { total: 2 });
    h.controller.seed(open);
    assert.equal(h.notifications.length, 0, "seeding is silent");
    h.controller.applyServerRequest(request("40", { status: "cancelled", total: 2, updatedOffset: 5 }));
    assert.deepEqual(h.controller.getState().active, []);
    assert.equal(h.controller.getState().finished[0].status, "cancelled");
    assert.deepEqual(h.notifications.map((item) => item.kind), ["cancelled"]);
  });

  await t.test("cancel button label follows pending deliveries and hides when nothing is pending", () => {
    const actions = { canResend: false, canCancel: true, busyAction: null, disabled: false, onResend() {}, onCancel() {} };
    const open = request("42", { total: 3 });
    const partialMany = request("43", { status: "partially_claimed", total: 3, assigned: 1 });
    const partialOne = request("44", { status: "partially_claimed", total: 2, assigned: 1 });
    const full = request("45", { status: "fully_assigned", total: 2, assigned: 2 });
    assert.equal(cancelActionLabel(open), "CANCELAR SOLICITUD");
    assert.equal(cancelActionLabel(partialMany), "CANCELAR 2 PENDIENTES");
    assert.equal(cancelActionLabel(partialOne), "CANCELAR 1 PENDIENTE");
    assert.ok(render(DeliveryRequestGroup, { request: partialMany, nowMs: base, actions }).includes("CANCELAR 2 PENDIENTES"));
    assert.equal(full.remainingDeliveries, 0);
    assert.equal(canCancelRequest(full, allCapabilities), false, "pendingDeliveries 0 never offers cancellation");
    const fullHtml = render(DeliveryRequestGroup, { request: full, nowMs: base, actions: { ...actions, canCancel: canCancelRequest(full, allCapabilities) } });
    assert.ok(!/CANCELAR/.test(fullHtml));
    assert.equal(cancelConfirmationText(open), "Se cancelarán 3 entregas pendientes. Esta solicitud no tiene entregas asignadas.");
    assert.equal(cancellationResultText(3), "Se cancelaron 3 entregas pendientes.");
    assert.equal(cancellationResultText(1), "Se canceló 1 entrega pendiente.");
    assert.equal(cancellationResultText(0), "La solicitud ya no tiene entregas pendientes.");
    const css = readFileSync("src/components/dispatch/DispatchTerminal.module.css", "utf8");
    assert.match(css, /\.dangerOutlineButton \{[^}]*min-height: 48px/);
  });

  await t.test("confirmed cancellation refreshes the queue immediately and shows no repeated toasts", async () => {
    const h = controllerHarness();
    const partial = request("46", { status: "partially_claimed", total: 3, assigned: 1, updatedOffset: 1 });
    const other = request("47", { total: 1 });
    h.responses.active.push({ requests: [partial, other] });
    h.controller.start(h.api);
    await flush();
    const callsBefore = h.calls.active;
    const cancelled = { ...request("46", { status: "cancelled", total: 3, assigned: 1, updatedOffset: 9 }) };
    h.responses.active.length = 0;
    h.responses.active.push({ requests: [other] });
    h.controller.applyServerRequest(cancelled, false, { silent: true });
    await flush();
    assert.equal(h.calls.active, callsBefore + 1, "one immediate queue fetch, no wait for the interval");
    assert.deepEqual(h.controller.getState().active.map((item) => item.requestId), [other.requestId]);
    assert.deepEqual(h.notifications, [], "the terminal shows its own single message");
    for (let index = 0; index < 3; index += 1) await h.controller.refresh();
    assert.deepEqual(h.notifications, [], "identical polls never re-announce the cancellation");
    assert.equal(h.calls.status.length, 0, "never a per-card fetch");
    h.controller.stop();
  });

  await t.test("connection errors keep the last valid data and only announce real transitions", async () => {
    const h = controllerHarness();
    const first = [request("50"), request("51", { status: "partially_claimed", assigned: 1 })];
    h.responses.active.push({ requests: first }, new DispatchApiError(0, "fetch failed"), new DispatchApiError(503, "Servicio no disponible"), { requests: first });
    h.controller.start(h.api);
    await flush();
    assert.equal(h.controller.getState().active.length, 2);
    await h.controller.refresh();
    let state = h.controller.getState();
    assert.equal(state.active.length, 2, "queue not emptied by a temporary error");
    assert.equal(state.error, "El servidor no respondió.");
    await h.controller.refresh();
    state = h.controller.getState();
    assert.equal(state.active.length, 2);
    assert.equal(state.error, "Servicio no disponible");
    assert.deepEqual(h.notifications.map((item) => item.kind), ["connection_lost"], "lost announced once");
    await h.controller.refresh();
    assert.equal(h.controller.getState().error, null);
    assert.deepEqual(h.notifications.map((item) => item.kind), ["connection_lost", "connection_restored"]);
    h.controller.stop();

    const banner = render(ConnectionBanner, { message: "El servidor no responde. Se muestran los últimos datos recibidos.", lastUpdateLabel: formatLastUpdate(base, base + 42_000), retrying: false, onRetry() {} });
    assert.ok(banner.includes('role="alert"'));
    assert.ok(banner.includes("Reintentar"));
    assert.ok(banner.includes("Última actualización: hace 42 segundos"));
  });

  await t.test("auth failures during polling are reported to the terminal", async () => {
    const h = controllerHarness();
    h.responses.active.push(new DispatchApiError(401, "Token o PIN inválido"));
    h.controller.start(h.api);
    await flush();
    assert.equal(h.authErrors.length, 1);
    assert.equal(h.controller.getState().error, null);
    h.controller.stop();
  });

  await t.test("notifications are deduplicated by requestId + status + updatedAt across trackers in the session", () => {
    const storage = memoryStorage();
    const before = request("60", { updatedOffset: 1 });
    const after = request("60", { status: "partially_claimed", assigned: 1, updatedOffset: 9 });
    const first = tracker(storage);
    first.observe([before]);
    assert.deepEqual(first.observe([after]).map((item) => item.kind), ["assigned"]);
    assert.deepEqual(first.observe([after]), []);

    const reloaded = tracker(storage);
    reloaded.observe([before]);
    assert.deepEqual(reloaded.observe([after]), [], "same transition is not announced twice in the session");
    const stored = JSON.parse(storage.getItem("recogido:dispatch-notified:la-fonda"));
    assert.ok(stored.some((key) => key.includes("WEB000000000060") && key.includes("partially_claimed") && key.includes(iso(9))));

    const bounded = createSeenStore(memoryStorage(), "k", 3);
    for (const key of ["a", "b", "c", "d"]) bounded.add(key);
    assert.equal(bounded.size(), 3);
    assert.equal(bounded.has("a"), false);
  });

  await t.test("identical polling produces no toast and no sound", async () => {
    const h = controllerHarness();
    const same = [request("70"), request("71", { alerted: true })];
    h.responses.active.push({ requests: same });
    h.controller.start(h.api);
    await flush();
    for (let index = 0; index < 4; index += 1) await h.controller.refresh();
    assert.equal(h.calls.active, 5);
    assert.deepEqual(h.notifications, [], "baseline and identical polls stay silent");
    h.controller.stop();
  });

  await t.test("each transition plays its sound only once and respects mute", async () => {
    const h = controllerHarness();
    const open = request("80", { total: 2 });
    const alerted = request("80", { total: 2, alerted: true, updatedOffset: 20 });
    const assigned = request("80", { status: "partially_claimed", total: 2, assigned: 1, updatedOffset: 30 });
    h.responses.active.push({ requests: [open] }, { requests: [alerted] }, { requests: [alerted] }, { requests: [assigned] }, { requests: [assigned] });
    h.controller.start(h.api);
    await flush();
    const played = [];
    const pushed = [];
    const run = (muted = false) => {
      const batch = h.notifications.splice(0);
      announce(batch, { muted, play: (sound) => played.push(sound), push: (items) => pushed.push(...items) });
    };
    for (let index = 0; index < 4; index += 1) {
      await h.controller.refresh();
      run();
    }
    assert.deepEqual(played, ["attention", "positive"]);
    assert.deepEqual(pushed.map((item) => item.kind), ["no_driver", "assigned"]);

    const completedPlayed = [];
    announce(tracker().resolved(request("81")), { muted: false, play: (sound) => completedPlayed.push(sound), push() {} });
    const states = tracker();
    states.seed([request("82", { status: "claimed", assigned: 2 })]);
    const completed = states.resolved(request("82", { status: "closed", assigned: 2, updatedOffset: 99 }));
    announce(completed, { muted: false, play: (sound) => completedPlayed.push(sound), push() {} });
    assert.deepEqual(completedPlayed, ["complete"]);

    const muted = [];
    const mutedStates = tracker();
    mutedStates.seed([request("83")]);
    const toasts = [];
    announce(mutedStates.update(request("83", { status: "partially_claimed", assigned: 1, updatedOffset: 3 })), {
      muted: true, play: (sound) => muted.push(sound), push: (items) => toasts.push(...items),
    });
    assert.deepEqual(muted, [], "muted terminals never play sounds");
    assert.equal(toasts.length, 1, "toasts still appear while muted");
    h.controller.stop();
  });

  await t.test("one query refreshes the whole queue", async () => {
    const active = controllerHarness();
    active.responses.active.push({ requests: [request("90"), request("91"), request("92")] });
    active.controller.start(active.api);
    await flush();
    await active.controller.refresh();
    assert.equal(active.calls.active, 2, "one active query per refresh, never one per card");
    assert.deepEqual(active.calls.status, []);
    active.controller.stop();

    const fallback = controllerHarness({ canLoadActive: false });
    fallback.controller.start(fallback.api);
    await flush();
    assert.equal(fallback.calls.status.length, 0, "nothing to poll without a tracked request");
    const tracked = request("93");
    fallback.responses.status.push(snapshot(tracked));
    fallback.controller.seed(tracked);
    await fallback.controller.refresh();
    await fallback.controller.refresh();
    assert.deepEqual(fallback.calls.status, [tracked.requestId, tracked.requestId]);
    assert.equal(fallback.calls.active, 0);
    fallback.controller.stop();
  });

  await t.test("polls every 4 seconds while active and stops when the queue is empty", async (st) => {
    st.mock.timers.enable({ apis: ["setTimeout"] });
    const h = controllerHarness();
    h.responses.active.push({ requests: [request("100")] }, { requests: [request("100")] }, { requests: [] });
    h.controller.start(h.api);
    await flush();
    assert.equal(h.calls.active, 1);
    st.mock.timers.tick(activeQueuePollIntervalMs - 1);
    await flush();
    assert.equal(h.calls.active, 1);
    st.mock.timers.tick(1);
    await flush();
    assert.equal(h.calls.active, 2);
    st.mock.timers.tick(activeQueuePollIntervalMs);
    await flush();
    assert.equal(h.calls.active, 3);
    st.mock.timers.tick(60_000);
    await flush();
    assert.equal(h.calls.active, 3, "polling stops once the queue is empty");
    h.controller.applyServerRequest(request("101"), true);
    await flush();
    assert.equal(h.calls.active, 4, "immediate refresh after a confirmed mutation");
    h.controller.stop();
  });

  await t.test("hidden tabs pause polling and visible tabs refresh immediately", async (st) => {
    st.mock.timers.enable({ apis: ["setTimeout"] });
    const h = controllerHarness({ hidden: true });
    h.responses.active.push({ requests: [request("110")] });
    h.controller.start(h.api);
    await flush();
    assert.equal(h.calls.active, 0);
    st.mock.timers.tick(30_000);
    await flush();
    assert.equal(h.calls.active, 0);
    h.visibility.hidden = false;
    h.controller.visibilityChanged();
    await flush();
    assert.equal(h.calls.active, 1);
    h.visibility.hidden = true;
    st.mock.timers.tick(5_000);
    await flush();
    assert.equal(h.calls.active, 1, "no polling while hidden");
    h.controller.stop();
  });

  await t.test("concurrent refreshes are coalesced and stop() aborts and clears timers", async (st) => {
    st.mock.timers.enable({ apis: ["setTimeout"] });
    const h = controllerHarness();
    let release;
    h.responses.active.push(() => new Promise((resolve) => { release = resolve; }), { requests: [request("120")] });
    h.controller.start(h.api);
    void h.controller.refresh();
    void h.controller.refresh();
    await flush();
    assert.equal(h.calls.active, 1, "no concurrent requests");
    release({ requests: [request("120")] });
    await flush();
    await flush();
    assert.equal(h.calls.active, 2, "one queued refresh after the in-flight one");
    h.controller.stop();
    assert.ok(h.signals.every((signal) => signal.aborted));
    st.mock.timers.tick(60_000);
    await flush();
    assert.equal(h.calls.active, 2);

    const hook = readFileSync("src/components/dispatch/useDispatchQueue.ts", "utf8");
    assert.match(hook, /return \(\) => \{\s*document\.removeEventListener\("visibilitychange", onVisibility\);\s*controller\.stop\(\);/);
  });

  await t.test("rendered terminal pieces never expose secrets", () => {
    const leaky = {
      ...request("130", { status: "partially_claimed", assigned: 1, drivers: ["Ana"] }),
      restaurantPhone: fakePhone, deviceToken: fakePin, authorization: fakeBasicAuth, webhookUrl: fakeInternalUrl,
    };
    const html = [
      render(SearchingSection, { requests: [leaky], finished: [request("131", { status: "closed", assigned: 2 })], nowMs: base, hasLoaded: true }),
      render(DeliveryHistorySection, { records: [{ ...historyRecord("132", { status: "completed", total: 2, completed: 2, drivers: ["Ana"] }), restaurantPhone: fakePhone, deviceToken: fakePin }], available: true, loaded: true }),
      render(DeliveryHistorySection, { records: [], available: false, loaded: false }),
      render(InProgressSection, { requests: [{ ...request("133", { status: "fully_assigned", assigned: 2, drivers: ["Ana", "Luis"] }), restaurantPhone: fakePhone }], hasLoaded: true }),
      render(NotificationCenter, { notifications: [{ id: "1", kind: "assigned", tone: "success", title: "Conductor asignado" }], onDismiss() {} }),
    ].join("\n");
    assertNoSecrets(html);
    assert.ok(html.includes('aria-live="polite"'));
    assert.ok(html.includes("El historial real estará disponible próximamente."));

    const directory = "src/components/dispatch";
    const sources = [
      ...readdirSync(directory).filter((name) => /\.(tsx?|css)$/.test(name)).map((name) => `${directory}/${name}`),
      "src/lib/dispatch/dispatch-queue.ts", "src/lib/dispatch/dispatch-notifications.ts",
      "src/lib/dispatch/dispatch-queue-controller.ts", "src/lib/dispatch/dispatch-sounds.ts", "src/lib/dispatch/terminal-storage.ts",
    ];
    for (const file of sources.filter((name) => !name.endsWith("DispatchDemo.tsx"))) {
      const source = readFileSync(file, "utf8");
      assert.ok(!/console\.(log|info|debug)\(/.test(source), `${file} logs to the console`);
      assert.ok(!/twilio\.com|make\.com|whatsapp\.com|Basic /i.test(source), `${file} references an external service or credential`);
    }
  });
});

test("dispatch dashboard sections and real history", async (t) => {
  const cardActions = (overrides = {}) => ({
    canResend: false, canCancel: true, busyAction: null, disabled: false, onResend() {}, onCancel() {}, ...overrides,
  });
  const fullyAssigned = (id, drivers = ["Ana", "Luis"]) => {
    const item = request(id, { status: "fully_assigned", total: 2, assigned: 2, drivers });
    return { ...item, completedDeliveries: 0, activeDeliveries: 2 };
  };

  await t.test("an open request is shown in Buscando conductor with a cancel action and the 20-second warning", () => {
    const open = request("200", { total: 2 });
    const board = partitionActive([open]);
    assert.deepEqual(board.searching.map((item) => item.requestId), [open.requestId]);
    assert.deepEqual(board.inProgress, []);
    const html = render(SearchingSection, { requests: board.searching, nowMs: base + 25_000, hasLoaded: true, actionsFor: () => cardActions() });
    assert.ok(html.includes("Buscando conductor"));
    assert.ok(html.includes("CANCELAR SOLICITUD"));
    assert.ok(html.includes("Han pasado más de 20 segundos"), "warning after 20 s without a driver");
    const fresh = render(SearchingSection, { requests: board.searching, nowMs: base + 5_000, hasLoaded: true });
    assert.ok(!fresh.includes("Han pasado más de 20 segundos"), "no warning before 20 s");
  });

  await t.test("partially_claimed with a pending delivery stays in Buscando conductor", () => {
    const partial = request("201", { status: "partially_claimed", total: 3, assigned: 1, drivers: ["Ana"] });
    const board = partitionActive([partial]);
    assert.equal(board.searching.length, 1);
    assert.equal(board.inProgress.length, 0);
    const html = render(SearchingSection, { requests: board.searching, nowMs: base, hasLoaded: true, actionsFor: () => cardActions() });
    assert.ok(html.includes("Asignación parcial"));
    assert.ok(html.includes("CANCELAR 2 PENDIENTES"));
    assert.deepEqual(summarizeActiveRequests([partial]), { searching: 1, assigned: 1, pending: 2 });
  });

  await t.test("fully_assigned is shown in Entregas en curso without cancel and never as completed", () => {
    const full = fullyAssigned("202");
    const board = partitionActive([full, request("203")]);
    assert.deepEqual(board.inProgress.map((item) => item.requestId), [full.requestId]);
    assert.equal(board.searching.length, 1);
    const html = render(InProgressSection, { requests: board.inProgress, hasLoaded: true });
    for (const label of ["Entregas en curso", "Conductor: <strong>Ana</strong>", "Conductor: <strong>Luis</strong>", "2 de 2 asignadas", "El conductor se dirige al restaurante."]) {
      assert.ok(html.includes(label), `missing ${label}`);
    }
    assert.ok(!html.includes("CANCELAR"), "no cancel button when nothing is pending");
    assert.ok(!html.includes('data-phase="completed"'), "fully_assigned is not completed");
    assert.ok(!/data-step="completed"[^>]*data-state="complete"|data-state="complete"[^>]*data-step="completed"/.test(html), "completion step not checked");
    assert.ok(!html.includes(full.requestId), "short ID only");
    assert.ok(render(InProgressSection, { requests: [], hasLoaded: true }).includes("No hay entregas en curso."));
    assert.ok(render(SearchingSection, { requests: [], nowMs: base, hasLoaded: true }).includes("No hay solicitudes buscando conductor."));
  });

  await t.test("completed and cancelled requests appear in the history with totals, drivers and short IDs", () => {
    const completed = historyRecord("210", { status: "completed", total: 2, completed: 2, drivers: ["Ana", "Luis"] });
    const cancelled = historyRecord("211", { status: "cancelled", total: 3, cancelled: 3, finalizedOffset: 900 });
    const html = render(DeliveryHistorySection, { records: sortHistory([completed, cancelled]), available: true, loaded: true });
    assert.ok(html.includes("Completada"));
    assert.ok(html.includes("Cancelada"));
    assert.ok(html.includes("Conductores: Ana, Luis"));
    assert.ok(html.includes("Sin conductor asignado"));
    assert.ok(html.includes(shortRequestId(completed.requestId)));
    assert.ok(!html.includes(completed.requestId), "full ID is not shown");
    assert.ok(html.includes("<details"), "children can be expanded");
    assert.ok(html.includes("Ver detalles"));
    assert.ok(html.includes("Entrega 1 de 2"));
    assert.ok(html.indexOf(shortRequestId(cancelled.requestId)) < html.indexOf(shortRequestId(completed.requestId)), "newest finalized first");
    assert.equal(historyOutcome(completed), "completed");
    assert.equal(historyOutcome(cancelled), "cancelled");
  });

  await t.test("a mixed completed/cancelled request is shown as partially completed but keeps its status", () => {
    const mixed = historyRecord("212", { status: "completed", total: 3, completed: 2, cancelled: 1 });
    assert.equal(historyOutcome(mixed), "partially_completed");
    assert.equal(mixed.status, "completed", "original status preserved");
    const html = render(DeliveryHistorySection, { records: [mixed], available: true, loaded: true });
    assert.ok(html.includes("Completada parcialmente"));
    assert.ok(/Canceladas<\/dt><dd>1</.test(html));
    assert.ok(/Completadas<\/dt><dd>2</.test(html));
    assert.equal(historyOutcome({ ...mixed, status: "fully_assigned" }), "in_progress", "non-final records never count as history");
  });

  await t.test("dates use Intl.DateTimeFormat in America/New_York and tolerate null or invalid values", () => {
    const winter = formatDateTime("2025-01-15T15:00:00.000Z");
    assert.match(winter, /10:00/);
    assert.match(winter, /15/);
    assert.match(winter, /ene/i);
    assert.match(winter, /2025/);
    assert.match(formatDateTime("2025-07-15T15:00:00.000Z"), /11:00/, "daylight saving time applied");
    assert.equal(formatDateTime(null), "Fecha no disponible");
    assert.equal(formatDateTime("not-a-date"), "Fecha no disponible");
    const html = render(DeliveryHistorySection, { records: [{ ...historyRecord("213"), finalizedAt: null }], available: true, loaded: true });
    assert.ok(html.includes("Solicitud"), "null finalizedAt does not break rendering");
  });

  await t.test("history shows 10 records first and VER MÁS reveals more without refetching", () => {
    const records = sortHistory(Array.from({ length: 25 }, (_, index) =>
      historyRecord(String(300 + index), { status: "completed", completed: 1, finalizedOffset: 1000 + index })));
    const html = render(DeliveryHistorySection, { records, available: true, loaded: true });
    assert.equal((html.match(/data-outcome=/g) ?? []).length, 10);
    assert.ok(html.includes("VER MÁS"));
    assert.ok(html.includes("Mostrando 10 de 25 solicitudes"));
    assert.ok(html.indexOf(shortRequestId(records[0].requestId)) < html.indexOf(shortRequestId(records[1].requestId)));
    const more = render(DeliveryHistorySection, { records, available: true, loaded: true, initialVisible: 30 });
    assert.equal((more.match(/data-outcome=/g) ?? []).length, 25);
    assert.ok(!more.includes("VER MÁS"));
    const source = readFileSync("src/components/dispatch/DeliveryHistorySection.tsx", "utf8");
    assert.match(source, /setVisible\(\(count\) => count \+ historyPageSize\)/, "VER MÁS only grows the visible slice");
  });

  await t.test("empty, loading and unavailable history states", () => {
    assert.ok(render(DeliveryHistorySection, { records: [], available: true, loaded: true }).includes("Todavía no hay entregas en el historial."));
    assert.ok(render(DeliveryHistorySection, { records: [], available: true, loaded: false }).includes("Cargando historial"));
    const unavailable = render(DeliveryHistorySection, { records: [], available: false, loaded: false });
    assert.ok(unavailable.includes("El historial real estará disponible próximamente."));
    assert.ok(!unavailable.includes("ACTUALIZAR HISTORIAL"));
    const manual = render(DeliveryHistorySection, { records: [], available: true, loaded: true, onRefresh() {} });
    assert.ok(manual.includes("ACTUALIZAR HISTORIAL"));
  });

  await t.test("a failed history update keeps the previous records and shows a discreet message", async () => {
    const h = controllerHarness();
    const previous = historyRecord("220", { status: "completed", completed: 1 });
    h.responses.history.push({ restaurantId: "la-fonda", count: 1, requests: [previous] }, new DispatchApiError(502, "No se pudo consultar el historial."), new DispatchApiError(503, "x"));
    h.controller.start(h.api);
    await flush();
    await flush();
    assert.deepEqual(h.controller.getState().history.records.map((item) => item.requestId), [previous.requestId]);
    await h.controller.refreshHistory();
    let state = h.controller.getState().history;
    assert.deepEqual(state.records.map((item) => item.requestId), [previous.requestId], "records kept after a failure");
    assert.equal(state.error, "No se pudo consultar el historial.");
    assert.equal(state.loading, false);
    await h.controller.refreshHistory();
    state = h.controller.getState().history;
    assert.equal(state.error, "El historial no está disponible para este restaurante.");
    assert.equal(state.records.length, 1);
    const html = render(DeliveryHistorySection, { records: state.records, available: true, loaded: state.loaded, error: state.error });
    assert.ok(html.includes("Se muestran los últimos datos recibidos."));
    assert.ok(html.includes(shortRequestId(previous.requestId)));
    assert.deepEqual(h.notifications, [], "history failures never toast");
    h.controller.stop();
  });

  await t.test("the initial history load is silent and concurrent refreshes share one request", async () => {
    const h = controllerHarness();
    h.responses.history.push({ restaurantId: "la-fonda", count: 2, requests: [
      historyRecord("230", { status: "completed", completed: 1 }),
      historyRecord("231", { status: "cancelled", cancelled: 1 }),
    ] });
    h.controller.start(h.api);
    const shared = [h.controller.refreshHistory(), h.controller.refreshHistory()];
    await Promise.all(shared);
    await flush();
    assert.equal(h.calls.history, 1, "concurrent refreshes do not duplicate requests");
    assert.equal(h.controller.getState().history.records.length, 2);
    assert.deepEqual(h.notifications, [], "no toast or sound for records loaded initially");
    h.controller.stop();

    const pending = controllerHarness();
    pending.responses.history.push(() => new Promise(() => {}));
    pending.controller.start(pending.api);
    await flush();
    assert.equal(pending.historySignals.length, 1);
    pending.controller.stop();
    assert.equal(pending.historySignals[0].aborted, true, "in-flight history fetch aborted on stop");
  });

  await t.test("polling never refetches the history while the board is unchanged", async (st) => {
    st.mock.timers.enable({ apis: ["setTimeout"] });
    const h = controllerHarness();
    h.responses.active.push({ requests: [request("240"), fullyAssigned("241")] });
    h.controller.start(h.api);
    await flush();
    await flush();
    assert.equal(h.calls.history, 1);
    for (let index = 0; index < 6; index += 1) {
      st.mock.timers.tick(5_000);
      await flush();
      await flush();
    }
    assert.equal(h.calls.active, 7);
    assert.equal(h.calls.history, 1, "history is not fetched on each poll");
    h.controller.stop();
  });

  await t.test("a request moving from En curso to the history is announced exactly once", async () => {
    const storage = memoryStorage();
    const h = controllerHarness({ storage });
    const full = fullyAssigned("250");
    const done = historyRecord("250", { status: "completed", total: 2, completed: 2, drivers: ["Ana", "Luis"] });
    h.responses.active.push({ requests: [full] }, { requests: [] });
    h.responses.history.push({ restaurantId: "la-fonda", count: 0, requests: [] }, { restaurantId: "la-fonda", count: 1, requests: [done] });
    h.controller.start(h.api);
    await flush();
    await flush();
    assert.equal(partitionActive(h.controller.getState().active).inProgress.length, 1);
    assert.equal(h.calls.history, 1);
    await h.controller.refresh();
    await flush();
    assert.equal(h.calls.history, 2, "history reloaded once when the request left the board");
    assert.deepEqual(h.notifications.map((item) => item.kind), ["completed"]);
    assert.deepEqual(h.controller.getState().history.records.map((item) => item.requestId), [done.requestId]);
    const played = [];
    announce(h.notifications, { muted: false, play: (sound) => played.push(sound), push() {} });
    assert.deepEqual(played, ["complete"], "completion sound once");
    for (let index = 0; index < 3; index += 1) await h.controller.refresh();
    await h.controller.refreshHistory();
    assert.deepEqual(h.notifications.map((item) => item.kind), ["completed"], "no duplicate after more polls or history reloads");

    const reloaded = tracker(storage);
    reloaded.observe([full]);
    assert.deepEqual(reloaded.observe([], [], [done]), [], "the same completion is not re-announced in the session");
    h.controller.stop();
  });
});

function singleOrder(id, deliveryPatch = {}, requestPatch = {}) {
  const item = request(id, { total: 1, ...requestPatch });
  return { ...item, ...requestPatch.extra, deliveries: [{ ...item.deliveries[0], ...deliveryPatch }] };
}

function timelineStates(html) {
  return [...html.matchAll(/data-state="([a-z]+)" data-step="([a-z_]+)"/g)].map((match) => `${match[2]}:${match[1]}`);
}

test("delivery timeline and public order numbers", async (t) => {
  const cardActions = () => ({ canResend: false, canCancel: true, busyAction: null, disabled: false, onResend() {}, onCancel() {} });
  const fullyAssigned = (id) => ({ ...request(id, { status: "fully_assigned", total: 2, assigned: 2, drivers: ["Ana", "Luis"] }), completedDeliveries: 0, activeDeliveries: 2 });
  await t.test("open shows Buscando conductor with the driver step searching", () => {
    const html = render(DeliveryRequestGroup, { request: singleOrder("400"), nowMs: base });
    assert.ok(html.includes("Buscando conductor"));
    assert.ok(html.includes("Buscando…"));
    assert.deepEqual(timelineStates(html), ["received:complete", "assigned:current", "picked_up:pending", "completed:pending"]);
    assert.ok(html.includes('aria-current="step"'));
    assert.ok(!html.includes("Conductor: "), "no driver while searching");
  });

  await t.test("claimed shows Conductor asignado with the driver name", () => {
    const item = singleOrder("401", { status: "claimed", driverName: "María Elizabeth", assignedAt: iso(40) }, { status: "fully_assigned", assigned: 1 });
    const html = render(DeliveryRequestGroup, { request: item, nowMs: base });
    assert.ok(html.includes("Conductor asignado"));
    assert.ok(html.includes("Conductor: <strong>María Elizabeth</strong>"));
    assert.ok(html.includes("El conductor se dirige al restaurante."));
    assert.deepEqual(timelineStates(html), ["received:complete", "assigned:current", "picked_up:pending", "completed:pending"]);
    assert.ok(html.includes(">María Elizabeth<"), "driver shown on the Conductor asignado step");
  });

  await t.test("picked_up shows Pedido recogido and En camino", () => {
    const item = singleOrder("402", { status: "claimed", driverName: "María Elizabeth", assignedAt: iso(40), pickedUp: true, pickedUpAt: iso(300) }, { status: "fully_assigned", assigned: 1 });
    assert.equal(getDeliveryProgress("picked_up").badge, "En camino");
    const html = render(DeliveryRequestGroup, { request: item, nowMs: base });
    assert.ok(html.includes("En camino"));
    assert.ok(html.includes("Pedido recogido. El conductor está en camino."));
    assert.deepEqual(timelineStates(html), ["received:complete", "assigned:complete", "picked_up:current", "completed:pending"]);
    assert.ok(html.includes(`dateTime="${iso(300)}"`) || html.includes(`datetime="${iso(300)}"`), "pick-up time shown");
  });

  await t.test("completed shows Entrega completada with every step done", () => {
    const item = singleOrder("403", { status: "closed", driverName: "Ana", assignedAt: iso(40), pickedUp: true, pickedUpAt: iso(300), completedAt: iso(900) }, { status: "closed", assigned: 1 });
    const html = render(DeliveryRequestGroup, { request: item, nowMs: base });
    assert.ok(html.includes('data-phase="completed"'));
    assert.ok(html.includes("Entrega completada"));
    assert.deepEqual(timelineStates(html), ["received:complete", "assigned:complete", "picked_up:complete", "completed:complete"]);
  });

  await t.test("cancelled shows Cancelada and never marks later steps as done", () => {
    const item = singleOrder("404", { status: "cancelled", cancelledAt: iso(120) }, { status: "cancelled" });
    const html = render(DeliveryRequestGroup, { request: item, nowMs: base });
    assert.ok(html.includes("Cancelada"));
    assert.deepEqual(timelineStates(html), ["received:complete", "assigned:cancelled", "picked_up:cancelled", "completed:cancelled"]);
  });

  await t.test("the central orderNumber is shown on the card", () => {
    const item = { ...singleOrder("405"), orderNumber: "E814C7" };
    item.deliveries = [{ ...item.deliveries[0], orderNumber: "E814C7-01" }];
    const html = render(DeliveryRequestGroup, { request: item, nowMs: base });
    assert.ok(html.includes("#E814C7-01"));
    assert.equal(cleanOrderNumber("#e814c7-01"), "E814C7-01");
    assert.equal(cleanOrderNumber("WEB7A34FA8C687E451B908D9F05A1E814C7"), undefined, "internal IDs are never accepted as order numbers");
    assert.equal(cleanOrderNumber("+15550100999"), undefined, "phone-like values are rejected");
  });

  await t.test("legacy requests without orderNumber get a short fallback", () => {
    assert.equal(fallbackOrderNumber("WEB7A34FA8C687E451B908D9F05A1E814C7_1", 1), "E814C7-01");
    const legacy = { ...singleOrder("406"), requestId: "WEB7A34FA8C687E451B908D9F05A1E814C7", parentRequestId: "WEB7A34FA8C687E451B908D9F05A1E814C7" };
    legacy.deliveries = [{ ...legacy.deliveries[0], requestId: "WEB7A34FA8C687E451B908D9F05A1E814C7_1" }];
    legacy.totalDeliveries = 3;
    legacy.deliveries = [1, 2, 3].map((n) => ({ ...legacy.deliveries[0], requestId: `${legacy.requestId}_${n}`, deliveryNumber: n }));
    assert.deepEqual(deliveryOrders(legacy).map((order) => order.orderNumber), ["E814C7-01", "E814C7-02", "E814C7-03"]);
    const html = render(DeliveryRequestGroup, { request: legacy, nowMs: base });
    assert.ok(html.includes("SOLICITUD #E814C7"));
    assert.ok(html.includes("#E814C7-01"));
  });

  await t.test("no internal WEB request ID ever reaches the HTML", () => {
    const realistic = { ...request("407", { status: "partially_claimed", total: 3, assigned: 1, drivers: ["Ana"] }), requestId: "WEB7A34FA8C687E451B908D9F05A1E814C7" };
    const board = partitionActive([realistic, fullyAssigned("408")]);
    const pages = [
      render(SearchingSection, { requests: board.searching, nowMs: base, hasLoaded: true, actionsFor: () => cardActions() }),
      render(InProgressSection, { requests: board.inProgress, hasLoaded: true }),
      render(DeliveryHistorySection, { records: [historyRecord("409", { status: "completed", total: 2, completed: 2 })], available: true, loaded: true }),
    ].join("");
    assert.ok(!/WEB/i.test(pages), "requestId not rendered (text, keys or attributes)");
  });

  await t.test("a multi-delivery request shows one card per delivery under its group header", () => {
    const item = request("410", { status: "partially_claimed", total: 3, assigned: 2, drivers: ["Ana", "Luis"] });
    const html = render(DeliveryRequestGroup, { request: item, nowMs: base });
    assert.equal((html.match(/<article/g) ?? []).length, 3, "three order cards");
    assert.ok(html.includes("2 de 3 asignadas"));
    for (const n of [1, 2, 3]) assert.ok(html.includes(`Entrega ${n} de 3`));
    assert.equal((html.match(/<ol[^>]*aria-label="Progreso del pedido/g) ?? []).length, 3, "one timeline per delivery");
  });

  await t.test("a completed request leaves the board and appears in the history", () => {
    const done = { ...request("411", { status: "closed", total: 1, assigned: 1, drivers: ["Ana"] }) };
    const board = partitionActive([done]);
    assert.equal(board.searching.length + board.inProgress.length, 0, "completed is not on the live board");
    const record = historyRecord("411", { status: "completed", total: 1, completed: 1, drivers: ["Ana"] });
    const html = render(DeliveryHistorySection, { records: [record], available: true, loaded: true });
    assert.ok(html.includes("Completada"));
    assert.ok(html.includes(formatOrderNumber(requestOrderNumber(record))));
    const orders = historyOrders(record);
    assert.equal(orders[0].progress.phase, "completed");
    assert.ok(buildTimeline(orders[0]).every((step) => step.state === "complete"));
    const counts = summarizeDeliveryBoard([], [record], base + 600_000);
    assert.equal(counts.completedToday, 1);
  });

  await t.test("picked_up is announced once and never on identical polls, without sound", () => {
    const tr = tracker();
    const assigned = singleOrder("412", { status: "claimed", driverName: "Ana", assignedAt: iso(40) }, { status: "fully_assigned", assigned: 1 });
    tr.seed([assigned]);
    const picked = { ...assigned, pickedUpDeliveries: 1, updatedAt: iso(300), deliveries: [{ ...assigned.deliveries[0], pickedUp: true, pickedUpAt: iso(300) }] };
    const first = tr.observe([picked]);
    assert.deepEqual(first.map((item) => item.kind), ["picked_up"]);
    assert.match(first[0].title, /Pedido recogido · Solicitud #/);
    assert.ok(!/WEB/.test(first[0].title + (first[0].detail ?? "")));
    assert.deepEqual(tr.observe([picked]), [], "identical poll is silent");
    const played = [];
    announce(first, { muted: false, play: (sound) => played.push(sound), push: () => {} });
    assert.deepEqual(played, [], "pick-up does not add a new sound");
  });

  await t.test("no phone, PIN, credentials or internal URLs in the timeline HTML", () => {
    const leaky = {
      ...singleOrder("413", { status: "claimed", driverName: "Ana", assignedAt: iso(40), driverPhone: fakePhone }, { status: "fully_assigned", assigned: 1 }),
      restaurantPhone: fakePhone, deviceToken: fakePin, authorization: fakeBasicAuth, statusUrl: fakeInternalUrl,
    };
    const html = render(InProgressSection, { requests: [leaky], hasLoaded: true, restaurantName: "La Fonda" });
    assertNoSecrets(html);
    assert.ok(!/WEB/.test(html));
  });
});
