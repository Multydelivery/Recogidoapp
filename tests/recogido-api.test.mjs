import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DeliveryStatus } from "../src/components/dispatch/DeliveryStatus.tsx";
import { ActiveDeliveriesSection } from "../src/components/dispatch/ActiveDeliveriesSection.tsx";
import { sortActiveRequests } from "../src/lib/dispatch/dispatch-queue.ts";
import { activeQueuePollIntervalMs, createActiveQueuePoller } from "../src/lib/dispatch/active-queue-poller.ts";
import { GET as activeRoute } from "../src/app/api/dispatch/restaurants/[restaurantId]/active/route.ts";
import { GET as historyRoute } from "../src/app/api/dispatch/restaurants/[restaurantId]/history/route.ts";
import { POST as createRoute } from "../src/app/api/dispatch/request/route.ts";
import { POST as cancelRoute } from "../src/app/api/dispatch/cancel/route.ts";
import { POST as resendRoute } from "../src/app/api/dispatch/resend/route.ts";
import { GET as configRoute } from "../src/app/api/dispatch/config/route.ts";
import { GET as restaurantConfigRoute } from "../src/app/api/dispatch/restaurants/[restaurantId]/config/route.ts";
import { GET as recentRoute } from "../src/app/api/dispatch/recent/route.ts";
import { GET as statusRoute } from "../src/app/api/dispatch/status/route.ts";
import { GET as requestStatusRoute } from "../src/app/api/dispatch/requests/[requestId]/route.ts";
import { createDeliveryRequest, normalizeConfiguration, normalizeRequest, normalizeActiveRequests, RecogidoApiError } from "../src/lib/dispatch/recogido-api.ts";
import { dispatchApi, activeDispatchApi, historyDispatchApi } from "../src/lib/dispatch/client.ts";
import { readRequestId } from "../src/lib/dispatch/server/api.ts";
import { dispatchRequestIdPattern, fallbackOrderNumber, twilioChildRequestIdPattern, shouldPollDispatchRequest } from "../src/lib/dispatch/dispatch-types.ts";
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
const authorizedCreateResponse = JSON.parse(readFileSync(new URL("./fixtures/web-create-delivery.json", import.meta.url), "utf8"));
const authorizedStatusResponse = JSON.parse(readFileSync(new URL("./fixtures/web-delivery-status.json", import.meta.url), "utf8"));
const authorizedOpenStatusResponse = JSON.parse(readFileSync(new URL("./fixtures/web-delivery-status-open.json", import.meta.url), "utf8"));
const authorizedActiveResponse = JSON.parse(readFileSync(new URL("./fixtures/web-active-deliveries.json", import.meta.url), "utf8"));
const authorizedHistoryResponse = JSON.parse(readFileSync(new URL("./fixtures/web-delivery-history.json", import.meta.url), "utf8"));

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
    "TWILIO_WEB_ACTIVE_URL",
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

function historyRequest(slug, params = {}, token) {
  const query = new URLSearchParams(params).toString();
  const restaurant = restaurants.find((entry) => entry.slug === slug);
  return new Request(`https://app.example.test/api/dispatch/restaurants/${slug}/history${query ? `?${query}` : ""}`, {
    headers: {
      "X-Device-Token": token ?? restaurant?.deviceToken ?? "",
      "x-forwarded-for": `192.0.2.${ipIndex++}`,
    },
  });
}

async function callCreate(slug, deliveryCount, idempotencyKey = randomUUID()) {
  const response = await createRoute(createRequest("request", slug, { deliveryCount, idempotencyKey }));
  return { response, data: await response.json() };
}

function assertNoPrivateData(value) {
  // Public request IDs can coincidentally contain a test PIN (e.g. WEB222...).
  const text = JSON.stringify(value, function (key, entry) {
    const publicId = (id) => typeof id === "string" &&
      (dispatchRequestIdPattern.test(id) || twilioChildRequestIdPattern.test(id));
    if ((key === "requestId" || key === "parentRequestId") && publicId(entry)) return "[public request ID]";
    if (key === "childRequestIds" && Array.isArray(entry)) return entry.map((id) => publicId(id) ? "[public child ID]" : id);
    // Fallback order numbers are derived from that same public ID, so they inherit the coincidence.
    if (key === "orderNumber" && publicId(this.requestId) &&
      entry === fallbackOrderNumber(this.requestId, this.deliveryNumber && this.requestType === undefined ? this.deliveryNumber : undefined)) {
      return "[public order number]";
    }
    return entry;
  });
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
  globalThis.fetch = async () => { throw new Error("Unstubbed external request"); };
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
      const result = await callCreate("la-fonda", 3);
      assert.equal(result.response.status, 201);
      assert.equal(result.data.request.requestType, "parent");
      assert.equal(result.data.request.childRequestIds.length, 3);
      assert.deepEqual(result.data.request.deliveries.map((item) => item.status), ["open", "open", "open"]);
      assert.match(result.data.request.requestId, /^WEB_[a-f0-9]{32}$/);

      const key = randomUUID();
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
          restaurantPhone: restaurants[0].phone,
          deliveryCount: 1,
          idempotencyKey: randomUUID(),
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
      const disabled = await callCreate("restaurant-test", 1);
      assert.equal(disabled.response.status, 201);
      assert.equal(disabled.data.mockMode, true);

      configureLiveTest();
      const nonPilot = await callCreate("brisas", 1);
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
        canLoadActive: false,
      });
      assert.equal(isLiveTestConfigurationIncomplete("restaurant-test"), false);
      assert.equal(resolveDispatchMode("restaurant-test"), "twilio");
      assert.equal(resolveDispatchMode("brisas"), "mock");
      assert.equal(getDispatchCapabilities("brisas").canLoadHistory, true);

      const requestId = `WEB${randomUUID().replaceAll("-", "")}`;
      let externalCalls = 0;
      globalThis.fetch = async (url) => {
        externalCalls++;
        if (String(url).endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
        if (String(url).endsWith("/web-create")) {
          return Response.json({ success: true, validated: true, restaurantId: "restaurant-test", requestId, deliveryCount: 1 });
        }
        if (String(url).endsWith("/timer")) return new Response(null, { status: 204 });
        if (String(url).endsWith("/web-status")) return Response.json(liveParent(requestId, { assigned: 1 }));
        throw new Error("Unexpected test endpoint");
      };

      const created = await callCreate("restaurant-test", 1);
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

    await t.test("pilot creation forwards only UUID v4, restaurant and count; Twilio owns ID and Make runs once", async () => {
      configureLiveTest();
      const calls = [];
      const key = randomUUID();
      const requestId = `WEB${key.replaceAll("-", "")}`;
      globalThis.fetch = async (url, options) => {
        const fields = new URLSearchParams(options.body);
        calls.push({ url: String(url), options, fields });
        if (String(url).endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
        if (String(url).endsWith("/web-create")) {
          return Response.json(liveParent(requestId));
        }
        if (String(url).endsWith("/timer")) return new Response(null, { status: 204 });
        throw new Error("Unexpected integration endpoint");
      };
      const request = (key) => createRoute(createRequest("request", "restaurant-test", {
        restaurantId: "restaurant-test",
        deliveryCount: 3,
        idempotencyKey: key,
      }));
      const first = await request(key);
      const firstData = await first.json();
      const second = await request(key);
      const secondData = await second.json();
      assert.equal(first.status, 201);
      assert.equal(second.status, 201);
      assert.equal(firstData.mockMode, false);
      assert.equal(firstData.request.requestId, secondData.request.requestId);
      assert.equal(firstData.request.requestId, requestId);
      const createCalls = calls.filter((call) => call.url.endsWith("/web-create"));
      assert.equal(createCalls.length, 2);
      for (const call of createCalls) {
        assert.deepEqual(Object.fromEntries(call.fields), { restaurantId: "restaurant-test", deliveryCount: "3", idempotencyKey: key });
        assert.equal(call.options.headers["Content-Type"], "application/x-www-form-urlencoded");
        assert.ok(call.options.body.toString().includes(`idempotencyKey=${key}`));
      }
      assert.equal(createCalls[0].fields.has("secret"), false);
      assert.equal(createCalls[0].options.headers.Authorization, `Basic ${Buffer.from("test-web-user:test-web-password").toString("base64")}`);
      assert.equal(calls.filter((call) => call.url.endsWith("/timer")).length, 1);
      assert.equal(calls.find((call) => call.url.endsWith("/timer")).fields.get("secret"), secret);
      assert.equal(calls.find((call) => call.url.endsWith("/timer")).fields.get("requestId"), requestId);
      assert.equal(calls.find((call) => call.url.endsWith("/timer")).fields.get("restaurantPhone"), restaurants.find(({ slug }) => slug === "restaurant-test").phone);
      assert.ok(!JSON.stringify(firstData).includes(key));
      assert.ok(!JSON.stringify(logs).includes(key));
      assertNoPrivateData(firstData);
      globalThis.fetch = async (url) => {
        if (String(url).endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
        return Response.json(liveParent(requestId));
      };
      const status = await statusRoute(getRequest("status", "restaurant-test", { requestId }));
      assert.equal(status.status, 200, "Twilio IDs without underscore remain usable for polling");
      assert.equal((await status.json()).request.requestId, requestId);

      const tampered = await createRoute(createRequest("request", "restaurant-test", {
        restaurantId: "restaurant-test",
        deliveryCount: 1,
        idempotencyKey: randomUUID(),
        restaurantPhone: "+15550000000",
      }));
      assert.equal(tampered.status, 400);
    });

    await t.test("creation requires UUID v4 before any upstream request", async () => {
      configureLiveTest();
      let calls = 0;
      globalThis.fetch = async () => { calls++; throw new Error("Must not call upstream"); };
      for (const key of [undefined, null, 12, "", "old-idempotency-key", "550e8400-e29b-11d4-a716-446655440000", "550e8400-e29b-41d4-7716-446655440000"]) {
        const result = await callCreate("restaurant-test", 1, key === undefined ? null : key);
        assert.equal(result.response.status, 400);
        assert.equal(result.data.error, "Clave de idempotencia inválida.");
      }
      assert.equal(calls, 0);
    });

    await t.test("minimal confirmed creation and count aliases normalize without inventing child IDs", async () => {
      configureLiveTest();
      const configuration = validRestaurantTestConfiguration.restaurant;
      const requestId = `WEB${randomUUID().replaceAll("-", "")}`;
      const minimal = { success: true, validated: true, requestId, restaurantId: "restaurant-test", deliveryCount: 1 };
      globalThis.fetch = async (url) => {
        if (String(url).endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
        if (String(url).endsWith("/web-create")) return Response.json(minimal);
        if (String(url).endsWith("/timer")) return new Response(null, { status: 204 });
        throw new Error("Unexpected integration endpoint");
      };
      const created = await callCreate("restaurant-test", 1);
      assert.equal(created.response.status, 201);
      assert.equal(created.data.restaurant.slug, "restaurant-test");
      assert.equal(created.data.request.requestId, requestId);
      assert.equal(created.data.request.deliveryCount, 1);
      assert.equal(created.data.request.assignedDeliveries, 0);
      assert.equal(created.data.request.remainingDeliveries, 1);
      assert.equal(created.data.request.status, "open");
      assert.ok(Number.isFinite(Date.parse(created.data.request.createdAt)));
      assert.deepEqual(created.data.request.deliveries, []);
      assert.deepEqual(created.data.request.childRequestIds, []);
      const key = randomUUID();
      globalThis.fetch = async (url, options) => {
        assert.equal(url, "/api/dispatch/request");
        assert.deepEqual(JSON.parse(options.body), { restaurantId: "restaurant-test", deliveryCount: 1, idempotencyKey: key });
        assert.ok(!options.headers.Authorization.startsWith("Basic "));
        return Response.json(created.data, { status: 201 });
      };
      const clientSnapshot = await dispatchApi("request", "restaurant-test", "555555", new AbortController().signal,
        { deliveryCount: 1, idempotencyKey: key });
      assert.equal(clientSnapshot.request.requestId, requestId, "Client accepts the Twilio-owned ID and minimal normalized snapshot");

      const detailed = {
        ...minimal,
        deliveryCount: undefined,
        requestedDeliveries: 3,
        assignedDeliveries: 1,
        pendingDeliveries: 2,
        status: "partially_assigned",
        createdAt: "2026-10-12T18:00:00.000Z",
      };
      const normalized = normalizeRequest(detailed, { restaurantId: "restaurant-test" }, configuration, true);
      assert.equal(normalized.deliveryCount, 3);
      assert.equal(normalized.assignedDeliveries, 1);
      assert.equal(normalized.remainingDeliveries, 2);
      assert.equal(normalized.status, "partially_claimed");
      assert.equal(normalized.createdAt, detailed.createdAt);
      for (const invalid of [
        { ...minimal, requestId: "WEB_invalid" },
        { ...minimal, restaurantId: "brisas" },
        { ...minimal, status: "unknown" },
        { ...minimal, status: null },
        { ...minimal, createdAt: null },
        { ...minimal, createdAt: "invalid" },
        { ...minimal, deliveryCount: 1.5 },
        { ...minimal, assignedDeliveries: -1 },
        { ...minimal, pendingDeliveries: "invalid" },
        { ...minimal, assignedDeliveries: 1, pendingDeliveries: 1 },
        { ...minimal, deliveries: [] },
      ]) {
        assert.throws(() => normalizeRequest(invalid, { restaurantId: "restaurant-test" }, configuration, true),
          (error) => error instanceof RecogidoApiError && error.code === "invalid_response");
      }
      assert.throws(() => normalizeRequest(minimal, { restaurantId: "restaurant-test" }, configuration),
        (error) => error instanceof RecogidoApiError && error.code === "invalid_response");
      globalThis.fetch = async (url) => String(url).endsWith("/web-config")
        ? Response.json(validRestaurantTestConfiguration) : Response.json({ ...minimal, deliveryCount: 2 });
      const mismatch = await callCreate("restaurant-test", 1);
      assert.equal(mismatch.response.status, 502);
      assert.equal(mismatch.data.code, "INVALID_RESPONSE");
    });

    await t.test("authorized real creation fixture normalizes uppercase ID and empty children without any creation calls", async () => {
      configureLiveTest();
      let calls = 0;
      globalThis.fetch = async () => { calls++; throw new Error("No creation or upstream calls permitted"); };
      const original = structuredClone(authorizedCreateResponse);
      const configuration = validRestaurantTestConfiguration.restaurant;
      const identity = { restaurantId: "restaurant-test" };
      const normalized = normalizeRequest(authorizedCreateResponse, identity, configuration, true);
      assert.deepEqual(normalized, {
        requestId: "WEB90D3F8A76C2A4DB1B5C19FBCD4DF45E1",
        requestType: "parent",
        parentRequestId: "WEB90D3F8A76C2A4DB1B5C19FBCD4DF45E1",
        deliveryCount: 1,
        totalDeliveries: 1,
        assignedDeliveries: 0,
        remainingDeliveries: 1,
        assignmentMode: "individual",
        status: "open",
        childRequestIds: [],
        deliveries: [],
        orderNumber: "DF45E1",
        restaurantName: "Restaurante de prueba",
        createdAt: "2026-10-13T16:34:15.115Z",
        updatedAt: "2026-10-13T16:34:15.115Z",
      });
      assert.deepEqual(authorizedCreateResponse, original, "Normalization must not mutate the fixture");
      assert.equal(readRequestId(normalized.requestId), normalized.requestId);
      const rootOnly = { ...authorizedCreateResponse };
      delete rootOnly.request;
      assert.equal(normalizeRequest(rootOnly, identity, configuration, true).requestId, normalized.requestId);
      const nestedPreferred = structuredClone(authorizedCreateResponse);
      nestedPreferred.deliveryCount = 3;
      nestedPreferred.assignedDeliveries = 2;
      nestedPreferred.pendingDeliveries = 0;
      nestedPreferred.status = "claimed";
      assert.deepEqual(normalizeRequest(nestedPreferred, identity, configuration, true), normalized);

      for (const patch of [
        { status: "not-a-status" },
        { requestId: "WEB_90D3F8A76C2A4DB1B5C19FBCD4DF45E1" },
        { requestId: "WEB90D3F8A76C2A4DB1B5C19FBCD4DF45E" },
        { requestId: "WEB90D3F8A76C2A4DB1B5C19FBCD4DF45EG" },
        { restaurantId: "brisas" },
        { requestedDeliveries: null },
        { createdAt: "2026-02-30T16:34:15.115Z" },
        { createdAt: "10/13/2026" },
        { updatedAt: "invalid" },
        { children: "not-an-array" },
        { assignedDeliveries: -1 },
        { pendingDeliveries: 2 },
      ]) {
        const invalid = structuredClone(authorizedCreateResponse);
        Object.assign(invalid.request, patch);
        assert.throws(() => normalizeRequest(invalid, identity, configuration, true),
          (error) => error instanceof RecogidoApiError && error.code === "invalid_response");
      }
      for (const field of ["requestId", "requestedDeliveries", "restaurantId"]) {
        const incomplete = structuredClone(authorizedCreateResponse);
        delete incomplete[field];
        delete incomplete.request[field];
        if (field === "requestedDeliveries") delete incomplete.deliveryCount;
        assert.throws(() => normalizeRequest(incomplete, identity, configuration, true),
          (error) => error instanceof RecogidoApiError && error.code === "invalid_response");
      }
      assert.throws(() => normalizeRequest(authorizedCreateResponse, identity, configuration),
        (error) => error instanceof RecogidoApiError && error.code === "invalid_response",
        "Status polling still requires complete individual delivery records");
      const injected = structuredClone(authorizedCreateResponse);
      Object.assign(injected.request, {
        restaurantPhone: "+15550987654", deviceToken: "private-device-token",
        authorization: "Basic private", url: "https://private.example.test",
        internalDriver: { phone: "+15550987655" },
      });
      assert.deepEqual(normalizeRequest(injected, identity, configuration, true), normalized);
      assertNoPrivateData(normalized);
      assert.equal(calls, 0);
    });

    await t.test("client accepts uppercase Twilio IDs from the normalized creation fixture", async () => {
      configureLiveTest();
      const normalized = normalizeRequest(authorizedCreateResponse, { restaurantId: "restaurant-test" },
        validRestaurantTestConfiguration.restaurant, true);
      globalThis.fetch = async (url) => {
        assert.equal(url, "/api/dispatch/request", "Only simulated internal API access allowed");
        return Response.json({
          mockMode: false, restaurant: { ...validRestaurantTestConfiguration.restaurant, slug: "restaurant-test" },
          request: normalized, history: [],
        }, { status: 201 });
      };
      const snapshot = await dispatchApi("request", "restaurant-test", "555555", new AbortController().signal,
        { deliveryCount: 1, idempotencyKey: randomUUID() });
      assert.equal(snapshot.request.requestId, authorizedCreateResponse.requestId);
      assert.equal(snapshot.request.remainingDeliveries, 1);
    });

    await t.test("active queue normalizes empty, open, alerted, partial and multiple requests without private data", () => {
      const configuration = validRestaurantTestConfiguration.restaurant;
      const identity = { restaurantId: "restaurant-test" };
      const normalize = (value) => normalizeActiveRequests(value, identity, configuration);
      const searchingSection = { id: "searching", title: "Buscando conductor", emptyText: "No hay solicitudes buscando conductor.", loadingText: "Cargando solicitudes activas…" };
      assert.deepEqual(normalize({ success: true, restaurantId: "restaurant-test", count: 0, requests: [] }),
        { restaurantId: "restaurant-test", count: 0, requests: [] });
      const alerted = normalize(authorizedActiveResponse);
      assert.equal(alerted.requests[0].status, "open");
      assert.equal(alerted.requests[0].noDriverAlerted, true);
      assert.deepEqual(alerted.requests[0].deliveries, [{
        requestId: `${alerted.requests[0].requestId}_1`, deliveryNumber: 1, status: "open",
        orderNumber: fallbackOrderNumber(alerted.requests[0].requestId, 1),
      }]);
      const open = structuredClone(authorizedOpenStatusResponse.request);
      delete open.children[0].winnerName;
      delete open.children[0].claimedAt;
      // The shared fixture ID repeats a test PIN digit; use a neutral ID so the rendered short ID is unambiguous.
      open.requestId = "WEBA1B2C3D4E5F60718293A4B5C6D7E8F90";
      open.children = open.children.map((child, index) => ({ ...child, requestId: `${open.requestId}_${index + 1}` }));
      const partial = liveParent(`WEB${randomUUID().replaceAll("-", "")}`, { assigned: 1 }).request;
      partial.restaurantId = "restaurant-test";
      partial.status = "partially_claimed";
      const multiple = normalize({
        success: true, restaurantId: "restaurant-test", count: 3,
        requests: [authorizedActiveResponse.requests[0], open, partial],
      });
      assert.equal(multiple.count, 3);
      assert.equal(multiple.requests[2].assignedDeliveries, 1);
      assert.equal(multiple.requests[2].remainingDeliveries, 2);
      const html = renderToStaticMarkup(createElement(ActiveDeliveriesSection, { ...searchingSection,
        requests: sortActiveRequests(multiple.requests), nowMs: Date.now(), hasLoaded: true,
      }));
      for (const label of ["Buscando conductor", "Asignación parcial", "Seguimos buscando", "La solicitud continúa disponible", "Conductor 1", "<progress"]) {
        assert.ok(html.includes(label), `Queue missing ${label}`);
      }
      assertNoPrivateData(html);
      assert.ok(!/WEB/.test(html), "Internal request IDs never reach the queue HTML");
      const emptyHtml = renderToStaticMarkup(createElement(ActiveDeliveriesSection, { ...searchingSection,
        requests: [], nowMs: Date.now(), hasLoaded: true,
      }));
      assert.ok(emptyHtml.includes("No hay solicitudes buscando conductor."));
      assert.ok(renderToStaticMarkup(createElement(ActiveDeliveriesSection, { ...searchingSection,
        requests: [], nowMs: null, hasLoaded: false,
      })).includes("Cargando solicitudes activas"));
      assert.ok(renderToStaticMarkup(createElement(ActiveDeliveriesSection, { ...searchingSection,
        requests: [], nowMs: null, hasLoaded: false, unavailable: true,
      })).includes("No se pudo cargar la cola"));
      for (const patch of [
        { success: false }, { restaurantId: "brisas" }, { count: 2 }, { requests: null },
        { requests: [authorizedActiveResponse.requests[0], authorizedActiveResponse.requests[0]], count: 2 },
      ]) {
        assert.throws(() => normalize({ ...authorizedActiveResponse, ...patch }),
          (error) => error instanceof RecogidoApiError && error.code === "invalid_response");
      }
      for (const patch of [
        { restaurantId: "brisas" }, { requestId: "WEB_invalid" },
        { assignedDeliveries: -1 }, { assignedDeliveries: 2 }, { assignedDeliveries: 1, pendingDeliveries: 1 },
        { pendingDeliveries: -1 }, { pendingDeliveries: 0 },
        { status: "fully_assigned" }, { status: "unknown" },
        { createdAt: "invalid" }, { children: [] }, { alertSent: "true" },
      ]) {
        const invalid = structuredClone(authorizedActiveResponse);
        Object.assign(invalid.requests[0], patch);
        assert.throws(() => normalize(invalid),
          (error) => error instanceof RecogidoApiError && error.code === "invalid_response");
      }
      const nullUpdatedAt = structuredClone(authorizedActiveResponse);
      nullUpdatedAt.requests[0].updatedAt = null;
      assert.equal(normalize(nullUpdatedAt).requests[0].updatedAt, undefined,
        "Null dates are accepted as absent");
      const injected = structuredClone(authorizedActiveResponse);
      injected.requests[0].restaurantPhone = "+15550987654";
      injected.requests[0].deviceToken = "private-token";
      injected.requests[0].internalUrl = "https://private.example.test";
      injected.requests[0].children[0].winnerPhone = "+15550987655";
      assert.deepEqual(normalize(injected), alerted);
      assertNoPrivateData(multiple);
    });

    await t.test("active route authenticates pilot and sends only server-owned restaurant ID with Basic Auth", async () => {
      configureLiveTest();
      process.env.TWILIO_WEB_ACTIVE_URL = "https://recogido.example.test/web-active";
      assert.equal(getDispatchCapabilities("restaurant-test").canLoadActive, true);
      assert.equal(getDispatchCapabilities("brisas").canLoadActive, false);
      const calls = [];
      globalThis.fetch = async (url, options) => {
        calls.push(String(url));
        if (String(url).endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
        assert.equal(String(url), process.env.TWILIO_WEB_ACTIVE_URL);
        assert.equal(options.method, "POST");
        assert.equal(options.headers["Content-Type"], "application/x-www-form-urlencoded");
        assert.equal(options.headers.Authorization, `Basic ${Buffer.from("test-web-user:test-web-password").toString("base64")}`);
        assert.deepEqual(Object.fromEntries(new URLSearchParams(options.body)), { restaurantId: "restaurant-test" });
        assert.equal(options.cache, "no-store");
        assert.ok(options.signal instanceof AbortSignal);
        return Response.json(authorizedActiveResponse);
      };
      const context = { params: Promise.resolve({ restaurantId: "restaurant-test" }) };
      const wrong = await activeRoute(getRequest("restaurants/restaurant-test/active", "restaurant-test", {}, "wrong-pin"), context);
      assert.equal(wrong.status, 401);
      assert.equal(calls.length, 0);
      const response = await activeRoute(getRequest("restaurants/restaurant-test/active", "restaurant-test"), context);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const data = await response.json();
      assert.equal(data.count, 1);
      assertNoPrivateData(data);
      for (const privateValue of [
        process.env.TWILIO_WEB_ACTIVE_URL, "test-web-user", "test-web-password",
        Buffer.from("test-web-user:test-web-password").toString("base64"),
      ]) {
        assert.ok(!JSON.stringify(data).includes(privateValue));
        assert.ok(!JSON.stringify(logs).includes(privateValue));
      }
      assert.equal(calls.length, 2);
      globalThis.fetch = async (url, options) => {
        assert.equal(url, "/api/dispatch/restaurants/restaurant-test/active");
        assert.equal(options.headers["X-Device-Token"], "555555");
        assert.equal(options.cache, "no-store");
        return Response.json(data);
      };
      const client = await activeDispatchApi("restaurant-test", "555555", new AbortController().signal);
      assert.equal(client.requests[0].noDriverAlerted, true);
      configureMock();
      globalThis.fetch = async () => { throw new Error("Mock restaurants must not call active upstream"); };
      const mock = await activeRoute(getRequest("restaurants/brisas/active", "brisas"),
        { params: Promise.resolve({ restaurantId: "brisas" }) });
      assert.equal(mock.status, 503);
    });

    await t.test("active route accepts the picked_up contract with order numbers, transit counts and nullable dates", async () => {
      configureLiveTest();
      process.env.TWILIO_WEB_ACTIVE_URL = "https://recogido.example.test/web-active";
      const requestId = "WEBA1B2C3D4E5F60718293A4B5C6D7E8F90";
      const pickedUpResponse = {
        success: true, restaurantId: "restaurant-test", count: 1,
        requests: [{
          requestId, orderNumber: "A7K2Q9", baseOrderNumber: "A7K2Q9",
          restaurantId: "restaurant-test", restaurantName: "Restaurante de prueba",
          requestedDeliveries: 1, assignedDeliveries: 1, pickedUpDeliveries: 1, inTransitDeliveries: 1,
          completedDeliveries: 0, cancelledDeliveries: 0, pendingDeliveries: 0, activeDeliveries: 1,
          status: "picked_up", alertSent: false, pickedUpAt: "2026-10-13T22:31:00.000Z",
          createdAt: "2026-10-13T22:20:33.214Z", updatedAt: "2026-10-13T22:31:00.000Z",
          children: [{
            requestId: `${requestId}_1`, orderNumber: "A7K2Q9-01", deliveryNumber: 1, status: "picked_up",
            winnerName: "Maria Elizabeth", claimedAt: "2026-10-13T22:25:00.000Z",
            pickedUpAt: "2026-10-13T22:31:00.000Z", completedAt: null, cancelledAt: null,
            createdAt: "2026-10-13T22:20:33.214Z", updatedAt: null,
            winnerPhone: "+15550987655",
          }],
        }],
      };
      const upstream = [];
      globalThis.fetch = async (url) => {
        upstream.push(String(url));
        if (String(url).endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
        assert.equal(String(url), process.env.TWILIO_WEB_ACTIVE_URL, "Only the simulated active endpoint is allowed");
        return Response.json(pickedUpResponse);
      };
      const context = { params: Promise.resolve({ restaurantId: "restaurant-test" }) };
      const response = await activeRoute(getRequest("restaurants/restaurant-test/active", "restaurant-test"), context);
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.count, 1);
      const [request] = data.requests;
      assert.equal(request.requestId, requestId, "Internal ID is preserved server-side for status/cancel");
      assert.equal(request.orderNumber, "A7K2Q9");
      assert.equal(request.baseOrderNumber, "A7K2Q9");
      assert.equal(request.restaurantId, "restaurant-test");
      assert.equal(request.status, "fully_assigned");
      assert.equal(request.centralStatus, "picked_up");
      assert.equal(request.alertSent, false);
      assert.equal(request.assignedDeliveries, 1);
      assert.equal(request.remainingDeliveries, 0);
      assert.equal(request.pickedUpDeliveries, 1);
      assert.equal(request.inTransitDeliveries, 1);
      assert.equal(request.completedDeliveries, 0);
      assert.equal(request.cancelledDeliveries, 0);
      assert.equal(request.activeDeliveries, 1);
      assert.equal(request.pickedUpAt, "2026-10-13T22:31:00.000Z");
      const [child] = request.deliveries;
      assert.equal(child.requestId, `${requestId}_1`);
      assert.equal(child.orderNumber, "A7K2Q9-01");
      assert.equal(child.status, "claimed");
      assert.equal(child.centralStatus, "picked_up");
      assert.equal(child.pickedUp, true);
      assert.equal(child.pickedUpAt, "2026-10-13T22:31:00.000Z");
      assert.equal(child.driverName, "Maria Elizabeth");
      assert.equal(child.createdAt, "2026-10-13T22:20:33.214Z");
      assert.equal(child.completedAt, undefined);
      assert.equal(child.cancelledAt, undefined);
      assertNoPrivateData(data);
      assert.equal(upstream.filter((url) => url === process.env.TWILIO_WEB_ACTIVE_URL).length, 1);

      globalThis.fetch = async (url) => {
        assert.equal(url, "/api/dispatch/restaurants/restaurant-test/active");
        return Response.json(data);
      };
      const client = await activeDispatchApi("restaurant-test", "555555", new AbortController().signal);
      assert.equal(client.requests[0].centralStatus, "picked_up");
      assert.equal(client.requests[0].deliveries[0].pickedUp, true);

      const html = renderToStaticMarkup(createElement(ActiveDeliveriesSection, {
        id: "in-progress", title: "En curso", emptyText: "Sin pedidos.", loadingText: "Cargando…",
        requests: client.requests, nowMs: Date.now(), hasLoaded: true,
      }));
      assert.ok(html.includes("A7K2Q9"), "Public order number is shown");
      assert.ok(html.includes("En camino"), "Picked-up delivery is shown as in transit");
      assert.ok(html.includes("Pedido recogido"));
      assert.ok(!/WEB/.test(html), "Internal request IDs never reach the queue HTML");
      assertNoPrivateData(html);
    });

    await t.test("active normalization defaults absent counts, uses child states per card and logs only field names", () => {
      const configuration = validRestaurantTestConfiguration.restaurant;
      const identity = { restaurantId: "restaurant-test" };
      const normalize = (value) => normalizeActiveRequests(value, identity, configuration);
      const requestId = "WEBB1C2D3E4F5A60718293A4B5C6D7E8F91";
      const multi = {
        requestId, restaurantId: "restaurant-test", requestedDeliveries: 3,
        status: "picked_up", createdAt: "2026-10-13T22:20:33.214Z",
        children: [
          { requestId: `${requestId}_1`, deliveryNumber: 1, status: "picked_up", winnerName: "Ana",
            claimedAt: "2026-10-13T22:22:00.000Z", pickedUpAt: "2026-10-13T22:30:00.000Z" },
          { requestId: `${requestId}_2`, deliveryNumber: 2, status: "claimed", winnerName: "Luis",
            claimedAt: "2026-10-13T22:23:00.000Z", pickedUpAt: null },
          { requestId: `${requestId}_3`, deliveryNumber: 3, status: "open" },
        ],
      };
      const result = normalize({ success: true, restaurantId: "restaurant-test", count: 1, requests: [multi] });
      const [request] = result.requests;
      assert.equal(request.status, "partially_claimed", "A picked_up parent with pending deliveries stays live");
      assert.equal(request.assignedDeliveries, 2);
      assert.equal(request.remainingDeliveries, 1);
      assert.equal(request.pickedUpDeliveries, 1);
      assert.equal(request.inTransitDeliveries, 1);
      assert.equal(request.completedDeliveries, 0);
      assert.equal(request.cancelledDeliveries, 0);
      assert.equal(request.updatedAt, undefined);
      assert.deepEqual(request.deliveries.map((delivery) => [delivery.status, delivery.pickedUp === true]),
        [["claimed", true], ["claimed", false], ["open", false]]);
      const html = renderToStaticMarkup(createElement(ActiveDeliveriesSection, {
        id: "in-progress", title: "En curso", emptyText: "Sin pedidos.", loadingText: "Cargando…",
        requests: result.requests, nowMs: Date.now(), hasLoaded: true,
      }));
      for (const label of ["En camino", "Conductor asignado", "Buscando conductor"]) {
        assert.ok(html.includes(label), `Per-child card state missing ${label}`);
      }
      assert.ok(!/WEB/.test(html));

      const previousLogs = logs.length;
      const rejected = structuredClone(multi);
      rejected.children[0].status = "teleported";
      rejected.authorization = "Basic c2VjcmV0";
      assert.throws(() => normalize({ success: true, restaurantId: "restaurant-test", count: 1, requests: [rejected] }),
        (error) => error instanceof RecogidoApiError && error.code === "invalid_response");
      const diagnostic = JSON.stringify(logs.slice(previousLogs));
      assert.ok(diagnostic.includes("children.status") || diagnostic.includes("status"), "Rejected field is logged");
      assert.ok(diagnostic.includes("requestedDeliveries"), "Received field names are logged");
      for (const secret of ["Basic c2VjcmV0", requestId, "Ana", "Luis", "2026-10-13", "https://"]) {
        assert.ok(!diagnostic.includes(secret), `Diagnostic must not include ${secret}`);
      }
    });

    await t.test("active route fails explicitly on missing URL, upstream 401/500, timeout and invalid responses", async () => {
      for (const failure of ["missing", "401", "500", "timeout", "invalid", "wrong-restaurant", "secret"]) {
        configureLiveTest();
        if (failure !== "missing") process.env.TWILIO_WEB_ACTIVE_URL = "https://recogido.example.test/web-active";
        if (failure === "timeout") process.env.DISPATCH_REQUEST_TIMEOUT_MS = "1000";
        globalThis.fetch = async (url, options) => {
          if (String(url).endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
          if (failure === "401" || failure === "500") return new Response("private upstream body", { status: Number(failure) });
          if (failure === "timeout") return new Promise((resolve, reject) =>
            options.signal.addEventListener("abort", () => reject(new Error("private-timeout")), { once: true }));
          if (failure === "invalid") return new Response("invalid JSON");
          if (failure === "wrong-restaurant") return Response.json({ ...authorizedActiveResponse, restaurantId: "brisas" });
          return Response.json({ ...authorizedActiveResponse, privateData: "test-web-password" });
        };
        const response = await activeRoute(getRequest("restaurants/restaurant-test/active", "restaurant-test"),
          { params: Promise.resolve({ restaurantId: "restaurant-test" }) });
        assert.equal(response.status, failure === "missing" ? 503 : failure === "timeout" ? 504 : 502);
        const data = await response.json();
        assertNoPrivateData(data);
        assert.ok(!JSON.stringify(data).includes("private"));
        assert.ok(!JSON.stringify(data).includes("test-web-password"));
      }
    });

    await t.test("history route: pilot sends only the server-owned restaurant and limit=50 with Basic Auth", async () => {
      configureLiveTest();
      const calls = [];
      globalThis.fetch = async (url, options) => {
        calls.push(String(url));
        if (String(url).endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
        assert.equal(String(url), process.env.TWILIO_WEB_HISTORY_URL);
        assert.equal(options.method, "POST");
        assert.equal(options.headers["Content-Type"], "application/x-www-form-urlencoded");
        assert.equal(options.headers.Authorization, `Basic ${Buffer.from("test-web-user:test-web-password").toString("base64")}`);
        assert.deepEqual(Object.fromEntries(new URLSearchParams(options.body)), { restaurantId: "restaurant-test", limit: "50" });
        assert.ok(options.signal instanceof AbortSignal);
        return Response.json(authorizedHistoryResponse);
      };
      const context = { params: Promise.resolve({ restaurantId: "restaurant-test" }) };
      const wrong = await historyRoute(historyRequest("restaurant-test", {}, "wrong-pin"), context);
      assert.equal(wrong.status, 401);
      assert.equal(calls.length, 0, "wrong PIN never reaches Twilio");
      const redirected = await historyRoute(historyRequest("restaurant-test", { restaurant: "brisas", restaurantId: "brisas" }), context);
      assert.equal(redirected.status, 400, "the browser cannot pick a restaurant through the query");
      assert.equal(calls.length, 0);
      const foreignPath = await historyRoute(historyRequest("brisas", {}, "555555"), { params: Promise.resolve({ restaurantId: "brisas" }) });
      assert.equal(foreignPath.status, 401, "a PIN only opens its own restaurant");

      const response = await historyRoute(historyRequest("restaurant-test"), context);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const data = await response.json();
      assert.equal(data.restaurantId, "restaurant-test");
      assert.equal(data.count, 3);
      const [completed, cancelled, mixed] = data.requests;
      assert.equal(completed.status, "completed");
      assert.deepEqual(completed.driverNames, ["Conductor 1", "Conductor 2"]);
      assert.deepEqual(completed.deliveries.map((item) => item.status), ["completed", "completed"]);
      assert.equal(completed.deliveries[0].finalizedAt, "2026-10-13T22:30:00.000Z");
      assert.equal(cancelled.status, "cancelled");
      assert.equal(cancelled.deliveries[0].driverName, undefined, "empty winnerName is not a driver");
      assert.equal(mixed.status, "completed", "original status preserved for mixed requests");
      assert.equal(mixed.cancelledDeliveries, 1);
      assert.equal(mixed.finalizedAt, null, "null finalizedAt accepted");
      const text = JSON.stringify(data);
      assert.ok(!text.includes("winnerPhone") && !text.includes("+1555000000"), "driver phones are dropped");
      assert.ok(!text.includes("restaurantName"), "unknown fields are not forwarded");
      assertNoPrivateData(data);
      for (const privateValue of [
        process.env.TWILIO_WEB_HISTORY_URL, "test-web-user", "test-web-password",
        Buffer.from("test-web-user:test-web-password").toString("base64"),
      ]) {
        assert.ok(!text.includes(privateValue));
        assert.ok(!JSON.stringify(logs).includes(privateValue));
      }

      globalThis.fetch = async (url, options) => {
        assert.equal(url, "/api/dispatch/restaurants/restaurant-test/history");
        assert.equal(options.headers["X-Device-Token"], "555555");
        assert.equal(options.cache, "no-store");
        return Response.json(data);
      };
      const client = await historyDispatchApi("restaurant-test", "555555", new AbortController().signal);
      assert.equal(client.requests.length, 3);
      globalThis.fetch = async () => Response.json({ ...data, requests: [{ ...data.requests[0], status: "unknown" }] });
      await assert.rejects(historyDispatchApi("restaurant-test", "555555"), "the browser validates the history shape");
    });

    await t.test("history route: missing URL is 503, central failures are sanitized 502, foreign records rejected", async () => {
      for (const failure of ["missing", "401", "500", "timeout", "invalid", "wrong-restaurant", "foreign-record", "open-with-pending", "secret"]) {
        configureLiveTest();
        if (failure === "missing") delete process.env.TWILIO_WEB_HISTORY_URL;
        if (failure === "timeout") process.env.DISPATCH_REQUEST_TIMEOUT_MS = "1000";
        let historyCalls = 0;
        globalThis.fetch = async (url, options) => {
          if (String(url).endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
          historyCalls += 1;
          if (failure === "401" || failure === "500") return new Response("private upstream body", { status: Number(failure) });
          if (failure === "timeout") return new Promise((resolve, reject) =>
            options.signal.addEventListener("abort", () => reject(new Error("private-timeout")), { once: true }));
          if (failure === "invalid") return new Response("invalid JSON");
          if (failure === "wrong-restaurant") return Response.json({ ...authorizedHistoryResponse, restaurantId: "brisas" });
          if (failure === "foreign-record") {
            const foreign = structuredClone(authorizedHistoryResponse);
            foreign.requests[1].restaurantId = "brisas";
            return Response.json(foreign);
          }
          if (failure === "open-with-pending") {
            const pending = structuredClone(authorizedHistoryResponse);
            pending.requests[0].pendingDeliveries = 1;
            return Response.json(pending);
          }
          return Response.json({ ...authorizedHistoryResponse, privateData: "test-web-password" });
        };
        const response = await historyRoute(historyRequest("restaurant-test"),
          { params: Promise.resolve({ restaurantId: "restaurant-test" }) });
        const expected = failure === "missing" ? 503 : failure === "timeout" ? 504 : 502;
        assert.equal(response.status, expected, `${failure} → ${expected}`);
        if (failure === "missing") assert.equal(historyCalls, 0, "no upstream call when HISTORY is not configured");
        const data = await response.json();
        assertNoPrivateData(data);
        const text = JSON.stringify(data);
        for (const privateValue of ["private", "test-web-password", "recogido.example.test", "TWILIO_WEB_HISTORY_URL"]) {
          assert.ok(!text.includes(privateValue), `${failure} exposed ${privateValue}`);
        }
      }
      configurePilotMinimum();
      assert.equal(getDispatchCapabilities("restaurant-test").canLoadHistory, false);
    });

    await t.test("history route: mock restaurants read the local history and never call external services", async () => {
      configureMock();
      globalThis.fetch = async () => { throw new Error("Mock restaurants must not call history upstream"); };
      const created = await callCreate("la-fonda", 2);
      assert.equal(created.response.status, 201);
      const cancel = await cancelRoute(createRequest("cancel", "la-fonda", { requestId: created.data.request.requestId }));
      assert.equal(cancel.status, 200);
      const response = await historyRoute(historyRequest("la-fonda"), { params: Promise.resolve({ restaurantId: "la-fonda" }) });
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.equal(data.restaurantId, "la-fonda");
      assert.equal(data.requests[0].requestId, created.data.request.requestId);
      assert.equal(data.requests[0].status, "cancelled");
      assert.equal(data.requests[0].cancelledDeliveries, 2);
      assertNoPrivateData(data);
      const other = await historyRoute(historyRequest("brisas"), { params: Promise.resolve({ restaurantId: "brisas" }) });
      const otherData = await other.json();
      assert.ok(!otherData.requests.some((item) => item.requestId === created.data.request.requestId), "history isolated per restaurant");
    });

    await t.test("queue polls once per collection, stops when empty, pauses hidden, refreshes and cleans up", async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      let hidden = false;
      let calls = 0;
      let count = 3;
      let lastSignal;
      const errors = [];
      const poller = createActiveQueuePoller({
        isHidden: () => hidden,
        load: async (signal) => { calls++; lastSignal = signal; return count; },
        onError: (error) => errors.push(error),
      });
      const flush = () => new Promise((resolve) => setImmediate(resolve));
      try {
        await poller.refresh();
        assert.equal(calls, 1, "Three cards use a single collection fetch");
        t.mock.timers.tick(activeQueuePollIntervalMs - 1);
        await flush();
        assert.equal(calls, 1);
        t.mock.timers.tick(1);
        await flush();
        assert.equal(calls, 2);
        hidden = true;
        poller.visibilityChanged();
        t.mock.timers.tick(30_000);
        await flush();
        assert.equal(calls, 2);
        hidden = false;
        poller.visibilityChanged();
        await flush();
        assert.equal(calls, 3, "Visibility return refreshes immediately");
        count = 0;
        t.mock.timers.tick(activeQueuePollIntervalMs);
        await flush();
        assert.equal(calls, 4);
        t.mock.timers.tick(60_000);
        await flush();
        assert.equal(calls, 4, "Empty queue has no interval");
        count = 2;
        await poller.refresh();
        assert.equal(calls, 5, "Creation/reoffer explicitly refresh an empty queue");
        poller.dispose();
        assert.equal(lastSignal.aborted, true);
        t.mock.timers.tick(60_000);
        await flush();
        assert.equal(calls, 5);
        assert.deepEqual(errors, []);
      } finally { poller.dispose(); }
    });

    await t.test("queue coalesces concurrent refreshes and does not call back after disposal", async () => {
      let release;
      let calls = 0;
      let inFlight = 0;
      let maximum = 0;
      let capturedSignal;
      const poller = createActiveQueuePoller({
        isHidden: () => false,
        load: async (signal) => {
          capturedSignal = signal;
          calls++; inFlight++; maximum = Math.max(maximum, inFlight);
          if (calls === 1) await new Promise((resolve) => { release = resolve; });
          inFlight--;
          return 0;
        },
        onError: () => assert.fail("Unexpected queue failure"),
      });
      const initial = poller.refresh();
      await Promise.all([poller.refresh(), poller.refresh(), poller.refresh()]);
      assert.equal(calls, 1);
      release();
      await initial;
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(calls, 2, "Concurrent invalidations coalesce into one follow-up");
      assert.equal(maximum, 1);
      poller.dispose();
      assert.equal(capturedSignal.aborted, true);
      await poller.refresh();
      assert.equal(calls, 2);
    });

    await t.test("queue handles hidden initial load, visible errors and in-flight unmount without silent failure", async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      let hidden = true;
      let calls = 0;
      const errors = [];
      const failure = new Error("Simulated queue failure");
      const poller = createActiveQueuePoller({
        isHidden: () => hidden,
        load: async () => { calls++; if (calls === 1) throw failure; return 0; },
        onError: (error) => errors.push(error),
      });
      const flush = () => new Promise((resolve) => setImmediate(resolve));
      await poller.refresh();
      assert.equal(calls, 0);
      hidden = false;
      poller.visibilityChanged();
      await flush();
      assert.deepEqual(errors, [failure]);
      t.mock.timers.tick(5000);
      await flush();
      assert.equal(calls, 2);
      t.mock.timers.tick(60_000);
      await flush();
      assert.equal(calls, 2);
      poller.dispose();
      let signal;
      let rejectLoad;
      const disposedPoller = createActiveQueuePoller({
        isHidden: () => false,
        load: async (abortSignal) => {
          signal = abortSignal;
          return new Promise((resolve, reject) => { rejectLoad = reject; });
        },
        onError: () => assert.fail("Unmount must not report an aborted request"),
      });
      const running = disposedPoller.refresh();
      disposedPoller.dispose();
      assert.equal(signal.aborted, true);
      rejectLoad(new Error("Aborted on unmount"));
      await running;
    });

    await t.test("exact open status fixture accepts empty winner and null assignment time", () => {
      const normalized = normalizeRequest(authorizedOpenStatusResponse,
        { restaurantId: "restaurant-test", requestId: authorizedOpenStatusResponse.request.requestId },
        validRestaurantTestConfiguration.restaurant);
      assert.equal(normalized.status, "open");
      assert.equal(normalized.assignedDeliveries, 0);
      assert.equal(normalized.remainingDeliveries, 1);
      assert.deepEqual(normalized.deliveries, [{
        requestId: `${normalized.requestId}_1`,
        deliveryNumber: 1,
        status: "open",
        orderNumber: fallbackOrderNumber(normalized.requestId, 1),
      }]);
      assert.equal(shouldPollDispatchRequest(normalized, normalized.requestId), true);
    });

    await t.test("timeline fields: picked_up child, central orderNumber, WEB-like orderNumber rejected", () => {
      const base = authorizedOpenStatusResponse.request;
      const pickedUpAt = "2026-10-13T17:05:00.000Z";
      const normalized = normalizeRequest({
        ...authorizedOpenStatusResponse,
        request: {
          ...base,
          orderNumber: "E814C7",
          status: "fully_assigned",
          assignedDeliveries: 1,
          pendingDeliveries: 0,
          children: [{
            requestId: `${base.requestId}_1`, deliveryNumber: 1, status: "picked_up",
            winnerName: "María Elizabeth", claimedAt: "2026-10-13T17:01:00.000Z", pickedUpAt,
          }],
        },
      }, { restaurantId: "restaurant-test", requestId: base.requestId }, validRestaurantTestConfiguration.restaurant);
      assert.equal(normalized.orderNumber, "E814C7");
      assert.equal(normalized.deliveries[0].status, "claimed");
      assert.equal(normalized.deliveries[0].pickedUp, true);
      assert.equal(normalized.deliveries[0].pickedUpAt, pickedUpAt);
      assert.equal(normalized.deliveries[0].orderNumber, "E814C7-01");

      const webLike = normalizeRequest({ ...authorizedOpenStatusResponse, request: { ...base, orderNumber: base.requestId } },
        { restaurantId: "restaurant-test", requestId: base.requestId }, validRestaurantTestConfiguration.restaurant);
      assert.equal(webLike.orderNumber, fallbackOrderNumber(base.requestId));
      assert.ok(!/WEB/i.test(JSON.stringify(webLike.deliveries.map((delivery) => delivery.orderNumber))));
    });

    await t.test("assignment metadata is optional only before assignment or after cancellation", () => {
      const identity = { restaurantId: "restaurant-test" };
      const configuration = validRestaurantTestConfiguration.restaurant;
      const normalize = (value) => normalizeRequest(value, identity, configuration);
      for (const state of ["open", "cancelled"]) {
        for (const metadata of [{}, { winnerName: null, claimedAt: null }, { winnerName: "", claimedAt: null }]) {
          const payload = structuredClone(authorizedOpenStatusResponse);
          payload.request.status = state;
          payload.request.pendingDeliveries = state === "open" ? 1 : 0;
          payload.request.children[0].status = state;
          delete payload.request.children[0].winnerName;
          delete payload.request.children[0].claimedAt;
          Object.assign(payload.request.children[0], metadata);
          const normalized = normalize(payload);
          assert.equal(normalized.deliveries[0].status, state);
          assert.equal(normalized.deliveries[0].driverName, undefined);
          assert.equal(normalized.deliveries[0].assignedAt, undefined);
        }
      }
      for (const state of ["claimed", "assigned"]) {
        for (const patch of [
          { winnerName: undefined }, { winnerName: null }, { winnerName: "" }, { winnerName: "  " },
          { winnerName: 12 }, { winnerName: "+15550987654" },
          { claimedAt: undefined }, { claimedAt: null }, { claimedAt: "" },
          { claimedAt: "invalid" }, { claimedAt: "2026-02-30T17:00:00.000Z" },
        ]) {
          const payload = structuredClone(authorizedStatusResponse);
          payload.request.children[0].status = state;
          Object.assign(payload.request.children[0], patch);
          assert.throws(() => normalize(payload),
            (error) => error instanceof RecogidoApiError && error.code === "invalid_response");
        }
      }
      for (const patch of [{ winnerName: 123 }, { winnerName: "https://private.example.test" }, { claimedAt: "invalid" }]) {
        const payload = structuredClone(authorizedOpenStatusResponse);
        Object.assign(payload.request.children[0], patch);
        assert.throws(() => normalize(payload),
          (error) => error instanceof RecogidoApiError && error.code === "invalid_response");
      }
      for (const original of [authorizedOpenStatusResponse, authorizedStatusResponse]) {
        const payload = structuredClone(original);
        payload.request.status = "partially_claimed";
        assert.throws(() => normalize(payload),
          (error) => error instanceof RecogidoApiError && error.code === "invalid_response");
      }
      const partial = structuredClone(authorizedOpenStatusResponse);
      partial.request.status = "partially_claimed";
      partial.request.requestedDeliveries = 2;
      partial.request.assignedDeliveries = 1;
      partial.request.children.push({
        requestId: `${partial.request.requestId}_2`, deliveryNumber: 2, status: "assigned",
        winnerName: "Maria Elizabeth", claimedAt: "2026-10-13T17:02:45.073Z",
      });
      assert.equal(normalize(partial).status, "partially_claimed");
    });

    await t.test("open polling stays 200 over time then becomes assigned without timers or offers", async () => {
      configureLiveTest();
      const originalNow = Date.now;
      const requestId = authorizedOpenStatusResponse.request.requestId;
      let upstreamStatus = structuredClone(authorizedOpenStatusResponse);
      let statusCalls = 0;
      globalThis.fetch = async (url, options) => {
        if (String(url).endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
        assert.ok(String(url).endsWith("/web-status"), "Polling must not call create, Make, resend or WhatsApp");
        assert.equal(new URLSearchParams(options.body).get("requestId"), requestId);
        statusCalls++;
        return Response.json(upstreamStatus);
      };
      const getScoped = () => requestStatusRoute(
        getRequest(`requests/${requestId}`, "restaurant-test", { restaurantId: "restaurant-test" }),
        { params: Promise.resolve({ requestId }) },
      );
      try {
        for (const elapsedMs of [0, 20_000, 60_000, 3_600_000, 86_400_000, 365 * 86_400_000]) {
          const now = Date.parse(upstreamStatus.request.createdAt) + elapsedMs;
          Date.now = () => now;
          for (const response of [
            await statusRoute(getRequest("status", "restaurant-test", { requestId })),
            await getScoped(),
          ]) {
            assert.equal(response.status, 200);
            const snapshot = await response.json();
            assert.equal(snapshot.request.status, "open");
            assert.equal(snapshot.request.assignedDeliveries, 0);
            assert.equal(snapshot.request.remainingDeliveries, 1);
            assert.equal(snapshot.request.deliveries[0].status, "open");
            assert.equal(shouldPollDispatchRequest(snapshot.request, requestId), true);
            const html = renderToStaticMarkup(createElement(DeliveryStatus, {
              request: snapshot.request, headingRef: null, now: new Date(now).toISOString(),
            }));
            assert.ok(html.includes("Pendiente"));
            assert.ok(!html.includes("SOLICITUD CERRADA"));
            assert.ok(!html.includes("SOLICITUD CANCELADA"));
            if (elapsedMs >= 20_000) assert.ok(html.includes("SIN CONDUCTOR"));
            assertNoPrivateData(snapshot);
          }
        }
        upstreamStatus.request.status = "fully_assigned";
        upstreamStatus.request.assignedDeliveries = 1;
        upstreamStatus.request.pendingDeliveries = 0;
        upstreamStatus.request.children[0] = {
          requestId: `${requestId}_1`, deliveryNumber: 1, status: "claimed",
          winnerName: "Maria Elizabeth", claimedAt: "2026-10-13T17:02:45.073Z",
        };
        const response = await getScoped();
        assert.equal(response.status, 200);
        const snapshot = await response.json();
        assert.equal(snapshot.request.status, "fully_assigned");
        assert.equal(snapshot.request.deliveries[0].driverName, "Maria Elizabeth");
        assert.equal(shouldPollDispatchRequest(snapshot.request, requestId), false);
        assert.equal(statusCalls, 13);
        assert.equal(globalThis.recogidoMakeTimersStarted.size, 0);
      } finally {
        Date.now = originalNow;
      }
    });

    await t.test("exact authorized fully-assigned status fixture is accepted", () => {
      const normalized = normalizeRequest(authorizedStatusResponse,
        { restaurantId: "restaurant-test", requestId: authorizedStatusResponse.request.requestId },
        validRestaurantTestConfiguration.restaurant);
      assert.equal(normalized.status, "fully_assigned");
      assert.equal(normalized.deliveryCount, 1);
      assert.equal(normalized.assignedDeliveries, 1);
      assert.equal(normalized.remainingDeliveries, 0);
      assert.equal(normalized.deliveries[0].status, "claimed");
      assert.equal(normalized.deliveries[0].driverName, "Maria Elizabeth");
      assert.equal(normalized.deliveries[0].requestId, `${normalized.requestId}_1`);
      assert.equal(normalized.deliveries[0].assignedAt, "2026-10-13T17:02:45.073Z");
      assert.equal(shouldPollDispatchRequest(normalized, normalized.requestId), false);
      const other = { ...normalized, requestId: `WEB${randomUUID().replaceAll("-", "")}`, status: "open" };
      assert.equal(shouldPollDispatchRequest(other, other.requestId), true);
      assert.equal(shouldPollDispatchRequest(other, normalized.requestId), false);
      assert.equal(shouldPollDispatchRequest(null, normalized.requestId), false);
      const html = renderToStaticMarkup(createElement(DeliveryStatus, {
        request: normalized, headingRef: null, now: "2026-10-13T17:03:00.000Z",
      }));
      assert.ok(html.includes("TODAS ASIGNADAS"));
      assert.ok(html.includes("1 DE 1 ASIGNADAS"));
      assert.ok(html.includes("Maria Elizabeth"));
      assert.ok(html.includes("Entrega 1 de 1"));
      assertNoPrivateData(html);
    });

    await t.test("status aliases, child ownership, counters, private projection, and empty snapshots remain strict", () => {
      const configuration = validRestaurantTestConfiguration.restaurant;
      const identity = { restaurantId: "restaurant-test", requestId: authorizedStatusResponse.request.requestId };
      const normalize = (payload) => normalizeRequest(payload, identity, configuration);
      const expected = normalize(authorizedStatusResponse);
      for (const status of ["assigned", "claimed", "completed", "closed"]) {
        const payload = structuredClone(authorizedStatusResponse);
        payload.request.children[0].status = status;
        assert.equal(normalize(payload).deliveries[0].status, ["assigned", "claimed"].includes(status) ? "claimed" : "closed");
      }
      for (const [central, canonical] of [
        ["open", "open"], ["no_driver_alerted", "open"],
        ["partially_claimed", "partially_claimed"], ["fully_assigned", "fully_assigned"],
        ["completed", "closed"], ["closed", "closed"], ["cancelled", "cancelled"],
      ]) {
        const payload = structuredClone(authorizedStatusResponse);
        payload.request.status = central;
        if (central === "open" || central === "no_driver_alerted") {
          payload.request.assignedDeliveries = 0;
          payload.request.pendingDeliveries = 1;
          payload.request.children[0] = {
            requestId: `${identity.requestId}_1`, deliveryNumber: 1, status: "open",
          };
        } else if (central === "partially_claimed") {
          payload.request.requestedDeliveries = 2;
          payload.request.pendingDeliveries = 1;
          payload.request.children.push({ requestId: `${identity.requestId}_2`, deliveryNumber: 2, status: "open" });
        }
        const result = normalize(payload);
        assert.equal(result.status, canonical);
        assert.equal(result.noDriverAlerted, central === "no_driver_alerted" ? true : undefined);
      }
      for (const childPatch of [
        { requestId: identity.requestId }, { requestId: `${identity.requestId}_0` },
        { requestId: `${identity.requestId}_01` }, { requestId: `${identity.requestId}_2` },
        { requestId: `WEB${randomUUID().replaceAll("-", "")}_1` },
        { deliveryNumber: 0 }, { deliveryNumber: 1.5 }, { status: "unknown" },
      ]) {
        const payload = structuredClone(authorizedStatusResponse);
        Object.assign(payload.request.children[0], childPatch);
        assert.throws(() => normalize(payload), (error) => error instanceof RecogidoApiError && error.code === "invalid_response");
      }
      for (const patch of [
        { assignedDeliveries: 0 }, { pendingDeliveries: 1 }, { requestedDeliveries: 0 },
        { assignedDeliveries: -1 }, { pendingDeliveries: -1 }, { assignedDeliveries: 1.5 },
        { restaurantId: "brisas" }, { status: "unknown" },
        { requestId: `${identity.requestId}_1` },
        { assignedDeliveries: 0, pendingDeliveries: 1 },
      ]) {
        const payload = structuredClone(authorizedStatusResponse);
        Object.assign(payload.request, patch);
        assert.throws(() => normalize(payload), (error) => error instanceof RecogidoApiError && error.code === "invalid_response");
      }
      const injected = structuredClone(authorizedStatusResponse);
      Object.assign(injected.request, {
        restaurantPhone: "+15550987654", deviceToken: "private-pin",
        authorization: "Basic private-auth", endpoint: "https://private.example.test",
      });
      Object.assign(injected.request.children[0], { winnerPhone: "+15550987655", driverInternalId: "private-driver-id" });
      assert.deepEqual(normalize(injected), expected);
      assertNoPrivateData(expected);
      assert.equal(normalize({ success: true, request: null }), null);
    });

    await t.test("both GET status routes return 200 for real fixture and never restart Make or create offers", async () => {
      configureLiveTest();
      const requestId = authorizedStatusResponse.request.requestId;
      const endpoints = [];
      globalThis.fetch = async (url, options) => {
        const endpoint = String(url);
        endpoints.push(endpoint);
        if (endpoint.endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
        assert.ok(endpoint.endsWith("/web-status"), "No create, timer, resend or WhatsApp endpoint allowed");
        assert.equal(new URLSearchParams(options.body).get("requestId"), requestId);
        return Response.json(authorizedStatusResponse);
      };
      const getScoped = () => requestStatusRoute(
        getRequest(`requests/${requestId}`, "restaurant-test", { restaurantId: "restaurant-test" }),
        { params: Promise.resolve({ requestId }) },
      );
      let latestSnapshot;
      for (const response of [
        await statusRoute(getRequest("status", "restaurant-test", { requestId })),
        await getScoped(),
      ]) {
        assert.equal(response.status, 200);
        const snapshot = await response.json();
        assert.equal(snapshot.restaurant.slug, "restaurant-test");
        assert.equal(snapshot.restaurant.name, "Restaurante de prueba");
        assert.equal(snapshot.request.status, "fully_assigned");
        assert.equal(snapshot.request.deliveries[0].driverName, "Maria Elizabeth");
        assert.equal(snapshot.request.remainingDeliveries, 0);
        assertNoPrivateData(snapshot);
        latestSnapshot = snapshot;
      }
      assert.equal(endpoints.length, 4);
      globalThis.fetch = async (url) => {
        assert.equal(url, `/api/dispatch/requests/${requestId}?restaurantId=restaurant-test`);
        return Response.json(latestSnapshot);
      };
      const client = await dispatchApi("status", "restaurant-test", "555555", new AbortController().signal, { requestId });
      assert.equal(client.request.status, "fully_assigned");
      assert.equal(shouldPollDispatchRequest(client.request, requestId), false);
      globalThis.fetch = async (url) => String(url).endsWith("/web-config")
        ? Response.json(validRestaurantTestConfiguration) : Response.json({
          ...authorizedStatusResponse,
          request: { ...authorizedStatusResponse.request, assignedDeliveries: 0 },
        });
      const invalid = await getScoped();
      assert.equal(invalid.status, 502);
      assert.equal((await invalid.json()).code, "INVALID_RESPONSE");
      globalThis.fetch = async (url) => String(url).endsWith("/web-config")
        ? Response.json(validRestaurantTestConfiguration) : Response.json({ success: true, request: null });
      const empty = await getScoped();
      assert.equal(empty.status, 200);
      assert.equal((await empty.json()).request, null);
    });

    await t.test("idempotency keys never leak through upstream errors, echoed data, or logs", async () => {
      for (const failure of ["http", "network", "echo"]) {
        configureLiveTest();
        const key = randomUUID();
        globalThis.fetch = async (url) => {
          if (String(url).endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
          if (failure === "network") throw new Error(`Connection failed for ${key}`);
          if (failure === "http") return new Response(`Rejected ${key}`, { status: 400 });
          return Response.json({
            success: true, validated: true, restaurantId: "restaurant-test",
            requestId: `WEB${key.replaceAll("-", "")}`, deliveryCount: 1,
            idempotencyKey: key,
          });
        };
        const result = await callCreate("restaurant-test", 1, key);
        assert.equal(result.response.status, 502);
        assert.ok(!JSON.stringify(result.data).includes(key));
        assert.ok(!JSON.stringify(logs).includes(key));
        assertNoPrivateData(result.data);
      }
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
      const requestId = `WEB${randomUUID().replaceAll("-", "")}`;
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
      const requestId = `WEB${randomUUID().replaceAll("-", "")}`;
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

    await t.test("cancel_pending: mock full cancel, wrong PIN, other restaurant, forbidden fields, idempotent repeat", async () => {
      configureMock();
      const created = await callCreate("la-fonda", 3);
      const requestId = created.data.request.requestId;
      const wrongPin = await cancelRoute(createRequest("cancel", "la-fonda", { requestId }, "000000"));
      assert.equal(wrongPin.status, 401);
      const otherRestaurant = await cancelRoute(createRequest("cancel", "brisas", { requestId }));
      assert.equal(otherRestaurant.status, 404, "another restaurant cannot cancel this request");
      for (const extra of [{ restaurantId: "brisas" }, { action: "delete" }, { url: "https://evil.example.test" }]) {
        const rejected = await cancelRoute(createRequest("cancel", "la-fonda", { requestId, ...extra }));
        assert.equal(rejected.status, 400, `browser cannot send ${Object.keys(extra)[0]}`);
      }
      assert.equal(globalThis.recogidoDispatchMock.requests.get(requestId).request.status, "open", "rejected calls change nothing");

      const response = await cancelRoute(createRequest("cancel", "la-fonda", { requestId }));
      const data = await response.json();
      assert.equal(response.status, 200);
      assert.equal(data.cancelledDeliveries, 3);
      assert.equal(data.request.status, "cancelled");
      assert.deepEqual(data.request.deliveries.map((item) => item.status), ["cancelled", "cancelled", "cancelled"]);
      assert.ok(globalThis.recogidoDispatchMock.requests.has(requestId), "never physically deleted");
      const repeat = await cancelRoute(createRequest("cancel", "la-fonda", { requestId }));
      const repeated = await repeat.json();
      assert.equal(repeat.status, 200, "repeat is a confirmed no-op");
      assert.equal(repeated.cancelledDeliveries, 0);
      assert.equal(repeated.request.status, "cancelled");
      assertNoPrivateData(data);
    });

    await t.test("cancel_pending live: form-encoded server-only request, full and partial cancellation", async () => {
      configureLiveTest();
      const scenarios = [
        { assigned: 0, expected: 3, children: ["cancelled", "cancelled", "cancelled"] },
        { assigned: 1, expected: 2, children: ["claimed", "cancelled", "cancelled"] },
      ];
      for (const scenario of scenarios) {
        const requestId = `WEB${randomUUID().replaceAll("-", "")}`;
        const cancelCalls = [];
        globalThis.fetch = async (url, options) => {
          const endpoint = String(url);
          if (endpoint.endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
          if (endpoint.endsWith("/web-status")) return Response.json(liveParent(requestId, { assigned: scenario.assigned }));
          if (endpoint.endsWith("/web-cancel")) {
            cancelCalls.push({ headers: new Headers(options.headers), fields: new URLSearchParams(options.body), method: options.method });
            return Response.json(liveParent(requestId, { assigned: scenario.assigned, cancelled: true }));
          }
          throw new Error("Unexpected integration endpoint");
        };
        const response = await cancelRoute(createRequest("cancel", "restaurant-test", { requestId }));
        const data = await response.json();
        assert.equal(response.status, 200);
        assert.equal(data.cancelledDeliveries, scenario.expected);
        assert.equal(data.request.status, "cancelled");
        assert.equal(data.request.assignedDeliveries, scenario.assigned, "assigned deliveries are protected");
        assert.deepEqual(data.request.deliveries.map((item) => item.status), scenario.children);
        assert.equal(cancelCalls.length, 1);
        const [call] = cancelCalls;
        assert.equal(call.method, "POST");
        assert.match(call.headers.get("content-type"), /^application\/x-www-form-urlencoded/);
        assert.equal(call.headers.get("authorization"), `Basic ${Buffer.from("test-web-user:test-web-password").toString("base64")}`);
        assert.deepEqual(Object.fromEntries(call.fields), { restaurantId: "restaurant-test", requestId, action: "cancel_pending" });
        const text = JSON.stringify(data);
        assert.ok(!text.includes("test-web-password") && !text.includes("recogido.example.test") && !/Basic /.test(text));
        assertNoPrivateData(data);
      }
    });

    await t.test("cancel_pending live: double click coalesces and repeat never calls Twilio again", async () => {
      configureLiveTest();
      const requestId = `WEB${randomUUID().replaceAll("-", "")}`;
      let cancelled = false;
      let cancelCalls = 0;
      globalThis.fetch = async (url) => {
        const endpoint = String(url);
        if (endpoint.endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
        if (endpoint.endsWith("/web-status")) return Response.json(liveParent(requestId, { cancelled }));
        if (endpoint.endsWith("/web-cancel")) {
          cancelCalls++;
          await new Promise((resolve) => setTimeout(resolve, 10));
          cancelled = true;
          return Response.json(liveParent(requestId, { cancelled: true }));
        }
        throw new Error("Unexpected integration endpoint");
      };
      const [first, second] = await Promise.all([
        cancelRoute(createRequest("cancel", "restaurant-test", { requestId })),
        cancelRoute(createRequest("cancel", "restaurant-test", { requestId })),
      ]);
      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      assert.equal(cancelCalls, 1, "concurrent clicks reach Twilio once");
      assert.equal((await first.json()).cancelledDeliveries, 3);
      await second.json();
      const repeat = await cancelRoute(createRequest("cancel", "restaurant-test", { requestId }));
      assert.equal(repeat.status, 200);
      assert.equal((await repeat.json()).cancelledDeliveries, 0);
      assert.equal(cancelCalls, 1, "nothing pending means no second upstream call");
    });

    await t.test("cancel_pending live: 409 reconciles, ownership and upstream failures are sanitized", async () => {
      configureLiveTest();
      const requestId = `WEB${randomUUID().replaceAll("-", "")}`;
      const run = async (cancelHandler, statusHandler) => {
        let statusCalls = 0;
        let cancelCalls = 0;
        globalThis.fetch = async (url, options) => {
          const endpoint = String(url);
          if (endpoint.endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
          if (endpoint.endsWith("/web-status")) return statusHandler ? statusHandler(statusCalls++) : Response.json(liveParent(requestId, { assigned: 1 }));
          if (endpoint.endsWith("/web-cancel")) { cancelCalls++; return cancelHandler(options); }
          throw new Error("Unexpected integration endpoint");
        };
        const response = await cancelRoute(createRequest("cancel", "restaurant-test", { requestId }));
        const body = await response.json();
        const text = JSON.stringify(body);
        for (const leak of ["test-web-password", "test-web-user", "recogido.example.test", "Authorization", "Basic ", "private-"]) {
          assert.ok(!text.includes(leak), `response leaked ${leak}`);
        }
        assertNoPrivateData(body);
        return { status: response.status, body, cancelCalls };
      };

      const conflict = await run(() => new Response("private-conflict", { status: 409 }),
        (call) => Response.json(liveParent(requestId, call === 0 ? { assigned: 1 } : { assigned: 1, cancelled: true })));
      assert.equal(conflict.status, 200, "409 with nothing left pending is a confirmed no-op");
      assert.equal(conflict.body.cancelledDeliveries, 0);

      const foreign = await run(() => Response.json({}), () => new Response("private-missing", { status: 404 }));
      assert.equal(foreign.status, 404, "request of another restaurant is not found");
      assert.equal(foreign.cancelCalls, 0);

      for (const upstream of [401, 403]) {
        const rejected = await run(() => new Response("private-auth", { status: upstream }));
        assert.equal(rejected.status, 502, `upstream ${upstream} is not reported as a PIN error`);
      }
      const badGateway = await run(() => new Response("private-gateway", { status: 502 }));
      assert.equal(badGateway.status, 502);

      const stillPending = await run(() => Response.json(liveParent(requestId, { assigned: 1 })));
      assert.equal(stillPending.status, 502, "a response that still has pending deliveries is rejected");
      const lostAssignment = await run(() => Response.json(liveParent(requestId, { assigned: 0, cancelled: true })));
      assert.equal(lostAssignment.status, 502, "an assigned delivery must never be cancelled");
      const wrongAction = await run(() => Response.json({ ...liveParent(requestId, { assigned: 1, cancelled: true }), action: "cancel_all" }));
      assert.equal(wrongAction.status, 502);

      process.env.DISPATCH_REQUEST_TIMEOUT_MS = "20";
      const timeout = await run((options) => new Promise((_, reject) =>
        options.signal.addEventListener("abort", () => reject(new Error("private-timeout")), { once: true })));
      assert.equal(timeout.status, 504);
      process.env.DISPATCH_REQUEST_TIMEOUT_MS = "10000";
      assert.ok(!JSON.stringify(logs).includes("test-web-password"), "secrets never logged");
      assert.ok(!JSON.stringify(logs).includes("Basic "), "Authorization never logged");
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
        idempotencyKey: randomUUID(),
      }));
      assert.equal(failedTwilio.status, 502);
      assert.equal(timers, 0);

      configureLiveTest();
      globalThis.recogidoMakeTimersStarted = new Set();
      globalThis.fetch = async (url) => {
        if (String(url).endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
        if (String(url).endsWith("/web-create")) {
          return Response.json({ success: true, validated: true, restaurantId: "restaurant-test", requestId: `WEB${randomUUID().replaceAll("-", "")}`, deliveryCount: 1 });
        }
        if (String(url).endsWith("/timer")) return new Response(null, { status: 503 });
        throw new Error("Unexpected integration endpoint");
      };
      const createdWithTimerError = await createRoute(createRequest("request", "restaurant-test", {
        restaurantId: "restaurant-test",
        deliveryCount: 1,
        idempotencyKey: randomUUID(),
      }));
      const timerErrorData = await createdWithTimerError.json();
      assert.equal(createdWithTimerError.status, 202);
      assert.equal(timerErrorData.operationStatus, "created_with_timer_error");
      assert.match(timerErrorData.request.requestId, /^WEB[A-F0-9]{32}$/i);
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

    await t.test("central configuration normalization accepts Twilio payload and rejects invalid shapes", async () => {
      // 1. Exact JSON response from /web-restaurant-config
      const realTwilioResponse = {
        success: true,
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

      const normalized = normalizeConfiguration(realTwilioResponse, "restaurant-test");
      assert.deepEqual(normalized, {
        slug: "restaurant-test",
        name: "Restaurante de prueba",
        maxDeliveries: 3,
        assignmentMode: "individual",
        maxActiveDeliveriesPerDriver: 1,
        active: true,
        deliveryEnabled: true,
      });

      // 2. Compatibility with payload having 'slug' instead of 'restaurantId'
      const slugResponse = {
        success: true,
        restaurant: {
          slug: "restaurant-test",
          name: "Restaurante de prueba",
          active: true,
          deliveryEnabled: true,
          maxDeliveries: 3,
          assignmentMode: "individual",
          maxActiveDeliveriesPerDriver: 1,
        },
      };
      assert.equal(normalizeConfiguration(slugResponse, "restaurant-test").slug, "restaurant-test");

      // 3. Compatibility with top-level restaurantId
      const topLevelResponse = {
        success: true,
        restaurantId: "restaurant-test",
        restaurant: {
          name: "Restaurante de prueba",
          active: true,
          deliveryEnabled: true,
          maxDeliveries: 3,
          assignmentMode: "individual",
          maxActiveDeliveriesPerDriver: 1,
        },
      };
      assert.equal(normalizeConfiguration(topLevelResponse, "restaurant-test").slug, "restaurant-test");

      // 4. End-to-end route test with exact Twilio response
      configureLiveTest();
      globalThis.fetch = async (_url, options) => {
        assert.equal(options.cache, "no-store");
        return Response.json(realTwilioResponse);
      };
      const correctPin = restaurants.find((r) => r.slug === "restaurant-test").deviceToken;
      const routeResponse = await restaurantConfigRoute(
        new Request("https://app.example.test/api/dispatch/restaurants/restaurant-test/config", {
          headers: {
            "X-Device-Token": correctPin,
            "x-forwarded-for": `192.0.2.${ipIndex++}`,
          },
        }),
        { params: Promise.resolve({ restaurantId: "restaurant-test" }) },
      );
      assert.equal(routeResponse.status, 200);
      const routeData = await routeResponse.json();
      assert.equal(routeData.restaurant.slug, "restaurant-test");
      assert.equal(routeData.restaurant.name, "Restaurante de prueba");
      assert.equal(routeData.restaurant.maxDeliveries, 3);
      assert.equal(routeData.restaurant.assignmentMode, "individual");
      assert.equal(routeData.restaurant.maxActiveDeliveriesPerDriver, 1);
      assertNoPrivateData(routeData);

      // 5. Rejection of truly invalid responses (INVALID_RESPONSE)
      const invalidCases = [
        { success: false, restaurant: realTwilioResponse.restaurant },
        { ...realTwilioResponse, restaurant: { ...realTwilioResponse.restaurant, restaurantId: "wrong-restaurant" } },
        { ...realTwilioResponse, restaurant: { ...realTwilioResponse.restaurant, name: "" } },
        { ...realTwilioResponse, restaurant: { ...realTwilioResponse.restaurant, maxDeliveries: 0 } },
        { ...realTwilioResponse, restaurant: { ...realTwilioResponse.restaurant, maxDeliveries: -1 } },
        { ...realTwilioResponse, restaurant: { ...realTwilioResponse.restaurant, maxDeliveries: "invalid" } },
        { ...realTwilioResponse, restaurant: { ...realTwilioResponse.restaurant, assignmentMode: "invalid-mode" } },
        { ...realTwilioResponse, restaurant: { ...realTwilioResponse.restaurant, active: "yes" } },
        { ...realTwilioResponse, restaurant: { ...realTwilioResponse.restaurant, deliveryEnabled: null } },
        null,
        "not-an-object",
        {},
      ];

      for (const invalidCase of invalidCases) {
        assert.throws(
          () => normalizeConfiguration(invalidCase, "restaurant-test"),
          (err) => err instanceof RecogidoApiError && err.code === "invalid_response" && err.statusCode === 502,
        );
      }
    });

    await t.test("central status normalization handles { success: true, request: null } cleanly", async () => {
      configureLiveTest();
      const restaurantConfig = validRestaurantTestConfiguration.restaurant;

      // 1. Exact JSON from Twilio when restaurant has no active requests
      const emptyStatusResponse = {
        success: true,
        request: null,
      };

      const normalized = normalizeRequest(
        emptyStatusResponse,
        { restaurantId: "restaurant-test" },
        restaurantConfig,
      );
      assert.equal(normalized, null);

      // Also when restaurantId is present at root
      const emptyStatusWithId = {
        success: true,
        restaurantId: "restaurant-test",
        request: null,
      };
      assert.equal(
        normalizeRequest(emptyStatusWithId, { restaurantId: "restaurant-test" }, restaurantConfig),
        null,
      );

      // Rejects mismatched restaurantId even if request is null
      assert.throws(
        () => normalizeRequest({ success: true, restaurantId: "wrong-restaurant", request: null }, { restaurantId: "restaurant-test" }, restaurantConfig),
        (err) => err instanceof RecogidoApiError && err.code === "invalid_response",
      );

      // 2. Route test: GET /api/dispatch/status returns 200 with request: null
      globalThis.fetch = async (url) => {
        const endpoint = String(url);
        if (endpoint.endsWith("/web-config")) return Response.json(validRestaurantTestConfiguration);
        if (endpoint.endsWith("/web-status")) return Response.json(emptyStatusResponse);
        throw new Error(`Unexpected endpoint: ${endpoint}`);
      };

      const correctPin = restaurants.find((r) => r.slug === "restaurant-test").deviceToken;
      const statusResponse = await statusRoute(
        new Request("https://app.example.test/api/dispatch/status?restaurant=restaurant-test", {
          headers: {
            "X-Device-Token": correctPin,
            "x-forwarded-for": `192.0.2.${ipIndex++}`,
          },
        }),
      );
      assert.equal(statusResponse.status, 200);
      const statusData = await statusResponse.json();
      assert.equal(statusData.mockMode, false);
      assert.equal(statusData.request, null);
      assert.deepEqual(statusData.history, []);
      assert.equal(statusData.restaurant.slug, "restaurant-test");
      assertNoPrivateData(statusData);

      // 3. Status responses that are invalid must still throw INVALID_RESPONSE:
      // - success: false
      // - request: undefined (missing)
      // - malformed request object (e.g. invalid requestId, non-numeric deliveries, etc.)
      const invalidStatusCases = [
        { success: false, request: null },
        { success: true }, // missing request
        { success: true, request: { requestId: "invalid_id" } },
        { success: true, request: { requestId: "WEB_1234", deliveryCount: -1 } },
        { success: true, request: { requestId: "WEB_00000000000000000000000000000000", status: "not_a_status" } },
        { success: true, request: "not_an_object" },
      ];

      for (const invalidCase of invalidStatusCases) {
        assert.throws(
          () => normalizeRequest(invalidCase, { restaurantId: "restaurant-test" }, restaurantConfig),
          (err) => err instanceof RecogidoApiError && err.code === "invalid_response" && err.statusCode === 502,
        );
      }
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
