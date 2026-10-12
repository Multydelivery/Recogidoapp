import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { POST as createRoute } from "../src/app/api/dispatch/request/route.ts";
import { POST as cancelRoute } from "../src/app/api/dispatch/cancel/route.ts";
import { POST as resendRoute } from "../src/app/api/dispatch/resend/route.ts";
import { GET as configRoute } from "../src/app/api/dispatch/config/route.ts";
import { GET as recentRoute } from "../src/app/api/dispatch/recent/route.ts";
import { GET as statusRoute } from "../src/app/api/dispatch/status/route.ts";
import { createDeliveryRequest, RecogidoApiError } from "../src/lib/dispatch/recogido-api.ts";

const secret = "test-only-central-secret";
const restaurants = [
  { slug: "la-fonda", name: "La Fonda", phone: "+15550100101", deviceToken: "111111", active: true, deliveryEnabled: true, maxDeliveries: 3, assignmentMode: "individual", maxActiveDeliveriesPerDriver: 1 },
  { slug: "brisas", name: "Brisas", phone: "+15550100102", deviceToken: "222222", active: true, deliveryEnabled: true, maxDeliveries: 5, assignmentMode: "batch", maxActiveDeliveriesPerDriver: 5 },
  { slug: "jade-lee", name: "Jade Lee", phone: "+15550100103", deviceToken: "333333", active: true, deliveryEnabled: true, maxDeliveries: 5, assignmentMode: "batch", maxActiveDeliveriesPerDriver: 5 },
  { slug: "restaurante-prueba", name: "Restaurante de prueba", phone: "+15550100104", deviceToken: "444444", active: true, deliveryEnabled: true, maxDeliveries: 3, assignmentMode: "individual", maxActiveDeliveriesPerDriver: 1 },
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
  process.env.DISPATCH_REQUEST_TIMEOUT_MS = "10000";
  globalThis.recogidoDispatchMock = { requests: new Map(), keys: new Map() };
  globalThis.recogidoDispatchRateLimits = new Map();
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

    await t.test("real mode reports NOT_CONFIGURED without inventing backend responses", async () => {
      configureMock();
      process.env.DISPATCH_MOCK_MODE = "false";
      const response = await configRoute(getRequest("config", "la-fonda"));
      const data = await response.json();
      assert.equal(response.status, 503);
      assert.equal(data.code, "NOT_CONFIGURED");
      assertNoPrivateData(data);
    });

    await t.test("real create is form-encoded, server IDs are UUID-based, and Make receives one root id", async () => {
      configureMock();
      process.env.DISPATCH_MOCK_MODE = "false";
      process.env.RECOGIDO_DISPATCH_SUBMIT_URL = "https://central.example.test/create";
      process.env.RECOGIDO_DISPATCH_CONFIG_URL = "https://central.example.test/config";
      process.env.RECOGIDO_DISPATCH_HISTORY_URL = "https://central.example.test/history";
      process.env.RECOGIDO_DISPATCH_MAKE_WEBHOOK_URL = "https://make.example.test/webhook";
      process.env.RECOGIDO_DISPATCH_API_SECRET = secret;
      const centralCalls = [];
      let canonicalRootId;
      globalThis.fetch = async (url, options) => {
        const fields = new URLSearchParams(options.body);
        centralCalls.push({ url: String(url), options, fields });
        if (String(url).endsWith("/config")) {
          return Response.json({ success: true, restaurantId: "la-fonda", name: "La Fonda", active: true, deliveryEnabled: true, maxDeliveries: 3, assignmentMode: "individual", maxActiveDeliveriesPerDriver: 1 });
        }
        if (String(url).endsWith("/create")) {
          canonicalRootId ??= fields.get("requestId");
          const rootId = canonicalRootId;
          return Response.json({
            success: true,
            restaurantId: "la-fonda",
            request: {
              requestId: rootId,
              requestType: "parent",
              parentRequestId: rootId,
              deliveryCount: fields.get("deliveryCount"),
              totalDeliveries: 2,
              assignedDeliveries: 0,
              remainingDeliveries: 2,
              assignmentMode: "individual",
              status: "open",
              driverPhone: "+15550999999",
              childRequestIds: [`${rootId}_1`, `${rootId}_2`],
              deliveries: [
                { requestId: `${rootId}_1`, deliveryNumber: 1, status: "open" },
                { requestId: `${rootId}_2`, deliveryNumber: 2, status: "open" },
              ],
              createdAt: new Date().toISOString(),
            },
          });
        }
        if (String(url).endsWith("/history")) {
          return Response.json({ success: true, restaurantId: "la-fonda", requests: [] });
        }
        return new Response(null, { status: 204 });
      };
      const created = await createRoute(createRequest("request", "la-fonda", { deliveryCount: 2, idempotencyKey: "real-create-idempotency-key" }));
      const data = await created.json();
      assert.equal(created.status, 201);
      assert.match(data.request.requestId, /^WEB_[a-f0-9]{32}$/);
      const repeated = await createRoute(createRequest("request", "la-fonda", { deliveryCount: 2, idempotencyKey: "real-create-idempotency-key" }));
      const repeatedData = await repeated.json();
      assert.equal(repeatedData.request.requestId, data.request.requestId);
      assert.equal(centralCalls.filter((call) => call.url.endsWith("/create")).length, 2);
      const createCall = centralCalls.find((call) => call.url.endsWith("/create"));
      assert.equal(createCall.options.method, "POST");
      assert.equal(createCall.options.cache, "no-store");
      assert.equal(createCall.options.headers["Content-Type"], "application/x-www-form-urlencoded");
      assert.equal(createCall.fields.get("restaurantPhone"), restaurants[0].phone);
      assert.equal(createCall.fields.get("secret"), secret);
      const timerCalls = centralCalls.filter((call) => call.url.endsWith("/webhook"));
      assert.equal(timerCalls.length, 1);
      const timerCall = timerCalls[0];
      assert.equal(timerCall.fields.get("requestId"), data.request.requestId);
      assert.equal(timerCall.options.headers["Idempotency-Key"], data.request.requestId);
      assert.equal(timerCall.fields.get("secret"), null);
      assertNoPrivateData(data);
      assert.ok(!JSON.stringify(data).includes("+15550999999"), "Response exposed a driver's phone number");
      assert.ok(!JSON.stringify(logs).includes(secret), "Logs exposed the integration secret");
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
