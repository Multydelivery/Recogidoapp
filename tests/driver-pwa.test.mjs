import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import sharp from "sharp";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GET as manifestRoute } from "../src/app/driver-manifest.webmanifest/route.ts";
import { metadata, viewport } from "../src/app/driver/layout.tsx";
import { DriverPwa } from "../src/components/driver/DriverPwa.tsx";
import { DriverDemo } from "../src/components/driver/DriverDemo.tsx";
import { DriverConfirmDialog } from "../src/components/driver/DriverConfirmDialog.tsx";
import { createDriverLiveController } from "../src/lib/driver/live-controller.ts";
import { driverTokenKey } from "../src/lib/driver/live-types.ts";
import { isDriverStandalone, isIosSafari, watchDriverWorker } from "../src/lib/driver/pwa-client.ts";

const source = await readFile(new URL("../public/driver/sw.js", import.meta.url), "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));
const origin = "https://recogido.invalid";

function workerHarness() {
  const events = new Map();
  const stores = new Map();
  const calls = [];
  let offline = false;
  let responseHeaders = {};
  let claimed = 0;
  let activated = 0;
  const key = (request) => new URL(typeof request === "string" ? request : request.url, origin).href;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(request) { return store.get(key(request))?.clone(); },
        async put(request, response) { store.set(key(request), response.clone()); },
        async keys() { return [...store.keys()].map((url) => new Request(url)); },
        async delete(request) { return store.delete(key(request)); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  const self = {
    location: { origin },
    navigator: { onLine: true },
    addEventListener(name, listener) { events.set(name, listener); },
    clients: { async claim() { claimed++; } },
    async skipWaiting() { activated++; },
  };
  vm.runInNewContext(source, {
    self, caches, Request, Response, URL,
    fetch: async (request, init) => {
      calls.push({ url: key(request), request, init });
      if (offline) throw new TypeError("Network unavailable");
      return new Response(new URL(key(request)).pathname, { headers: responseHeaders });
    },
  });
  return {
    calls, stores, events, caches, claimed: () => claimed, activated: () => activated,
    offline(value) { offline = value; self.navigator.onLine = !value; },
    responseHeaders(value) { responseHeaders = value; },
    async lifecycle(name, data) {
      const pending = [];
      events.get(name)({ data, waitUntil: (promise) => pending.push(promise) });
      await Promise.all(pending);
    },
    async fetch(path, options = {}) {
      const { navigate, ...init } = options;
      const request = new Request(new URL(path, origin), init);
      if (navigate) Object.defineProperty(request, "mode", { value: "navigate" });
      let result;
      events.get("fetch")({ request, respondWith: (promise) => { result = promise; } });
      return result;
    },
  };
}

test("driver manifest has exact install contract and metadata stays in driver layout", async () => {
  const response = manifestRoute();
  assert.match(response.headers.get("content-type"), /application\/manifest\+json/);
  const manifest = await response.json();
  assert.deepEqual(Object.fromEntries(Object.entries(manifest).filter(([key]) => key !== "icons")), {
    id: "/driver/", name: "Recogido Conductor", short_name: "Recogido",
    description: "Aplicación de entregas para conductores de Recogido",
    start_url: "/driver/", scope: "/driver/", display: "standalone",
    orientation: "portrait", theme_color: "#14b8ab", background_color: "#f4f6f9", lang: "es",
  });
  assert.deepEqual(manifest.icons.map(({ sizes, purpose }) => [sizes, purpose]), [
    ["192x192", "any"], ["512x512", "any"], ["512x512", "maskable"],
  ]);
  assert.equal(metadata.manifest, "/driver-manifest.webmanifest");
  assert.equal(viewport.viewportFit, "cover");
  const root = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  assert.ok(!root.includes("DriverPwa"));
  assert.ok(!root.includes("driver-manifest"));
});

test("official logo icons have exact sizes, opaque solid backgrounds and maskable safe zone", async () => {
  for (const [name, size] of [["icon-192", 192], ["icon-512", 512], ["maskable-512", 512], ["apple-touch-icon", 180]]) {
    const image = sharp(await readFile(new URL(`../public/driver/icons/${name}.png`, import.meta.url)));
    const metadata = await image.metadata();
    assert.equal(metadata.width, size);
    assert.equal(metadata.height, size);
    const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const p = (y * size + x) * info.channels;
      assert.equal(data[p + 3], 255);
      if (name === "maskable-512" && Math.hypot(x - size / 2, y - size / 2) > size * 0.4) {
        assert.deepEqual([...data.subarray(p, p + 3)], [255, 255, 255]);
      }
    }
  }
});

test("worker precaches only allowlisted public files and activates without deleting other application caches", async () => {
  const sw = workerHarness();
  await sw.caches.open("restaurant-cache-v1");
  await sw.caches.open("recogido-driver-static-v0");
  await sw.lifecycle("install");
  const paths = sw.calls.map(({ url }) => new URL(url).pathname);
  assert.ok(paths.includes("/driver/offline.html"));
  assert.ok(paths.every((path) => path === "/driver/offline.html" || path.startsWith("/driver/icons/") || path === "/recogidoapplogo.png"));
  assert.ok(sw.calls.every(({ request }) => request.credentials === "omit"));
  assert.equal(sw.activated(), 0, "Updates must wait for user consent");
  await sw.lifecycle("activate");
  assert.ok(!(await sw.caches.keys()).includes("recogido-driver-static-v0"));
  assert.ok((await sw.caches.keys()).includes("restaurant-cache-v1"));
  assert.equal(sw.claimed(), 1);
  await sw.lifecycle("message", { type: "ACTIVATE_UPDATE" });
  assert.equal(sw.activated(), 1);
});

test("all API, POST, and authenticated requests are network-only and never queued or cached", async () => {
  const sw = workerHarness();
  await sw.lifecycle("install");
  const entries = [...sw.stores.values()].reduce((sum, map) => sum + map.size, 0);
  for (const [path, options] of [
    ["/api/driver/maria-elizabeth/dashboard", {}],
    ["/api/driver/patricia-castaneda/config", { headers: { "X-Device-Token": "synthetic-patricia" } }],
    ["/api/driver/patricia-castaneda/dashboard", {}],
    ["/api/dispatch/config", {}],
    ["/api/driver/maria-elizabeth/action", { method: "POST", body: '{"action":"accept"}' }],
    ["/_next/static/private.js", { headers: { "X-Device-Token": "synthetic-pin" } }],
    ["/driver/icons/icon-192.png", { headers: { Authorization: "synthetic-auth" } }],
    ["/driver/maria-elizabeth", {}],
    ["/api/driver/patricia-castaneda/action", { method: "POST", body: '{"action":"set_availability","available":false}' }],
    ["/driver/patricia-castaneda", {}],
    ["/driver/patricia-castaneda?_rsc=synthetic", {}],
  ]) {
    await sw.fetch(path, options);
    assert.equal(sw.calls.at(-1).init.cache, "no-store");
  }
  assert.equal([...sw.stores.values()].reduce((sum, map) => sum + map.size, 0), entries);
  sw.offline(true);
  const before = sw.calls.length;
  const offline = await sw.fetch("/api/driver/maria-elizabeth/action", { method: "POST", body: "{}" });
  assert.equal(offline.status, 503);
  assert.match((await offline.json()).error, /no se guardó ni se reintentará/);
  assert.equal(sw.calls.length, before, "Offline POST must fail immediately");
  assert.ok(!sw.events.has("sync"));
  assert.ok(!/backgroundSync|registration\.sync|indexedDB|localStorage/i.test(source));
});

test("static assets cache-first without credentials; private/no-store responses and query URLs never cached", async () => {
  const sw = workerHarness();
  await sw.lifecycle("install");
  const before = sw.calls.length;
  await sw.fetch("/_next/static/chunks/public.js");
  assert.equal(sw.calls.at(-1).request.credentials, "omit");
  await sw.fetch("/_next/static/chunks/public.js");
  assert.equal(sw.calls.length, before + 1);
  for (const headers of [
    { "Cache-Control": "no-store" }, { "Cache-Control": "private" }, { Vary: "Authorization" }, { "Set-Cookie": "example=value" },
  ]) {
    sw.responseHeaders(headers);
    const start = sw.calls.length;
    await sw.fetch("/_next/static/chunks/uncacheable.js");
    await sw.fetch("/_next/static/chunks/uncacheable.js");
    assert.equal(sw.calls.length, start + 2);
  }
  sw.responseHeaders({});
  const start = sw.calls.length;
  await sw.fetch("/_next/static/public.js?private=example");
  await sw.fetch("/_next/static/public.js?private=example");
  assert.equal(sw.calls.length, start + 2);
  assert.equal(await sw.fetch("https://outside.invalid/resource"), undefined);
});

test("offline navigation returns only the neutral offline document, never cached dashboard data", async () => {
  const sw = workerHarness();
  await sw.lifecycle("install");
  for (const slug of ["maria-elizabeth", "patricia-castaneda"]) {
    sw.offline(false);
    await sw.fetch(`/driver/${slug}`, { navigate: true });
    sw.offline(true);
    const offline = await sw.fetch(`/driver/${slug}`, { navigate: true });
    assert.equal(await offline.text(), "/driver/offline.html");
    assert.equal((await sw.fetch(`/api/driver/${slug}/dashboard`)).status, 503);
  }
  for (const store of sw.stores.values()) {
    assert.ok([...store.keys()].every((key) => !key.includes("/api/") && !key.includes("maria-elizabeth") && !key.includes("patricia-castaneda")));
  }
  const html = await readFile(new URL("../public/driver/offline.html", import.meta.url), "utf8");
  for (const message of ["Sin conexión", "Conéctese a internet para consultar o actualizar sus entregas.",
    "Las acciones de entrega no se guardan mientras está sin conexión."]) assert.ok(html.includes(message));
  assert.ok(!html.includes("<script"));
});

test("offline controller preserves current data, blocks all actions, reconnects with GET only and logout removes token", async () => {
  const calls = [];
  const storage = new Map();
  const dashboard = { success: true, driver: { name: "Maria Elizabeth", available: true }, offers: [{ orderNumber: "#ABCDEF-01", canAccept: true }],
    activeDeliveries: [], history: [], capacity: { used: 0, maximum: 3, remaining: 3 } };
  let online = true;
  const controller = createDriverLiveController("maria-elizabeth", {
    online: () => online, visible: () => true,
    storage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    fetch: async (url, init) => { calls.push({ url, init }); return Response.json(url.endsWith("config") ? { success: true } : dashboard); },
    setInterval: () => 1, clearInterval() {},
  });
  await controller.login("synthetic-pin");
  const saved = controller.getSnapshot().dashboard;
  online = false;
  controller.setOnline(false);
  for (const action of ["accept", "decline", "pickup", "complete", "set_availability"]) {
    await controller.act(action === "set_availability" ? { action, available: false } : { action, orderNumber: "#ABCDEF-01" });
  }
  await controller.refresh();
  assert.equal(calls.length, 2);
  assert.equal(controller.getSnapshot().dashboard, saved);
  assert.equal(controller.getSnapshot().online, false);
  assert.match(controller.getSnapshot().message, /acciones están deshabilitadas/);
  online = true;
  controller.setOnline(true);
  await tick();
  assert.equal(calls.length, 3);
  assert.ok(calls.at(-1).url.endsWith("dashboard"));
  assert.equal(calls.at(-1).init.method, "GET");
  assert.equal(controller.getSnapshot().message, "Conexión restaurada");
  controller.logout();
  assert.equal(storage.has(driverTokenKey("maria-elizabeth")), false);
  assert.equal(controller.getSnapshot().authenticated, false);
  assert.equal(controller.getSnapshot().dashboard, null);
});

test("install detection hides UI in standalone and recognizes Safari iPhone/iPad only", () => {
  assert.equal(isDriverStandalone(true, false), true);
  assert.equal(isDriverStandalone(false, true), true);
  assert.equal(isDriverStandalone(false), false);
  assert.equal(isIosSafari("iPhone Version/18 Mobile Safari/604.1", 5), true);
  assert.equal(isIosSafari("Macintosh Version/18 Safari/605", 5), true);
  assert.equal(isIosSafari("Macintosh Version/18 Safari/605", 0), false);
  assert.equal(isIosSafari("iPhone CriOS/123 Mobile Safari/604", 5), false);
  assert.equal(renderToStaticMarkup(createElement(DriverPwa)), "", "No install button before browser detection");
});

function workerContainer() {
  const container = new EventTarget();
  const registration = new EventTarget();
  const worker = new EventTarget();
  worker.messages = [];
  worker.postMessage = (data) => worker.messages.push(data);
  registration.waiting = worker;
  registration.installing = null;
  const calls = [];
  container.register = async (...args) => { calls.push(args); return registration; };
  return { container, registration, worker, calls };
}

test("registration is production-only, scoped to driver; updates reload once only after explicit activation", async () => {
  const fake = workerContainer();
  let reloads = 0;
  let waiting = false;
  const callbacks = { waiting: (value) => { waiting = value; }, error: () => assert.fail("Unexpected registration failure"), reload: () => reloads++ };
  const dev = watchDriverWorker(fake.container, callbacks, false);
  await tick();
  assert.equal(fake.calls.length, 0);
  dev.dispose();
  const prod = watchDriverWorker(fake.container, callbacks, true);
  await tick();
  assert.deepEqual(fake.calls[0], ["/driver/sw.js", { scope: "/driver/", updateViaCache: "none" }]);
  assert.equal(waiting, true);
  fake.container.dispatchEvent(new Event("controllerchange"));
  assert.equal(reloads, 0);
  prod.update();
  prod.update();
  assert.deepEqual(fake.worker.messages, [{ type: "ACTIVATE_UPDATE" }]);
  fake.container.dispatchEvent(new Event("controllerchange"));
  fake.container.dispatchEvent(new Event("controllerchange"));
  assert.equal(reloads, 1);
  prod.dispose();
  fake.container.dispatchEvent(new Event("controllerchange"));
  assert.equal(reloads, 1);
});

test("registration failure surfaces a generic message", async () => {
  const fake = workerContainer();
  let message = "";
  fake.container.register = async () => { throw new Error("synthetic-private-error"); };
  const monitor = watchDriverWorker(fake.container, { waiting() {}, error: (text) => { message = text; }, reload() {} }, true);
  await tick();
  assert.match(message, /no pudo prepararse/);
  assert.ok(!message.includes("synthetic-private-error"));
  monitor.dispose();
});

test("new worker installation reveals update notice; cleanup ignores a late registration", async () => {
  const fake = workerContainer();
  fake.registration.waiting = null;
  let waiting = false;
  const monitor = watchDriverWorker(fake.container, {
    waiting: (value) => { waiting = value; }, error: () => assert.fail("Unexpected installation error"), reload() {},
  }, true);
  await tick();
  assert.equal(waiting, false);
  fake.registration.installing = fake.worker;
  fake.registration.dispatchEvent(new Event("updatefound"));
  fake.registration.waiting = fake.worker;
  fake.worker.state = "installed";
  fake.worker.dispatchEvent(new Event("statechange"));
  assert.equal(waiting, true);
  monitor.dispose();
  let finishRegistration;
  fake.container.register = () => new Promise((resolve) => { finishRegistration = resolve; });
  let notices = 0;
  const late = watchDriverWorker(fake.container, {
    waiting: () => notices++, error: () => notices++, reload: () => notices++,
  }, true);
  late.dispose();
  finishRegistration(fake.registration);
  await tick();
  fake.container.dispatchEvent(new Event("controllerchange"));
  assert.equal(notices, 0);
});

test("manifest/worker contain no private configuration, no critical action retry and demo still renders", async () => {
  const publicText = source + JSON.stringify(await manifestRoute().json());
  for (const value of ["DRIVERS_JSON", "TWILIO_", "DRIVER_LIVE_TEST", "Basic ", "WEB_", "whatsapp:", "synthetic-pin"]) {
    assert.ok(!publicText.includes(value), value);
  }
  const html = renderToStaticMarkup(createElement(DriverDemo));
  assert.match(html, /Modo de demostración/);
  assert.match(html, /Controles de demostración/);
  const dialog = renderToStaticMarkup(createElement(DriverConfirmDialog, { open: true, title: "Confirmar",
    confirmLabel: "COMPLETAR ENTREGA", confirmDisabled: true, busy: false, onConfirm() {}, onCancel() {} }));
  assert.match(dialog, /disabled=""/);
  const live = await readFile(new URL("../src/components/driver/DriverLive.tsx", import.meta.url), "utf8");
  assert.match(live, /actionsDisabled=\{!state.online/);
  assert.match(live, /availabilityDisabled=\{!state.online/);
  assert.match(live, /confirmDisabled=\{!state.online\}/);
});
