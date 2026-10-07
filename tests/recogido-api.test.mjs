import assert from "node:assert/strict";
import { test } from "node:test";
import { submitDeliveryRequest, cancelDeliveryRequest, getDeliveryRequestStatus, RecogidoApiError } from "../src/lib/dispatch/recogido-api.ts";
import { POST as submitRoute } from "../src/app/api/dispatch/request/route.ts";
import { POST as cancelRoute } from "../src/app/api/dispatch/cancel/route.ts";
import { GET as statusRoute } from "../src/app/api/dispatch/status/route.ts";

const id = "WEB_1791338715017_9f67c567ff85f8c0";
const canonical = "WEB_1791338715018_9f67c567ff85f8c1";
const secret = "test-only-central-secret";
const input = { restaurantId: "la-fonda", restaurantName: "La Fonda", restaurantPhone: "+15550100101", deliveryCount: 2, requestId: id, idempotencyKey: "test-key-0001" };
const valid = { success: true, restaurantId: "la-fonda", requestId: id, status: "searching", deliveryCount: 2, createdAt: "2026-10-07T02:05:15.017Z" };
const variables = {
  DISPATCH_MOCK_MODE: "false",
  RECOGIDO_DISPATCH_SUBMIT_URL: "https://central.example.test/submit",
  RECOGIDO_DISPATCH_MANAGE_URL: "https://central.example.test/manage",
  RECOGIDO_DISPATCH_STATUS_URL: "https://central.example.test/status",
  RECOGIDO_DISPATCH_API_SECRET: secret,
  DISPATCH_REQUEST_TIMEOUT_MS: "10000",
  RESTAURANTS_JSON: JSON.stringify([{ slug: "la-fonda", name: "La Fonda", phone: "+15550100101", deviceToken: "111111" }, { slug: "brisas", name: "Brisas", phone: "+15550100102", deviceToken: "222222" }]),
};
const routeRequest = (path, body, token = "111111") => new Request(`https://app.example.test/api/dispatch/${path}`, {
  method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
});

test("central adapter and API routing using mocked fetch only", async (t) => {
  const savedEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const originalInfo = console.info;
  const originalWarn = console.warn;
  const originalError = console.error;
  const logs = [];
  console.info = (...args) => logs.push(args);
  console.warn = (...args) => logs.push(args);
  console.error = (...args) => logs.push(args);
  const configure = () => { Object.assign(process.env, variables); };
  const expectError = (code) => (error) => error instanceof RecogidoApiError && error.code === code && !error.message.includes(secret);
  try {
    await t.test("mock routes perform no external fetch and need no backend variables", async () => {
      configure();
      process.env.DISPATCH_MOCK_MODE = "true";
      for (const name of Object.keys(variables).filter(key => key.startsWith("RECOGIDO_"))) delete process.env[name];
      let calls = 0;
      globalThis.fetch = async () => { calls++; throw new Error("Unexpected external fetch"); };
      const created = await submitRoute(routeRequest("request", { restaurant: "la-fonda", deliveryCount: 2, idempotencyKey: "mock-test-key" }));
      assert.equal(created.status, 201);
      const data = await created.json();
      assert.equal(data.mockMode, true);
      const status = await statusRoute(new Request("https://app.example.test/api/dispatch/status?restaurant=la-fonda", { headers: { Authorization: "Bearer 111111" } }));
      assert.equal(status.status, 200);
      const cancelled = await cancelRoute(routeRequest("cancel", { restaurant: "la-fonda", requestId: data.request.requestId }));
      assert.equal((await cancelled.json()).request.status, "cancelled");
      await assert.rejects(submitDeliveryRequest(input), expectError("configuration"));
      assert.equal(calls, 0);
    });
    await t.test("real configuration errors are safe on every route, with no fetch", async () => {
      configure();
      delete process.env.RECOGIDO_DISPATCH_API_SECRET;
      globalThis.fetch = async () => { throw new Error("Must not fetch"); };
      const responses = [
        await submitRoute(routeRequest("request", { restaurant: "la-fonda", deliveryCount: 2, idempotencyKey: "config-test-key" })),
        await cancelRoute(routeRequest("cancel", { restaurant: "la-fonda", requestId: id })),
        await statusRoute(new Request("https://app.example.test/api/dispatch/status?restaurant=la-fonda")),
      ];
      for (const response of responses) {
        assert.equal(response.status, 503);
        assert.equal(response.headers.get("cache-control"), "no-store");
        const text = await response.text();
        assert.ok(!text.includes("https://"));
        assert.ok(!text.includes(secret));
      }
      await assert.rejects(submitDeliveryRequest(input), expectError("configuration"));
    });
    await t.test("invalid URL and timeout configuration rejected without requests", async () => {
      configure();
      process.env.RECOGIDO_DISPATCH_SUBMIT_URL = "http://central.example.test/submit";
      await assert.rejects(submitDeliveryRequest(input), expectError("configuration"));
      configure();
      process.env.DISPATCH_REQUEST_TIMEOUT_MS = "12000";
      await assert.rejects(submitDeliveryRequest(input), expectError("configuration"));
    });
    await t.test("timeout aborts fetch and returns safe retryable typed error", async () => {
      configure();
      process.env.DISPATCH_REQUEST_TIMEOUT_MS = "5";
      globalThis.fetch = (_url, options) => new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new Error(secret)), { once: true });
      });
      await assert.rejects(submitDeliveryRequest(input), error => expectError("timeout")(error) && error.statusCode === 504 && error.retryable);
    });
    await t.test("non-JSON, HTTP 500, network error and rejected response sanitized", async () => {
      configure();
      globalThis.fetch = async () => new Response(`<html>${secret}</html>`);
      await assert.rejects(submitDeliveryRequest(input), expectError("invalid_response"));
      globalThis.fetch = async () => new Response(secret, { status: 500 });
      await assert.rejects(submitDeliveryRequest(input), error => expectError("http")(error) && error.retryable);
      globalThis.fetch = async () => { throw new Error(secret); };
      await assert.rejects(submitDeliveryRequest(input), expectError("network"));
      globalThis.fetch = async () => Response.json({ success: false, restaurantId: "la-fonda", message: secret });
      await assert.rejects(submitDeliveryRequest(input), expectError("rejected"));
    });
    await t.test("form POSTs, no query secret, normalization and idempotent canonical ID", async () => {
      configure();
      const calls = [];
      globalThis.fetch = async (url, options) => {
        calls.push({ url, options, fields: new URLSearchParams(options.body) });
        return Response.json({ ...valid, requestId: canonical, secret, message: secret, internalUrl: url });
      };
      const first = await submitDeliveryRequest(input);
      const retry = await submitDeliveryRequest(input);
      assert.equal(first.requestId, canonical);
      assert.deepEqual(first, retry);
      assert.equal(first.success, true);
      assert.ok(!JSON.stringify(first).includes(secret));
      assert.ok(!JSON.stringify(first).includes("https://"));
      for (const call of calls) {
        assert.equal(call.options.method, "POST");
        assert.equal(call.options.cache, "no-store");
        assert.equal(call.options.redirect, "error");
        assert.equal(call.options.headers["Content-Type"], "application/x-www-form-urlencoded");
        assert.equal(call.fields.get("secret"), secret);
        assert.equal(call.fields.get("idempotencyKey"), input.idempotencyKey);
        assert.equal(call.fields.get("restaurantPhone"), input.restaurantPhone);
        assert.equal(new URL(call.url).search, "");
      }
      globalThis.fetch = async (url, options) => {
        const fields = new URLSearchParams(options.body);
        assert.equal(fields.get("secret"), secret);
        assert.equal(fields.get("restaurantId"), "la-fonda");
        assert.equal(fields.get("requestId"), id);
        assert.equal(options.method, "POST");
        assert.equal(options.cache, "no-store");
        assert.equal(new URL(url).search, "");
        if (url.endsWith("/manage")) assert.equal(fields.get("action"), "cancel");
        return Response.json({ ...valid, status: url.endsWith("/manage") ? "cancelled" : "searching" });
      };
      assert.equal((await cancelDeliveryRequest({ restaurantId: "la-fonda", requestId: id })).status, "cancelled");
      assert.equal((await getDeliveryRequestStatus({ restaurantId: "la-fonda", requestId: id })).status, "searching");
    });
    await t.test("ownership and request ID verified; secret echo rejected", async () => {
      configure();
      for (const response of [{ ...valid, restaurantId: "brisas" }, { ...valid, requestId: canonical }, { ...valid, driverName: secret }]) {
        globalThis.fetch = async () => Response.json(response);
        await assert.rejects(getDeliveryRequestStatus({ restaurantId: "la-fonda", requestId: id }), expectError("invalid_response"));
      }
      globalThis.fetch = async () => Response.json({ ...valid, status: "invented" });
      await assert.rejects(submitDeliveryRequest(input), expectError("invalid_response"));
    });
    await t.test("real routes use configured identity, central state and guarded cancellation", async () => {
      configure();
      const calls = [];
      globalThis.fetch = async (url, options) => {
        calls.push({ url, fields: new URLSearchParams(options.body) });
        return Response.json(valid);
      };
      const created = await submitRoute(routeRequest("request", { restaurant: "la-fonda", deliveryCount: 2, idempotencyKey: "real-test-key" }));
      assert.equal(created.status, 200);
      const data = await created.json();
      assert.equal(data.mockMode, false);
      assert.equal(data.request.status, "searching");
      assert.equal(calls[0].fields.get("restaurantName"), "La Fonda");
      assert.equal(calls[0].fields.get("restaurantPhone"), "+15550100101");
      assert.equal(calls[0].fields.get("idempotencyKey"), "real-test-key");
      assert.ok(!JSON.stringify(data).includes(secret));
      assert.ok(!JSON.stringify(data).includes("+15550100101"));
      assert.ok(!JSON.stringify(data).includes("https://"));
      globalThis.fetch = async () => Response.json({ ...valid, status: "claimed" });
      assert.equal((await cancelRoute(routeRequest("cancel", { restaurant: "la-fonda", requestId: id }))).status, 409);
      globalThis.fetch = async () => Response.json({ ...valid, restaurantId: "brisas" });
      assert.equal((await cancelRoute(routeRequest("cancel", { restaurant: "la-fonda", requestId: id }))).status, 502);
      globalThis.fetch = async () => Response.json({ success: true, restaurantId: "la-fonda", request: null });
      const empty = await statusRoute(new Request("https://app.example.test/api/dispatch/status?restaurant=la-fonda", { headers: { Authorization: "Bearer 111111" } }));
      assert.equal(empty.status, 200);
      assert.equal((await empty.json()).request, null);
      assert.equal(empty.headers.get("cache-control"), "no-store");
    });
    assert.ok(!JSON.stringify(logs).includes(secret), "Logs exposed secret");
    assert.ok(!JSON.stringify(logs).includes("https://"), "Logs exposed endpoints");
    assert.ok(logs.some(entry => JSON.stringify(entry).includes(id)), "Logs missing requestId");
  } finally {
    globalThis.fetch = originalFetch;
    console.info = originalInfo;
    console.warn = originalWarn;
    console.error = originalError;
    for (const key of Object.keys(process.env)) if (!(key in savedEnv)) delete process.env[key];
    Object.assign(process.env, savedEnv);
  }
});
