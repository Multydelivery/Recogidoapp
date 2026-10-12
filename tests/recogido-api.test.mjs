import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { POST as createRoute } from "../src/app/api/dispatch/request/route.ts";
import { POST as cancelRoute } from "../src/app/api/dispatch/cancel/route.ts";
import { POST as resendRoute } from "../src/app/api/dispatch/resend/route.ts";
import { GET as configRoute } from "../src/app/api/dispatch/config/route.ts";
import { GET as restaurantConfigRoute } from "../src/app/api/dispatch/restaurants/[restaurantId]/config/route.ts";
import { GET as recentRoute } from "../src/app/api/dispatch/recent/route.ts";
import { GET as statusRoute } from "../src/app/api/dispatch/status/route.ts";
import { createDeliveryRequest, RecogidoApiError } from "../src/lib/dispatch/recogido-api.ts";
import {
  getDispatchCapabilities,
  isLiveTestConfigurationIncomplete,
  resolveDispatchMode,
} from "../src/lib/dispatch/server/config.ts";

const secret = "test-only-central-secret";
const restaurants = [
  { slug: "la-fonda", name: "La Fonda", phone: "+15550100101", deviceToken: "111111", active: true, deliveryEnabled: true, maxDeliveries: 3, assignmentMode: "individual", maxActiveDeliveriesPerDriver: 1 },
  { slug: "brisas", name: "Brisas", phone: "+15550100102", deviceToken: "222222", active: true, deliveryEnabled: true, maxDeliveries: 5, assignmentMode: "batch", maxActiveDeliveriesPerDriver: 5 },
  { slug: "jade-lee", name: "Jade Lee", phone: "+15550100103", deviceToken: "333333", active: true, deliveryEnabled: true, maxDeliveries: 5, assignmentMode: "batch", maxActiveDeliveriesPerDriver: 5 },
  { slug: "restaurante-prueba", name: "Restaurante de prueba", phone: "+15550100104", deviceToken: "444444", active: true, deliveryEnabled: true, maxDeliveries: 3, assignmentMode: "individual", maxActiveDeliveriesPerDriver: 1 },
  { slug: "restaurant-test", name: "Restaurante de prueba", phone: "+15550100105", deviceToken: "555555", active: true, deliveryEnabled: true, maxDeliveries: 3, assignmentMode: "individual", maxActiveDeliveriesPerDriver: 1 },
];
const initialEnv = { ...process.env };
let ipIndex = 1;
const logs = [];

function configureMock() {
  process.env.DISPATCH_MOCK_MODE = "true";
  process.env.RESTAURANTS_JSON = JSON.stringify(restaurants);
  delete process.env.RECOGIDO_DISPATCH_SUBMIT_URL;
  delete process.env.RECOGIDO_DISPATCH_CONFIG_URL;
  delete process.env.RECOGIDO_DISPATCH_STATUS_URL;
  delete process.env.RECOGIDO_DISPATCH_CANCEL_URL;
  delete process.env.RECOGIDO_DISPATCH_RESEND_URL;
  delete process.env.RECOGIDO_DISPATCH_HISTORY_URL;
  delete process.env.RECOGIDO_DISPATCH_MAKE_WEBHOOK_URL;
  delete process.env.RECOGIDO_DISPATCH_API_SECRET;
  for (const name of [
    "TWILIO_WEB_CREATE_URL",
    "TWILIO_WEB_CONFIG_URL",
    "TWILIO_WEB_STATUS_URL",
    "TWILIO_WEB_CANCEL_URL",
    "TWILIO_WEB_RESEND_URL",
    "TWILIO_WEB_HISTORY_URL",
    "TWILIO_WEB_AUTH_USERNAME",
    "TWILIO_WEB_AUTH_PASSWORD",
    "MAKE_TIMER_WEBHOOK_URL",
    "MAKE_TIMER_SECRET",
  ]) delete process.env[name];
  process.env.DISPATCH_LIVE_TEST_ENABLED = "false";
  process.env.DISPATCH_LIVE_TEST_RESTAURANT_ID = "restaurant-test";
  process.env.DISPATCH_REQUEST_TIMEOUT_MS = "10000";
  globalThis.recogidoDispatchMock = { requests: new Map(), keys: new Map() };
  globalThis.recogidoDispatchRateLimits = new Map();
  globalThis.recogidoMakeTimersStarted = new Set();
}

function configureLiveTest() {
  configureMock();
  process.env.DISPATCH_LIVE_TEST_ENABLED = "true";
  process.env.TWILIO_WEB_CREATE_URL = "https://recogido.example.test/web-create";
  process.env.TWILIO_WEB_CONFIG_URL = "https://recogido.example.test/web-config";
  process.env.TWILIO_WEB_STATUS_URL = "https://recogido.example.test/web-status";
  process.env.TWILIO_WEB_CANCEL_URL = "https://recogido.example.test/web-cancel";
  process.env.TWILIO_WEB_RESEND_URL = "https://recogido.example.test/web-resend";
  process.env.TWILIO_WEB_HISTORY_URL = "https://recogido.example.test/web-history";
  process.env.TWILIO_WEB_AUTH_USERNAME = "test-web-user";
  process.env.TWILIO_WEB_AUTH_PASSWORD = "test-web-password";
  process.env.MAKE_TIMER_WEBHOOK_URL = "https://make.example.test/timer";
  process.env.MAKE_TIMER_SECRET = secret;
  process.env.DISPATCH_REQUEST_TIMEOUT_MS = "10000";
}

function configurePilotMinimum() {
  configureLiveTest();
  delete process.env.TWILIO_WEB_CANCEL_URL;
  delete process.env.TWILIO_WEB_RESEND_URL;
  delete process.env.TWILIO_WEB_HISTORY_URL;
}

const validRestaurantTestConfiguration = {
  success: true,
  restaurantId: "restaurant-test",
  restaurant: {
    restaurantId: "restaurant-test",
    name: "Restaurante de prueba",
    active: true,
    deliveryEnabled: true,
    maxDeliveries: 3,
    assignmentMode: "individual",
    maxActiveDeliveriesPerDriver: 1,
  },
};

function liveParent(requestId, { assigned = 0, cancelled = false } = {}) {
  const children = Array.from({ length: 3 }, (_, index) => ({
    requestId: `${requestId}_${index + 1}`,
    deliveryNumber: index + 1,
    status: index < assigned ? "claimed" : cancelled ? "cancelled" : "open",
    ...(index < assigned ? { winnerName: `Conductor ${index + 1}`, claimedAt: "2026-10-12T18:00:00.000Z", winnerPhone: "+15550000000" } : {}),
  }));
  return {
    success: true,
    restaurantId: "restaurant-test",
    request: {
      requestId,
      requestType: "parent",
      parentRequestId: requestId,
      requestedDeliveries: 3,
      assignedDeliveries: assigned,
      pendingDeliveries: cancelled ? 0 : 3 - assigned,
      assignmentMode: "individual",
      status: cancelled ? "cancelled" : assigned ? "partially_assigned" : "open",
      createdAt: "2026-10-12T18:00:00.000Z",
      updatedAt: "2026-10-12T18:00:00.000Z",
      children,
    },
  };
}

function createRequest(path, slug, body, token) {
  const restaurant = restaurants.find((entry) => entry.slug === slug);
  return new Request(`https://app.example.test/api/dispatch/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token ?? restaurant?.deviceToken ?? ""}`,
      "Content-Type": "application/json",
      "x-forwarded-for": `192.0.2.${ipIndex++}`,
    },
    body: JSON.stringify({ restaurant: slug, ...body }),
  });
}

function getRequest(path, slug, params = {}, token) {
  const query = new URLSearchParams({ restaurant: slug, ...params });
  const restaurant = restaurants.find((entry) => entry.slug === slug);
  return new Request(`https://app.example.test/api/dispatch/${path}?${query}`, {
    headers: {
      Authorization: `Bearer ${token ?? restaurant?.deviceToken ?? ""}`,
      "x-forwarded-for": `192.0.2.${ipIndex++}`,
    },
  });
}

async function callCreate(slug, deliveryCount, idempotencyKey = randomUUID()) {
  const response = await createRoute(createRequest("request", slug, { deliveryCount, idempotencyKey }));
  return { response, data: await response.json() };
}

function assertNoPrivateData(value) {
  const text = JSON.stringify(value);
  for (const restaurant of restaurants) {
    assert.ok(!text.includes(restaurant.deviceToken), "Response exposed a PIN/token");
    assert.ok(!text.includes(restaurant.phone), "Response exposed the restaurant phone");
  }
  assert.ok(!text.includes(secret), "Response exposed the integration secret");
}

test("dispatch configuration, mock contract, and server adapter", { timeout: 20_000 }, async (t) => {
  const previousFetch = globalThis.fetch;
  const previousInfo = console.info;
  const previousWarn = console.warn;
  const previousError = console.error;
  console.info = (...args) => logs.push(args);
  console.warn = (...args) => logs.push(args);
  console.error = (...args) => logs.push(args);
  try {
    await t.test("restaurant-specific configuration and server-side quantity limits", async () => {
      configureMock();
      for (const [slug, maximum, mode] of [
        ["la-fonda", 3, "individual"],
        ["brisas", 5, "batch"],
        ["jade-lee", 5, "batch"],
      ]) {
        const response = await configRoute(getRequest("config", slug));
        const data = await response.json();
        assert.equal(response.status, 200);
        assert.equal(data.restaurant.maxDeliveries, maximum);
        assert.equal(data.restaurant.assignmentMode, mode);
        assertNoPrivateData(data);
      }
      const [accepted] = await Promise.all([callCreate("la-fonda", 3)]);
      assert.equal(accepted.response.status, 201);
      const rejected = await callCreate("la-fonda", 4);
      assert.equal(rejected.response.status, 400);
      assert.match(rejected.data.error, /1 y 3/);
      assertNoPrivateData(rejected.data);
    });

    await t.test("individual creates N child requests; concurrent double-click is idempotent", async () => {
      configureMock();
      const result = await callCreate("la-fonda", 3, "individual-click-key-1");
      assert.equal(result.response.status, 201);
      assert.equal(result.data.request.requestType, "parent");
      assert.equal(result.data.request.childRequestIds.length, 3);
      assert.deepEqual(result.data.request.deliveries.map((item) => item.status), ["open", "open", "open"]);
      assert.match(result.data.request.requestId, /^WEB_[a-f0-9]{32}$/);

      const key = "double-click-idempotency-key";
      const responses = await Promise.all([
        callCreate("brisas", 5, key),
        callCreate("brisas", 5, key),
      ]);
      assert.deepEqual(responses.map(({ response }) => response.status).sort(), [200, 201]);
      assert.equal(new Set(responses.map(({ data }) => data.request.requestId)).size, 1);
      assertNoPrivateData(result.data);
    });

    await t.test("batch creates one request and isolates status/history by restaurant", async () => {
      configureMock();
      const result = await callCreate("brisas", 5);
      assert.equal(result.response.status, 201);
      assert.equal(result.data.request.requestType, "batch");
      assert.equal(result.data.request.assignmentMode, "batch");
      assert.equal(result.data.request.deliveryCount, 5);
      assert.deepEqual(result.data.request.childRequestIds, []);
      assert.deepEqual(result.data.request.deliveries, []);

      const isolated = await statusRoute(getRequest("status", "jade-lee", { requestId: result.data.request.requestId }));
      assert.equal(isolated.status, 404);
      const recent = await recentRoute(getRequest("recent", "jade-lee"));
      assert.equal((await recent.json()).history.length, 0);
      assertNoPrivateData(result.data);
    });

    await t.test("cancellation keeps assigned deliveries and touches only open children", async () => {
      configureMock();
      const created = await callCreate("la-fonda", 3);
      const entry = globalThis.recogidoDispatchMock.requests.get(created.data.request.requestId);
      entry.request.createdAt = new Date(Date.now() - 9_000).toISOString();
      const status = await statusRoute(getRequest("status", "la-fonda", { requestId: entry.request.requestId }));
      const statusData = await status.json();
      assert.equal(statusData.request.assignedDeliveries, 1);
      assert.equal(statusData.request.remainingDeliveries, 2);

      const response = await cancelRoute(createRequest("cancel", "la-fonda", { requestId: entry.request.requestId }));
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.request.status, "cancelled");
      assert.deepEqual(data.request.deliveries.map((item) => item.status), ["claimed", "cancelled", "cancelled"]);
      assert.equal(data.request.assignedDeliveries, 1);
      assert.equal(data.request.remainingDeliveries, 0);
      assertNoPrivateData(data);
    });

    await t.test("resend targets only open individual deliveries", async () => {
      configureMock();
      const created = await callCreate("la-fonda", 3);
      const rootId = created.data.request.requestId;
      const entry = globalThis.recogidoDispatchMock.requests.get(rootId);
      entry.request.createdAt = new Date(Date.now() - 9_000).toISOString();
      await statusRoute(getRequest("status", "la-fonda", { requestId: rootId }));
      const response = await resendRoute(createRequest("resend", "la-fonda", { requestId: rootId }));
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.deepEqual(entry.lastOfferedRequestIds, [`${rootId}_2`, `${rootId}_3`]);
      assert.deepEqual(data.request.deliveries.map((item) => item.status), ["claimed", "open", "open"]);
    });

    await t.test("PIN ownership, bounded history, and mock mode never call external services", async () => {
      configureMock();
      let externalCalls = 0;
      globalThis.fetch = async () => { externalCalls++; throw new Error(secret); };
      const invalidAuth = await statusRoute(getRequest("status", "la-fonda", {}, "wrong-pin"));
      assert.equal(invalidAuth.status, 401);
      for (let count = 1; count <= 6; count++) {
        const created = await callCreate("restaurante-prueba", count > 3 ? 3 : count);
        if (created.response.status === 201) {
          await cancelRoute(createRequest("cancel", "restaurante-prueba", { requestId: created.data.request.requestId }));
        }
      }
      const response = await recentRoute(getRequest("recent", "restaurante-prueba"));
      const data = await response.json();
      assert.equal(data.history.length, 5);
      assert.equal(externalCalls, 0);
      assertNoPrivateData(data);
    });

    await t.test("external responses echoing secrets are rejected and sanitized", async () => {
      configureMock();
      process.env.DISPATCH_MOCK_MODE = "false";
      process.env.RECOGIDO_DISPATCH_SUBMIT_URL = "https://central.example.test/create";
      process.env.RECOGIDO_DISPATCH_MAKE_WEBHOOK_URL = "https://make.example.test/webhook";
      process.env.RECOGIDO_DISPATCH_API_SECRET = secret;
      globalThis.fetch = async () => Response.json({
        success: true,
        restaurantId: "la-fonda",
        requestId: `WEB_${randomUUID().replaceAll("-", "")}`,
        requestType: "parent",
        parentRequestId: `WEB_${randomUUID().replaceAll("-", "")}`,
        deliveryCount: 1,
        status: "open",
        createdAt: new Date().toISOString(),
        driverName: secret,
      });
      await assert.rejects(
        createDeliveryRequest({
          restaurantId: "la-fonda",
          restaurantName: "La Fonda",
          restaurantPhone: restaurants[0].phone,
          deliveryCount: 1,
          requestId: `WEB_${randomUUID().replaceAll("-", "")}`,
          idempotencyKey: "secret-echo-idempotency",
          configuration: {
            slug: "la-fonda",
            name: "La Fonda",
            active: true,
            deliveryEnabled: true,
            maxDeliveries: 3,
            assignmentMode: "individual",
            maxActiveDeliveriesPerDriver: 1,
          },
        }),
        (error) => error instanceof RecogidoApiError && error.code === "invalid_response" && !error.message.includes(secret),
      );
      assert.ok(!JSON.stringify(logs).includes(secret), "Logs exposed the integration secret");
    });

    await t.test("live-test flag gates only restaurant-test; disabled and other restaurants stay mock", async () => {
      configureMock();
      let calls = 0;
      globalThis.fetch = async () => { calls++; throw new Error("External calls must not be made"); };
      const disabled = await callCreate("restaurant-test", 1, "live-test-disabled-key");
      assert.equal(disabled.response.status, 201);
      assert.equal(disabled.data.mockMode, true);

      configureLiveTest();
      const nonPilot = await callCreate("brisas", 1, "non-pilot-remains-mock-key");
      assert.equal(nonPilot.response.status, 201);
      assert.equal(nonPilot.data.mockMode, true);
      assert.equal(calls, 0);
    });

    await t.test("pilot works with only required URLs; optional live features remain unavailable without external calls", async () => {
      configurePilotMinimum();
      const capabilities = getDispatchCapabilities("restaurant-test");
      assert.deepEqual(capabilities, {
        liveDispatch: true,
        canCreate: true,
        canReadStatus: true,
        canCancel: false,
        canResend: false,
        canLoadHistory: false,
      });
      assert.equal(isLiveTestConfigurationIncomplete("restaurant-test"), false);
      assert.equal(resolveDispatchMode("restaurant-test"), "twilio");
      assert.equal(resolveDispatchMode("brisas"), "mock");
      assert.equal(getDispatchCapabilities("brisas").canLoadHistory, true);

      const requestId = `WEB_${randomUUID().replaceAll("-", "")}`;
      let externalCalls = 0;
      globalThis.fetch = async (url, options) => {
        externalCalls++;
        if (String(url).endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
        if (String(url).endsWith("/web-create")) {
          const id = new URLSearchParams(options.body).get("requestId");
          return Response.json(liveParent(id));
        }
        if (String(url).endsWith("/timer")) return new Response(null, { status: 204 });
        if (String(url).endsWith("/web-status")) return Response.json(liveParent(requestId, { assigned: 1 }));
        throw new Error("Unexpected test endpoint");
      };

      const created = await callCreate("restaurant-test", 1, "minimum-pilot-create-key");
      assert.equal(created.response.status, 201);
      assert.equal(created.data.mockMode, false);
      const status = await statusRoute(getRequest("status", "restaurant-test", { requestId }));
      assert.equal(status.status, 200);
      const statusData = await status.json();
      assert.equal(statusData.request.status, "partially_claimed");

      let blockedOptionalCalls = 0;
      globalThis.fetch = async () => { blockedOptionalCalls++; throw new Error("Optional endpoint must not be called"); };
      const optionalResponses = await Promise.all([
        cancelRoute(createRequest("cancel", "restaurant-test", { requestId })),
        resendRoute(createRequest("resend", "restaurant-test", { requestId })),
        recentRoute(getRequest("recent", "restaurant-test")),
      ]);
      for (const response of optionalResponses) {
        assert.equal(response.status, 503);
        assert.deepEqual(await response.json(), {
          success: false,
          code: "FEATURE_NOT_CONFIGURED",
          error: "This feature is not configured for the live pilot",
        });
      }
      assert.equal(blockedOptionalCalls, 0);
      assertNoPrivateData(created.data);
      assertNoPrivateData(statusData);
      assert.equal(externalCalls, 5, "All upstream requests were handled by the test fetch stub");
    });

    await t.test("missing CREATE or STATUS marks the pilot incomplete without exposing values", async () => {
      configurePilotMinimum();
      delete process.env.TWILIO_WEB_CREATE_URL;
      assert.equal(isLiveTestConfigurationIncomplete("restaurant-test"), true);
      assert.equal(getDispatchCapabilities("restaurant-test").canCreate, false);
      assert.equal(getDispatchCapabilities("restaurant-test").liveDispatch, false);

      configurePilotMinimum();
      delete process.env.TWILIO_WEB_STATUS_URL;
      assert.equal(isLiveTestConfigurationIncomplete("restaurant-test"), true);
      assert.equal(getDispatchCapabilities("restaurant-test").canReadStatus, false);
      assert.equal(getDispatchCapabilities("restaurant-test").liveDispatch, false);
    });

    await t.test("pilot creation uses server-owned phone, stable request id, Basic Auth, and one Make timer", async () => {
      configureLiveTest();
      const calls = [];
      globalThis.fetch = async (url, options) => {
        const fields = new URLSearchParams(options.body);
        calls.push({ url: String(url), options, fields });
        if (String(url).endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
        if (String(url).endsWith("/web-create")) {
          return Response.json(liveParent(fields.get("requestId")));
        }
        if (String(url).endsWith("/timer")) return new Response(null, { status: 204 });
        throw new Error("Unexpected integration endpoint");
      };
      const request = (key) => createRoute(createRequest("request", "restaurant-test", {
        restaurantId: "restaurant-test",
        deliveryCount: 3,
        idempotencyKey: key,
      }));
      const first = await request("pilot-stable-idempotency-key");
      const firstData = await first.json();
      const second = await request("pilot-stable-idempotency-key");
      const secondData = await second.json();
      assert.equal(first.status, 201);
      assert.equal(second.status, 201);
      assert.equal(firstData.mockMode, false);
      assert.equal(firstData.request.requestId, secondData.request.requestId);
      assert.match(firstData.request.requestId, /^WEB_[a-f0-9]{32}$/);
      const createCalls = calls.filter((call) => call.url.endsWith("/web-create"));
      assert.equal(createCalls.length, 2);
      assert.equal(createCalls[0].fields.get("requestId"), createCalls[1].fields.get("requestId"));
      assert.equal(createCalls[0].fields.get("idempotencyKey"), "pilot-stable-idempotency-key");
      assert.equal(createCalls[0].fields.get("restaurantPhone"), restaurants.find(({ slug }) => slug === "restaurant-test").phone);
      assert.equal(createCalls[0].fields.has("secret"), false);
      assert.equal(createCalls[0].options.headers.Authorization, `Basic ${Buffer.from("test-web-user:test-web-password").toString("base64")}`);
      assert.equal(calls.filter((call) => call.url.endsWith("/timer")).length, 1);
      assert.equal(calls.find((call) => call.url.endsWith("/timer")).fields.get("secret"), secret);
      assertNoPrivateData(firstData);

      const tampered = await createRoute(createRequest("request", "restaurant-test", {
        restaurantId: "restaurant-test",
        deliveryCount: 1,
        idempotencyKey: "tamper-phone-key",
        restaurantPhone: "+15550000000",
      }));
      assert.equal(tampered.status, 400);
    });

    await t.test("pilot config validates profile and UI-safe configuration errors", async () => {
      configureLiveTest();
      globalThis.fetch = async (_url, options) => {
        assert.equal(options.cache, "no-store");
        return Response.json(validRestaurantTestConfiguration);
      };
      const configured = await configRoute(getRequest("config", "restaurant-test"));
      const data = await configured.json();
      assert.equal(data.mockMode, false);
      assert.deepEqual(data.restaurant, {
        slug: "restaurant-test",
        name: "Restaurante de prueba",
        active: true,
        deliveryEnabled: true,
        maxDeliveries: 3,
        assignmentMode: "individual",
        maxActiveDeliveriesPerDriver: 1,
      });
      assertNoPrivateData(data);

      const invalidProfile = structuredClone(validRestaurantTestConfiguration);
      invalidProfile.restaurant.maxDeliveries = 5;
      globalThis.fetch = async () => Response.json(invalidProfile);
      const invalid = await configRoute(getRequest("config", "restaurant-test"));
      assert.equal(invalid.status, 503);
      assert.ok(!JSON.stringify(await invalid.json()).includes("https://"));
    });

    await t.test("partial parent status normalizes children and suppresses driver phone", async () => {
      configureLiveTest();
      const requestId = `WEB_${randomUUID().replaceAll("-", "")}`;
      globalThis.fetch = async (url) => String(url).endsWith("/web-config")
        ? Response.json(validRestaurantTestConfiguration)
        : Response.json({
          success: true,
          restaurantId: "restaurant-test",
          ...liveParent(requestId, { assigned: 1 }),
        });
      const response = await statusRoute(getRequest("status", "restaurant-test", { requestId }));
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.request.status, "partially_claimed");
      assert.equal(data.request.assignedDeliveries, 1);
      assert.equal(data.request.remainingDeliveries, 2);
      assert.equal(data.request.deliveries[0].driverName, "Conductor 1");
      assert.equal(data.request.deliveries[0].driverPhone, undefined);
      assertNoPrivateData(data);
    });

    await t.test("cancel and resend preserve claimed children and send only open child IDs", async () => {
      configureLiveTest();
      const requestId = `WEB_${randomUUID().replaceAll("-", "")}`;
      const calls = [];
      globalThis.fetch = async (url, options) => {
        const endpoint = String(url);
        const fields = new URLSearchParams(options.body);
        calls.push({ endpoint, fields });
        if (endpoint.endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
        if (endpoint.endsWith("/web-status")) return Response.json(liveParent(requestId, { assigned: 1 }));
        if (endpoint.endsWith("/web-cancel")) return Response.json(liveParent(requestId, { assigned: 1, cancelled: true }));
        if (endpoint.endsWith("/web-resend")) {
          assert.equal(fields.get("openRequestIds"), `${requestId}_2,${requestId}_3`);
          return Response.json(liveParent(requestId, { assigned: 1 }));
        }
        if (endpoint.endsWith("/timer")) return new Response(null, { status: 204 });
        throw new Error("Unexpected integration endpoint");
      };
      const cancelledResponse = await cancelRoute(createRequest("cancel", "restaurant-test", { requestId }));
      const cancelled = await cancelledResponse.json();
      assert.equal(cancelledResponse.status, 200);
      assert.equal(cancelled.request.deliveries[0].status, "claimed");
      assert.equal(cancelled.request.deliveries[1].status, "cancelled");

      const resentResponse = await resendRoute(createRequest("resend", "restaurant-test", { requestId }));
      const resent = await resentResponse.json();
      assert.equal(resentResponse.status, 200);
      assert.equal(resent.request.deliveries[0].status, "claimed");
      assert.equal(calls.filter((call) => call.endpoint.endsWith("/timer")).length, 1);
      assertNoPrivateData(cancelled);
      assertNoPrivateData(resent);
    });

    await t.test("Twilio failure never starts Make; Make failure retains created request", async () => {
      configureLiveTest();
      let timers = 0;
      globalThis.fetch = async (url) => {
        if (String(url).endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
        if (String(url).endsWith("/web-create")) return new Response("not logged", { status: 500 });
        if (String(url).endsWith("/timer")) timers++;
        return new Response(null, { status: 204 });
      };
      const failedTwilio = await createRoute(createRequest("request", "restaurant-test", {
        restaurantId: "restaurant-test",
        deliveryCount: 1,
        idempotencyKey: "twilio-failure-before-make",
      }));
      assert.equal(failedTwilio.status, 502);
      assert.equal(timers, 0);

      configureLiveTest();
      globalThis.recogidoMakeTimersStarted = new Set();
      globalThis.fetch = async (url, options) => {
        if (String(url).endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
        if (String(url).endsWith("/web-create")) {
          const id = new URLSearchParams(options.body).get("requestId");
          return Response.json(liveParent(id));
        }
        if (String(url).endsWith("/timer")) return new Response(null, { status: 503 });
        throw new Error("Unexpected integration endpoint");
      };
      const createdWithTimerError = await createRoute(createRequest("request", "restaurant-test", {
        restaurantId: "restaurant-test",
        deliveryCount: 1,
        idempotencyKey: "timer-error-retains-request",
      }));
      const timerErrorData = await createdWithTimerError.json();
      assert.equal(createdWithTimerError.status, 202);
      assert.equal(timerErrorData.operationStatus, "created_with_timer_error");
      assert.match(timerErrorData.request.requestId, /^WEB_[a-f0-9]{32}$/);
      assertNoPrivateData(timerErrorData);
    });

    await t.test("missing Twilio credentials and endpoints fail closed as NOT_CONFIGURED", async () => {
      configureLiveTest();
      delete process.env.TWILIO_WEB_AUTH_PASSWORD;
      const response = await configRoute(getRequest("config", "restaurant-test"));
      assert.equal(response.status, 503);
      assert.equal((await response.json()).code, "NOT_CONFIGURED");
    });

    await t.test("restaurant terminal PIN authentication: headers, errors, 502 isolation, and secret sanitation", async () => {
      configureLiveTest();
      globalThis.fetch = async (url) => {
        if (String(url).endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
        throw new Error("Unexpected integration endpoint");
      };

      const restaurantContext = { params: Promise.resolve({ restaurantId: "restaurant-test" }) };

      // 1. First visit without PIN / empty header returns 401 with explicit error message
      const noPinRequest = new Request("https://app.example.test/api/dispatch/restaurants/restaurant-test/config", {
        headers: { "x-forwarded-for": `192.0.2.${ipIndex++}` },
      });
      const noPinResponse = await restaurantConfigRoute(noPinRequest, restaurantContext);
      assert.equal(noPinResponse.status, 401);
      const noPinData = await noPinResponse.json();
      assert.equal(noPinData.error, "Token o PIN inválido para este restaurante.");
      assertNoPrivateData(noPinData);

      // 2. Incorrect PIN returns 401
      const wrongPinRequest = new Request("https://app.example.test/api/dispatch/restaurants/restaurant-test/config", {
        headers: {
          "X-Device-Token": "wrong-pin-1234",
          "x-forwarded-for": `192.0.2.${ipIndex++}`,
        },
      });
      const wrongPinResponse = await restaurantConfigRoute(wrongPinRequest, restaurantContext);
      assert.equal(wrongPinResponse.status, 401);
      const wrongPinData = await wrongPinResponse.json();
      assert.equal(wrongPinData.error, "Token o PIN inválido para este restaurante.");
      assertNoPrivateData(wrongPinData);

      // 3. Correct PIN via X-Device-Token succeeds
      const correctPin = restaurants.find((r) => r.slug === "restaurant-test").deviceToken;
      const xDeviceTokenRequest = new Request("https://app.example.test/api/dispatch/restaurants/restaurant-test/config", {
        headers: {
          "X-Device-Token": correctPin,
          "x-forwarded-for": `192.0.2.${ipIndex++}`,
        },
      });
      const validResponse = await restaurantConfigRoute(xDeviceTokenRequest, restaurantContext);
      assert.equal(validResponse.status, 200);
      const validData = await validResponse.json();
      assert.equal(validData.restaurant.slug, "restaurant-test");
      assertNoPrivateData(validData);

      // 4. Correct PIN via Authorization: Bearer also succeeds
      const bearerRequest = new Request("https://app.example.test/api/dispatch/restaurants/restaurant-test/config", {
        headers: {
          Authorization: `Bearer ${correctPin}`,
          "x-forwarded-for": `192.0.2.${ipIndex++}`,
        },
      });
      const bearerResponse = await restaurantConfigRoute(bearerRequest, restaurantContext);
      assert.equal(bearerResponse.status, 200);

      // 5. Slug and restaurant mismatch returns 401
      const mismatchedRequest = new Request("https://app.example.test/api/dispatch/restaurants/la-fonda/config", {
        headers: {
          "X-Device-Token": correctPin,
          "x-forwarded-for": `192.0.2.${ipIndex++}`,
        },
      });
      const mismatchedResponse = await restaurantConfigRoute(mismatchedRequest, { params: Promise.resolve({ restaurantId: "la-fonda" }) });
      assert.equal(mismatchedResponse.status, 401);

      // 6. When Twilio is down, a VALID PIN returns 502, but an INVALID PIN still returns 401 (auth evaluated first)
      globalThis.fetch = async () => new Response("Twilio down", { status: 502 });
      const authFailsBeforeTwilio = await restaurantConfigRoute(wrongPinRequest, restaurantContext);
      assert.equal(authFailsBeforeTwilio.status, 401);

      const twilioDownWithValidPin = await restaurantConfigRoute(xDeviceTokenRequest, restaurantContext);
      assert.equal(twilioDownWithValidPin.status, 502);

      // 7. Verify client PIN storage management: saved PIN deleted on 401/403, retained on 502
      const storage = new Map();
      const storageKey = "recogido:device-token:restaurant-test";
      const legacyKey = "recogido.dispatch.device.restaurant-test";

      // First visit without PIN: storage is empty, no saved PIN
      assert.equal(storage.get(storageKey) ?? storage.get(legacyKey) ?? null, null);

      // On successful authorization: save PIN
      storage.set(storageKey, correctPin);
      assert.equal(storage.get(storageKey), correctPin);

      // On 502 (Twilio outage): PIN is preserved in storage
      assert.equal(twilioDownWithValidPin.status, 502);
      if (twilioDownWithValidPin.status === 401 || twilioDownWithValidPin.status === 403) {
        storage.delete(storageKey);
      }
      assert.equal(storage.get(storageKey), correctPin);

      // On 401 (Invalid/expired PIN): PIN is removed from storage
      assert.equal(wrongPinResponse.status, 401);
      if (wrongPinResponse.status === 401 || wrongPinResponse.status === 403) {
        storage.delete(storageKey);
        storage.delete(legacyKey);
      }
      assert.equal(storage.get(storageKey), undefined);

      // 8. Verify no logs or responses exposed the PIN or secrets
      assert.ok(!JSON.stringify(logs).includes(correctPin), "Logs exposed the PIN");
      assertNoPrivateData(await twilioDownWithValidPin.json());
    });
  } finally {
    globalThis.fetch = previousFetch;
    console.info = previousInfo;
    console.warn = previousWarn;
    console.error = previousError;
    for (const key of Object.keys(process.env)) {
      if (!(key in initialEnv)) delete process.env[key];
    }
    Object.assign(process.env, initialEnv);
  }
});
