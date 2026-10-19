import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DriverLive } from "../src/components/driver/DriverLive.tsx";
import { DriverDemo } from "../src/components/driver/DriverDemo.tsx";
import { OfferCard } from "../src/components/driver/OfferCard.tsx";
import { ActiveDeliveryCard } from "../src/components/driver/ActiveDeliveryCard.tsx";
import { DriverConfirmDialog } from "../src/components/driver/DriverConfirmDialog.tsx";
import { createDriverLiveController } from "../src/lib/driver/live-controller.ts";
import { driverTokenKey as tokenKey } from "../src/lib/driver/live-types.ts";
import { normalizeDriverConfig as configFor, normalizeDriverDashboard as dashboardFor, normalizeDriverAction, callDriverTwilio } from "../src/lib/driver/server/twilio.ts";
import { getDriverProfile } from "../src/lib/driver/server/config.ts";
import { GET as configHandler } from "../src/app/api/driver/[driver]/config/route.ts";
import { GET as dashboardHandler } from "../src/app/api/driver/[driver]/dashboard/route.ts";
import { POST as actionHandler } from "../src/app/api/driver/[driver]/action/route.ts";

// Synthetic credentials only. No .env files are loaded by this suite.
const pin = "test-pin-driver";
const phone = "whatsapp:+15550001111";
const driver = { driverId: "maria-elizabeth", name: "Maria Elizabeth", active: true, available: true, webEnabled: true, maxActiveDeliveries: 3 };
const driverTokenKey = tokenKey(driver.driverId);
const context = (slug = driver.driverId) => ({ params: Promise.resolve({ driver: slug }) });
const configRoute = (request) => configHandler(request, context());
const dashboardRoute = (request) => dashboardHandler(request, context());
const actionRoute = (request) => actionHandler(request, context());
const normalizeDriverConfig = (value, secrets) => configFor(value, driver, secrets);
const normalizeDriverDashboard = (value, secrets) => dashboardFor(value, driver, secrets);
const order = (n = 1, restaurantId = "la-fonda") => ({
  orderNumber: `#ABCDEF-0${n}`, restaurantId, restaurantName: "La Fonda", assignmentMode: "individual",
  assignmentLabel: `Entrega ${n} de 3`, deliveryUnits: 1, canAccept: true,
});
const snapshot = (patch = {}) => ({
  success: true, driver: { ...driver }, capacity: { used: 0, maximum: 3, remaining: 3 },
  offers: [order()], activeDeliveries: [], history: [], ...patch,
});
const json = (value, status = 200) => Response.json(value, { status });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const request = (operation, body, token = pin) => new Request(`http://localhost/api/driver/maria-elizabeth/${operation}`, {
  method: body ? "POST" : "GET", headers: { "X-Device-Token": token, ...(body ? { "Content-Type": "application/json" } : {}) },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

function client(responder = async (url) => json(url.endsWith("config") ? { success: true, driver } : snapshot())) {
  const storage = new Map();
  const calls = [];
  let visible = true;
  let callback;
  let intervals = 0;
  const controller = createDriverLiveController(driver.driverId, {
    storage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    fetch: async (url, init) => { calls.push({ url, init }); return responder(url, init); },
    visible: () => visible,
    setInterval: (fn, ms) => { assert.equal(ms, 8000); callback = fn; intervals++; return 1; },
    clearInterval: () => { callback = undefined; intervals--; },
  });
  return { controller, calls, storage, setVisible(value) { visible = value; }, poll() { callback?.(); }, intervals: () => intervals };
}

test("private driver adapter and HTTP contracts (all upstream fetch mocked)", async (t) => {
  const originalFetch = globalThis.fetch;
  const env = {
    DRIVER_LIVE_TEST_ENABLED: "true", DRIVER_LIVE_TEST_DRIVER_ID: "maria-elizabeth",
    DRIVERS_JSON: JSON.stringify([{ slug: "maria-elizabeth", name: driver.name, phone, deviceToken: pin }]),
    TWILIO_DRIVER_CONFIG_URL: "https://driver.invalid/config", TWILIO_DRIVER_DASHBOARD_URL: "https://driver.invalid/dashboard",
    TWILIO_DRIVER_ACTION_URL: "https://driver.invalid/action", TWILIO_WEB_AUTH_USERNAME: "synthetic-user",
    TWILIO_WEB_AUTH_PASSWORD: "synthetic-password", DISPATCH_REQUEST_TIMEOUT_MS: "100",
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  globalThis.fetch = async () => { throw new Error("Unexpected mock request"); };
  try {
    await t.test("incorrect/missing PIN returns 401 before calling Twilio", async () => {
      for (const token of ["", "bad", "x".repeat(200)]) {
        const response = await configRoute(request("config", undefined, token));
        assert.equal(response.status, 401);
        assert.equal((await response.json()).error, "PIN incorrecto. Inténtelo nuevamente.");
      }
    });
    await t.test("correct PIN loads config using POST, form, Basic Auth, no-store and abort signal", async () => {
      globalThis.fetch = async (url, init) => {
        assert.equal(url, env.TWILIO_DRIVER_CONFIG_URL);
        assert.equal(init.method, "POST");
        assert.equal(init.cache, "no-store");
        assert.equal(init.redirect, "error");
        assert.ok(init.signal instanceof AbortSignal);
        assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded");
        assert.equal(init.headers.Authorization, `Basic ${Buffer.from("synthetic-user:synthetic-password").toString("base64")}`);
        assert.deepEqual([...init.body], [["driverId", "maria-elizabeth"]]);
        return json({ success: true, driver: { ...driver, phone, deviceToken: pin } });
      };
      const response = await configRoute(request("config"));
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      assert.deepEqual(await response.json(), { success: true, driver });
    });
    await t.test("dashboard allowlist excludes private fields and permits absent/null/ISO dates", async () => {
      globalThis.fetch = async () => json(snapshot({
        requestId: "WEB_private", accountSid: "AC" + "a".repeat(32),
        driver: { ...driver, phone, deviceToken: pin },
        offers: [{ ...order(), createdAt: null, phone, requestId: "WEB_private" }, { ...order(2), createdAt: "2026-10-17T10:30:00-04:00" }],
        history: [{ ...order(3), status: "completed", assignedAt: null }],
      }));
      const response = await dashboardRoute(request("dashboard"));
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.offers[0].orderNumber, "#ABCDEF-01");
      assert.equal(data.offers[0].createdAt, undefined);
      assert.equal(data.offers[1].createdAt, "2026-10-17T14:30:00.000Z");
      assert.equal(data.history[0].assignedAt, undefined);
      for (const privateText of [phone, pin, "WEB", "accountSid", "deviceToken", "https:", "Basic"]) {
        assert.ok(!JSON.stringify(data).includes(privateText));
      }
    });
    await t.test("all actions forward only allowed fields and authenticated driver identity", async () => {
      for (const action of ["accept", "decline", "pickup", "complete", "set_availability"]) {
        const body = action === "set_availability" ? { action, available: false } : { action, orderNumber: "#ABCDEF-01" };
        globalThis.fetch = async (url, init) => {
          assert.equal(url, env.TWILIO_DRIVER_ACTION_URL);
          assert.deepEqual(Object.fromEntries(init.body), { driverId: "maria-elizabeth",
            ...Object.fromEntries(Object.entries(body).map(([key, value]) => [key, String(value)])) });
          return json({ success: true, driverId: driver.driverId, requestId: "WEB_private", phone, deviceToken: pin });
        };
        const response = await actionRoute(request("action", body));
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { success: true });
      }
      for (const body of [
        { action: "accept", driverId: "another", orderNumber: "#ABCDEF-01" },
        { action: "accept", orderNumber: "WEB_private" }, { action: "accept", orderNumber: "#abcdef-01" },
        { action: "delete", orderNumber: "#ABCDEF-01" }, { action: "set_availability", available: "true" },
        { action: "pickup", orderNumber: "#ABCDEF-01", available: true },
      ]) assert.equal((await actionRoute(request("action", body))).status, 400);
    });
    await t.test("errors are typed, sanitized, and retain HTTP meaning", async () => {
      for (const status of [403, 404, 409, 500, 401]) {
        globalThis.fetch = async () => json({ error: `${phone} ${pin} WEB_private` }, status);
        const response = await actionRoute(request("action", { action: "accept", orderNumber: "#ABCDEF-01" }));
        assert.equal(response.status, [403, 404, 409].includes(status) ? status : 502);
        const body = await response.text();
        for (const secret of [phone, pin, "WEB_private"]) assert.ok(!body.includes(secret));
      }
      globalThis.fetch = async () => { throw new Error(`${phone} ${pin}`); };
      await assert.rejects(callDriverTwilio(getDriverProfile(driver.driverId), "dashboard"), { statusCode: 502, code: "UPSTREAM_FAILURE" });
      globalThis.fetch = async (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("timeout"))));
      await assert.rejects(callDriverTwilio(getDriverProfile(driver.driverId), "dashboard"), { statusCode: 502, code: "UPSTREAM_TIMEOUT" });
      process.env.DRIVER_LIVE_TEST_ENABLED = "false";
      assert.equal((await configRoute(request("config"))).status, 503);
      process.env.DRIVER_LIVE_TEST_ENABLED = "true";
      globalThis.fetch = async () => json({ success: true, driver: { ...driver, webEnabled: false } });
      assert.equal((await configRoute(request("config"))).status, 403);
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("normalization validates statuses, dates and sensitive text; capacity is restaurant-specific", () => {
  const active = (restaurantId, n) => ({ ...order(n, restaurantId), status: "assigned" });
  let data = normalizeDriverDashboard(snapshot({ activeDeliveries: [active("la-fonda", 2)], capacity: { used: 1, maximum: 3, remaining: 2 },
    offers: [order(1, "la-fonda"), order(3, "brisas"), order(4, "jade-lee")] }));
  assert.equal(data.offers[0].canAccept, false);
  assert.match(data.offers[0].blockReason, /este restaurante/);
  assert.equal(data.offers[1].canAccept, true);
  assert.equal(data.offers[2].canAccept, true);
  data = normalizeDriverDashboard(snapshot({ activeDeliveries: [active("la-fonda", 1), active("brisas", 2), active("jade-lee", 3)],
    capacity: { used: 3, maximum: 3, remaining: 0 } }));
  assert.equal(data.activeDeliveries.length, 3);
  assert.equal(data.offers[0].canAccept, false);
  for (const status of ["open", "claimed", "assigned", "picked_up", "completed", "closed", "declined", "cancelled"]) {
    assert.equal(normalizeDriverDashboard(snapshot({ history: [{ ...order(), status }] })).history[0].status, status);
  }
  for (const patch of [{ restaurantName: phone }, { assignmentLabel: "WEB_private" }, { createdAt: "yesterday" },
    ...["AC", "SM", "IS", "MP", "ET", "ES"].map((prefix) => ({ restaurantId: prefix + "a".repeat(32) }))]) {
    assert.throws(() => normalizeDriverDashboard(snapshot({ offers: [{ ...order(), ...patch }] })), { statusCode: 502 });
  }
  assert.throws(() => normalizeDriverConfig({ success: true, driver: { ...driver, name: pin } }, [pin]), { statusCode: 502 });
  assert.equal(normalizeDriverDashboard(snapshot({ offers: [{ ...order(), blockReason: "" }] })).offers[0].canAccept, true);
});

test("multiple authorized drivers are isolated at every HTTP endpoint", async (t) => {
  const patricia = { ...driver, driverId: "patricia-castaneda", name: "Patricia Castaneda" };
  const profiles = [
    { slug: driver.driverId, name: driver.name, phone, deviceToken: pin },
    { slug: patricia.driverId, driverId: patricia.driverId, name: patricia.name,
      phone: "whatsapp:+15550002222", deviceToken: "test-pin-patricia", active: true },
    { slug: "oscar-rojas", driverId: "oscar-backend", name: "Oscar Rojas",
      phone: "whatsapp:+15550003333", deviceToken: "test-pin-oscar", active: true },
    { driverId: "ramon-colorado", name: "Ramon Colorado",
      phone: "whatsapp:+15550004444", deviceToken: "test-pin-ramon" },
    { slug: "inactive", driverId: "inactive", name: "Inactive",
      phone: "whatsapp:+15550005555", deviceToken: "test-pin-inactive", active: false },
  ];
  const env = {
    DRIVERS_JSON: JSON.stringify(profiles), DRIVER_LIVE_TEST_ENABLED: "true",
    DRIVER_LIVE_TEST_DRIVER_ID: "obsolete-not-an-allowlist",
    TWILIO_DRIVER_CONFIG_URL: "https://driver.invalid/config",
    TWILIO_DRIVER_DASHBOARD_URL: "https://driver.invalid/dashboard",
    TWILIO_DRIVER_ACTION_URL: "https://driver.invalid/action",
    TWILIO_WEB_AUTH_USERNAME: "synthetic-user", TWILIO_WEB_AUTH_PASSWORD: "synthetic-password",
  };
  const previous = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const handlers = { config: configHandler, dashboard: dashboardHandler, action: actionHandler };
  const action = { action: "set_availability", available: true };
  let upstreamCalls = 0;
  let foreign = false;
  let missingActionIdentity = false;
  const send = (operation, slug, token, body = action) => handlers[operation](
    new Request(`http://localhost/api/driver/${slug}/${operation}`, {
      method: operation === "action" ? "POST" : "GET",
      headers: { "X-Device-Token": token, "Content-Type": "application/json" },
      ...(operation === "action" ? { body: JSON.stringify(body) } : {}),
    }), context(slug));
  Object.assign(process.env, env);
  globalThis.fetch = async (url, init) => {
    upstreamCalls++;
    const driverId = init.body.get("driverId");
    const p = profiles.find((p) => (p.driverId ?? p.slug) === driverId);
    assert.ok(p, "Only resolved server identities may reach the upstream");
    assert.equal(init.body.has("phone"), false);
    assert.equal(init.body.has("deviceToken"), false);
    const d = { ...driver, driverId: foreign ? "unrelated-driver" : driverId, name: p.name };
    if (url.endsWith("/action")) return json(missingActionIdentity ? { success: true } : { success: true, driverId: d.driverId });
    return json(url.endsWith("/config") ? { success: true, driver: d } : snapshot({ driver: d }));
  };
  try {
    await t.test("Maria and Patricia work independently with their own PIN on all endpoints", async () => {
      for (const p of profiles.filter((p) => p.active !== false)) {
        for (const operation of Object.keys(handlers)) {
          const response = await send(operation, p.slug ?? p.driverId, p.deviceToken);
          assert.equal(response.status, 200);
          const data = await response.json();
          if (operation !== "action") {
            assert.equal(data.driver.driverId, p.driverId ?? p.slug);
            assert.equal(data.driver.name, p.name);
          }
          for (const profile of profiles) {
            assert.ok(!JSON.stringify(data).includes(profile.deviceToken));
            assert.ok(!JSON.stringify(data).includes(profile.phone));
          }
        }
      }
    });
    await t.test("cross-account PINs return identical 401s before upstream access", async () => {
      const before = upstreamCalls;
      for (const operation of Object.keys(handlers)) {
        const mariaAtPatricia = await send(operation, patricia.driverId, pin);
        const patriciaAtMaria = await send(operation, driver.driverId, profiles[1].deviceToken);
        assert.equal(mariaAtPatricia.status, 401);
        assert.equal(patriciaAtMaria.status, 401);
        assert.deepEqual(await mariaAtPatricia.json(), await patriciaAtMaria.json());
      }
      assert.equal(upstreamCalls, before);
    });
    await t.test("unknown slug is 404 and inactive driver is 403 on all endpoints", async () => {
      const before = upstreamCalls;
      for (const operation of Object.keys(handlers)) {
        for (const [slug, token, status] of [["unknown", pin, 404], ["inactive", "test-pin-inactive", 403]]) {
          const response = await send(operation, slug, token);
          assert.equal(response.status, status);
          assert.equal((await response.json()).error, "Conductor no autorizado");
          assert.equal(response.headers.get("cache-control"), "no-store");
        }
      }
      assert.equal(upstreamCalls, before);
    });
    await t.test("config, dashboard and action reject foreign Twilio identities with 403", async () => {
      foreign = true;
      for (const operation of Object.keys(handlers)) {
        for (const p of profiles.slice(0, 2)) {
          const response = await send(operation, p.slug, p.deviceToken);
          assert.equal(response.status, 403);
          assert.equal((await response.json()).code, "DRIVER_MISMATCH");
        }
      }
      foreign = false;
      missingActionIdentity = true;
      assert.equal((await send("action", driver.driverId, pin)).status, 502);
      missingActionIdentity = false;
    });
    await t.test("browser identity injection is rejected without calling Twilio", async () => {
      const before = upstreamCalls;
      for (const identity of [{ driverId: driver.driverId }, { slug: driver.driverId }, { phone }, { driver: driver }]) {
        assert.equal((await send("action", patricia.driverId, profiles[1].deviceToken, { ...action, ...identity })).status, 400);
      }
      assert.equal(upstreamCalls, before);
    });
    await t.test("legacy IDs, missing pilot flags and duplicate configuration fail safely", () => {
      delete process.env.DRIVER_LIVE_TEST_ENABLED;
      delete process.env.DRIVER_LIVE_TEST_DRIVER_ID;
      assert.equal(getDriverProfile(driver.driverId).driverId, driver.driverId);
      assert.equal(getDriverProfile("ramon-colorado").slug, "ramon-colorado");
      for (const patch of [
        { ...profiles[1], deviceToken: pin },
        { ...profiles[1], slug: driver.driverId },
        { ...profiles[1], driverId: driver.driverId },
        { ...profiles[1], active: undefined },
        { ...profiles[1], active: "true" },
      ]) {
        process.env.DRIVERS_JSON = JSON.stringify([profiles[0], patch]);
        assert.throws(() => getDriverProfile(driver.driverId), { statusCode: 503, code: "INVALID_CONFIGURATION" });
      }
      process.env.DRIVERS_JSON = JSON.stringify(profiles);
    });
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("strict normalization rejects conflicting response envelopes and foreign delivery ownership", () => {
  for (const normalize of [configFor, dashboardFor]) {
    assert.throws(() => normalize({ ...snapshot(), driverId: "foreign" }, driver), { statusCode: 403 });
  }
  for (const section of ["offers", "activeDeliveries", "history"]) {
    assert.throws(() => dashboardFor(snapshot({
      [section]: [{ ...order(), status: "assigned", driverId: "foreign" }],
    }), driver), { statusCode: 403 });
  }
  for (const payload of [
    { success: true, driverId: "foreign" },
    { success: true, driverId: driver.driverId, driver: { driverId: "foreign" } },
  ]) assert.throws(() => normalizeDriverAction(payload, driver), { statusCode: 403 });
  for (const payload of [{ success: true }, { success: "true", driverId: driver.driverId }]) {
    assert.throws(() => normalizeDriverAction(payload, driver), { statusCode: 502 });
  }
  assert.deepEqual(normalizeDriverAction({ success: true, driver: { driverId: driver.driverId }, phone }, driver), { success: true });
});

test("localStorage sessions, driver state, restoration, logout and revocation stay independent", async () => {
  const storage = new Map();
  const calls = [];
  let revoked = false;
  const make = (slug) => createDriverLiveController(slug, {
    storage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      if (revoked && url.includes("patricia")) return json({}, 403);
      const d = { ...driver, driverId: slug, name: slug, available: slug === driver.driverId };
      return json(url.endsWith("config") ? { success: true, driver: d } : snapshot({
        driver: d, offers: slug === driver.driverId ? [order()] : [],
        activeDeliveries: slug === driver.driverId ? [] : [{ ...order(2), status: "picked_up" }],
        capacity: slug === driver.driverId ? { used: 0, maximum: 3, remaining: 3 } : { used: 1, maximum: 3, remaining: 2 },
        history: slug === driver.driverId ? [] : [{ ...order(), status: "completed" }],
      }));
    },
    visible: () => true, setInterval: () => 1, clearInterval() {},
  });
  const maria = make(driver.driverId);
  const patricia = make("patricia-castaneda");
  await maria.login(pin);
  await patricia.login("test-pin-patricia");
  assert.equal(storage.get(tokenKey(driver.driverId)), pin);
  assert.equal(storage.get(tokenKey("patricia-castaneda")), "test-pin-patricia");
  assert.equal(maria.getSnapshot().dashboard.offers.length, 1);
  assert.equal(patricia.getSnapshot().dashboard.offers.length, 0);
  assert.equal(patricia.getSnapshot().dashboard.history.length, 1);
  assert.equal(maria.getSnapshot().dashboard.history.length, 0);
  assert.equal(maria.getSnapshot().dashboard.activeDeliveries.length, 0);
  assert.equal(patricia.getSnapshot().dashboard.activeDeliveries.length, 1);
  assert.equal(maria.getSnapshot().dashboard.capacity.remaining, 3);
  assert.equal(patricia.getSnapshot().dashboard.capacity.remaining, 2);
  assert.equal(maria.getSnapshot().dashboard.driver.available, true);
  assert.equal(patricia.getSnapshot().dashboard.driver.available, false);
  patricia.logout();
  assert.equal(storage.has(tokenKey("patricia-castaneda")), false);
  assert.equal(storage.get(tokenKey(driver.driverId)), pin);
  assert.equal(maria.getSnapshot().authenticated, true);
  await patricia.login("test-pin-patricia");
  patricia.stop();
  await patricia.start();
  assert.ok(calls.filter(({ url }) => url.includes("patricia")).every(({ init }) => init.headers["X-Device-Token"] === "test-pin-patricia"));
  revoked = true;
  await patricia.refresh();
  assert.equal(patricia.getSnapshot().authenticated, false);
  assert.equal(patricia.getSnapshot().dashboard, null);
  assert.equal(storage.has(tokenKey("patricia-castaneda")), false);
  assert.equal(storage.get(tokenKey(driver.driverId)), pin);
  maria.stop();
  patricia.stop();
});

test("removing authorization clears the current driver's data without exposing order-not-found text", async () => {
  let removed = false;
  const c = client(async (url) => removed
    ? json({ success: false, code: "DRIVER_NOT_FOUND" }, 404)
    : json(url.endsWith("config") ? { success: true, driver } : snapshot()));
  await c.controller.login(pin);
  removed = true;
  await c.controller.refresh();
  assert.equal(c.controller.getSnapshot().authenticated, false);
  assert.equal(c.controller.getSnapshot().dashboard, null);
  assert.equal(c.controller.getSnapshot().message, "Conductor no autorizado");
  assert.equal(c.storage.has(driverTokenKey), false);
  assert.equal(c.intervals(), 0);
});

test("first visit and demo render without fetch or private values", async () => {
  const c = client();
  await c.controller.start();
  assert.equal(c.calls.length, 0);
  const html = renderToStaticMarkup(createElement(DriverLive, { slug: driver.driverId }));
  assert.match(html, /Ingrese el PIN de este conductor/);
  assert.match(html, /type="password"/);
  for (const value of [pin, phone, "WEB", "Basic", "twilio"]) assert.ok(!html.includes(value));
  const demo = renderToStaticMarkup(createElement(DriverDemo));
  assert.match(demo, /Modo de demostración/);
  assert.match(demo, /Controles de demostración/);
});

test("device session stores PIN only after config and removes it on 401 and logout", async () => {
  let unauthorized = false;
  const c = client(async (url) => unauthorized ? json({}, 401) : json(url.endsWith("config") ? { success: true, driver } : snapshot()));
  await c.controller.login(pin);
  assert.equal(c.storage.get(driverTokenKey), pin);
  assert.equal(c.controller.getSnapshot().authenticated, true);
  assert.ok(c.calls.every(({ url, init }) => !url.includes(pin) && init.headers["X-Device-Token"] === pin));
  unauthorized = true;
  await c.controller.refresh();
  assert.equal(c.storage.has(driverTokenKey), false);
  assert.equal(c.controller.getSnapshot().authenticated, false);
  assert.equal(c.controller.getSnapshot().message, "PIN incorrecto. Inténtelo nuevamente.");
  assert.equal(c.intervals(), 0);
  unauthorized = false;
  await c.controller.login(pin);
  c.controller.logout();
  assert.equal(c.storage.size, 0);
});

test("actions prevent duplicate clicks, leave other deliveries usable, and refresh after success", async () => {
  let release;
  let current = snapshot();
  const c = client(async (url, init) => {
    if (url.endsWith("config")) return json({ success: true, driver });
    if (url.endsWith("dashboard")) return json(current);
    const body = JSON.parse(init.body);
    if (body.action === "accept") {
      await new Promise((resolve) => { release = resolve; });
      current = snapshot({ offers: [], activeDeliveries: [{ ...order(), status: "assigned" }], capacity: { used: 1, maximum: 3, remaining: 2 } });
    } else if (body.action === "pickup") current.activeDeliveries[0].status = "picked_up";
    else if (body.action === "complete") {
      current = snapshot({ offers: [], history: [{ ...order(), status: "completed" }] });
    } else if (body.action === "set_availability") current.driver.available = body.available;
    return json({ success: true });
  });
  await c.controller.login(pin);
  const action = { action: "accept", orderNumber: "#ABCDEF-01" };
  const accepting = c.controller.act(action);
  await c.controller.act(action);
  assert.equal(c.calls.filter(({ url }) => url.endsWith("action")).length, 1);
  assert.equal(c.controller.getSnapshot().pending.has("#ABCDEF-01"), true);
  assert.equal(c.controller.getSnapshot().pending.has("#ABCDEF-02"), false);
  release();
  await accepting;
  assert.equal(c.controller.getSnapshot().dashboard.activeDeliveries[0].status, "assigned");
  await c.controller.act({ action: "pickup", orderNumber: "#ABCDEF-01" });
  assert.equal(c.controller.getSnapshot().dashboard.activeDeliveries[0].status, "picked_up");
  await c.controller.act({ action: "complete", orderNumber: "#ABCDEF-01" });
  assert.equal(c.controller.getSnapshot().dashboard.activeDeliveries.length, 0);
  assert.equal(c.controller.getSnapshot().dashboard.history[0].status, "completed");
  await c.controller.act({ action: "set_availability", available: false });
  assert.equal(c.controller.getSnapshot().dashboard.driver.available, false);
  c.controller.stop();
});

test("409 refreshes offers, blocked offers never call action, temporary errors retain visible data", async () => {
  let current = snapshot();
  let failure = false;
  const c = client(async (url) => {
    if (failure) return json({}, 502);
    if (url.endsWith("config")) return json({ success: true, driver });
    if (url.endsWith("dashboard")) return json(current);
    current = snapshot({ offers: [] });
    return json({}, 409);
  });
  await c.controller.login(pin);
  await c.controller.act({ action: "accept", orderNumber: "#ABCDEF-01" });
  assert.deepEqual(c.controller.getSnapshot().dashboard.offers, []);
  assert.match(c.controller.getSnapshot().message, /Conflicto/);
  current = snapshot({ offers: [{ ...order(), canAccept: false, blockReason: "Pedido tomado" }] });
  await c.controller.refresh();
  const before = c.calls.length;
  await c.controller.act({ action: "accept", orderNumber: "#ABCDEF-01" });
  assert.equal(c.calls.length, before);
  const saved = c.controller.getSnapshot().dashboard;
  failure = true;
  await c.controller.act({ action: "set_availability", available: false });
  assert.equal(c.controller.getSnapshot().dashboard, saved);
  assert.equal(saved.driver.available, true);
  await c.controller.refresh();
  assert.equal(c.controller.getSnapshot().dashboard, saved);
  c.controller.stop();
});

test("polling only while visible, config only at session load, cleanup prevents duplicate intervals", async () => {
  const c = client();
  c.storage.set(driverTokenKey, pin);
  await c.controller.start();
  assert.equal(c.intervals(), 1);
  c.setVisible(false);
  c.poll();
  await tick();
  assert.equal(c.calls.length, 2);
  c.setVisible(true);
  c.poll();
  await tick();
  assert.equal(c.calls.length, 3);
  assert.equal(c.calls.filter(({ url }) => url.endsWith("config")).length, 1);
  c.controller.stop();
  await c.controller.start();
  assert.equal(c.intervals(), 1, "React strict-mode remount restores one session interval");
  c.controller.stop();
  const before = c.calls.length;
  c.poll();
  assert.equal(c.calls.length, before);
});

test("different deliveries process concurrently; stale dashboard replies cannot overwrite an action refresh", async () => {
  let resolvePickup;
  let resolveStale;
  let holdDashboard = false;
  const current = snapshot({ offers: [], activeDeliveries: [
    { ...order(1, "la-fonda"), status: "assigned" },
    { ...order(2, "brisas"), status: "assigned" },
  ], capacity: { used: 2, maximum: 3, remaining: 1 } });
  const c = client(async (url, init) => {
    if (url.endsWith("config")) return json({ success: true, driver });
    if (url.endsWith("dashboard")) {
      if (holdDashboard) {
        holdDashboard = false;
        return new Promise((resolve) => { resolveStale = () => resolve(json(snapshot())); });
      }
      return json(current);
    }
    const action = JSON.parse(init.body);
    if (action.orderNumber === "#ABCDEF-01") await new Promise((resolve) => { resolvePickup = resolve; });
    current.activeDeliveries.find((delivery) => delivery.orderNumber === action.orderNumber).status = "picked_up";
    return json({ success: true });
  });
  await c.controller.login(pin);
  holdDashboard = true;
  const stale = c.controller.refresh();
  const first = c.controller.act({ action: "pickup", orderNumber: "#ABCDEF-01" });
  await c.controller.act({ action: "pickup", orderNumber: "#ABCDEF-02" });
  assert.equal(c.controller.getSnapshot().pending.has("#ABCDEF-01"), true);
  assert.equal(c.controller.getSnapshot().dashboard.activeDeliveries[1].status, "picked_up");
  resolveStale();
  await stale;
  assert.equal(c.controller.getSnapshot().dashboard.activeDeliveries.length, 2);
  resolvePickup();
  await first;
  assert.ok(c.controller.getSnapshot().dashboard.activeDeliveries.every((delivery) => delivery.status === "picked_up"));
  c.controller.stop();
});

test("strict-mode cleanup during session restoration and logout invalidate late responses", async () => {
  let resolveConfig;
  let hold = true;
  const c = client(async (url) => {
    if (url.endsWith("config") && hold) {
      hold = false;
      return new Promise((resolve) => { resolveConfig = () => resolve(json({ success: true, driver })); });
    }
    return json(url.endsWith("config") ? { success: true, driver } : snapshot());
  });
  c.storage.set(driverTokenKey, pin);
  const abandoned = c.controller.start();
  assert.equal(c.controller.getSnapshot().loading, true);
  c.controller.stop();
  await c.controller.start();
  assert.equal(c.intervals(), 1);
  c.controller.logout();
  resolveConfig();
  await abandoned;
  assert.equal(c.controller.getSnapshot().authenticated, false);
  assert.equal(c.storage.size, 0);
  assert.equal(c.intervals(), 0);
});

test("shared presentation supports disabled offers, missing dates, independent pickup, and completion confirmation", () => {
  const offer = { ...order(), offerId: "#ABCDEF-01", createdAt: "", assignedAt: null, pickedUpAt: null, completedAt: null, status: "available" };
  const html = renderToStaticMarkup(createElement(OfferCard, { offer, nowMs: 1, loading: false, actionsDisabled: false,
    acceptBlockedReason: "Pedido tomado", disableBlocked: true, onAccept() {}, onDecline() {} }));
  assert.match(html, /disabled=""/);
  assert.match(html, /Pedido tomado/);
  const active = renderToStaticMarkup(createElement(ActiveDeliveryCard, { delivery: { ...order(), offerId: "#ABCDEF-01",
    driverName: "Maria Elizabeth", status: "assigned", pickedUpAt: null, completedAt: null },
    loading: false, disabled: false, onConfirmPickup() {}, onRequestCompletion() {} }));
  assert.match(active, /CONFIRMAR RECOGIDA/);
  assert.ok(!active.includes("Invalid Date"));
  const confirm = renderToStaticMarkup(createElement(DriverConfirmDialog, { open: true, title: "¿Confirma que entregó el pedido al cliente?",
    confirmLabel: "COMPLETAR ENTREGA", busy: false, onConfirm() {}, onCancel() {} }));
  assert.match(confirm, /<dialog/);
  assert.match(confirm, /COMPLETAR ENTREGA/);
});
