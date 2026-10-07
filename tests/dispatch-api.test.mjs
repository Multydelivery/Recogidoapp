import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { setTimeout as delay } from "node:timers/promises";

const base = process.env.DISPATCH_TEST_BASE_URL ?? "http://localhost:3000";
const restaurants = JSON.parse(process.env.RESTAURANTS_JSON ?? "[]");
const tokenFor = (slug) => {
  const entry = restaurants.find((restaurant) => restaurant.slug === slug);
  assert.ok(entry, `Configure ${slug} in RESTAURANTS_JSON before running tests`);
  return entry.deviceToken;
};

async function api(path, slug, body, token = tokenFor(slug)) {
  const query = path === "status" ? `?restaurant=${slug}${body?.requestId ? `&requestId=${body.requestId}` : ""}` : "";
  const response = await fetch(`${base}/api/dispatch/${path}${query}`, {
    method: path === "status" ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, ...(path !== "status" ? { "Content-Type": "application/json" } : {}) },
    body: path !== "status" ? JSON.stringify({ restaurant: slug, ...body }) : undefined,
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json();
  for (const restaurant of restaurants) {
    assert.ok(!JSON.stringify(data).includes(restaurant.deviceToken), "Response exposed a device credential");
    assert.ok(!JSON.stringify(data).includes(restaurant.phone), "Response exposed a restaurant phone");
  }
  return { status: response.status, data };
}

async function waitUntil(request, elapsed) {
  await delay(Math.max(0, Date.parse(request.createdAt) + elapsed - Date.now()));
}

test("dispatch simulated API integration", { timeout: 90_000 }, async (t) => {
  assert.equal(process.env.DISPATCH_MOCK_MODE, "true", "Only run these tests in mock mode");
  for (const slug of ["la-fonda", "brisas", "jade-lee"]) {
    const current = await api("status", slug);
    assert.equal(current.status, 200);
    if (current.data.request && ["pending", "offer_sent", "searching"].includes(current.data.request.status)) {
      assert.equal((await api("cancel", slug, { requestId: current.data.request.requestId })).status, 200);
    }
  }

  await t.test("authentication, validation, and server-owned identity", async () => {
    assert.equal((await api("status", "la-fonda", undefined, "")).status, 401);
    assert.equal((await api("status", "la-fonda", undefined, "invalid-demo-token")).status, 401);
    assert.equal((await api("status", "unknown", undefined, tokenFor("la-fonda"))).status, 401);
    assert.equal((await api("request", "la-fonda", { deliveryCount: 0, idempotencyKey: randomUUID() })).status, 400);
    assert.equal((await api("request", "la-fonda", { deliveryCount: 1.5, idempotencyKey: randomUUID() })).status, 400);
    assert.equal((await api("request", "la-fonda", { deliveryCount: 10, idempotencyKey: randomUUID() })).status, 400);
    assert.equal((await api("request", "la-fonda", { deliveryCount: 1, idempotencyKey: "short" })).status, 400);
    assert.equal((await api("request", "la-fonda", { deliveryCount: 1, idempotencyKey: randomUUID(), name: "Spoof", phone: "+15550000000" })).status, 400);
    const malformed = await fetch(`${base}/api/dispatch/request`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: "{",
    });
    assert.equal(malformed.status, 400);
  });

  await t.test("concurrent idempotency, isolation, and pending cancellation", async () => {
    const key = randomUUID();
    const responses = await Promise.all(Array.from({ length: 4 }, () =>
      api("request", "brisas", { deliveryCount: 3, idempotencyKey: key })
    ));
    assert.equal(responses.filter((response) => response.status === 201).length, 1);
    assert.equal(responses.filter((response) => response.status === 200).length, 3);
    const request = responses[0].data.request;
    assert.match(request.requestId, /^WEB_\d{13}_[a-f0-9]{16}$/);
    assert.equal(request.status, "pending");
    assert.equal(new Set(responses.map((response) => response.data.request.requestId)).size, 1);
    assert.equal((await api("request", "brisas", { deliveryCount: 4, idempotencyKey: key })).status, 409);
    assert.equal((await api("request", "brisas", { deliveryCount: 3, idempotencyKey: randomUUID() })).status, 409);
    assert.equal((await api("status", "jade-lee", { requestId: request.requestId })).status, 404);
    assert.equal((await api("cancel", "jade-lee", { requestId: request.requestId })).status, 404);
    assert.equal((await api("cancel", "brisas", { requestId: request.requestId })).data.request.status, "cancelled");
    assert.equal((await api("cancel", "brisas", { requestId: request.requestId })).status, 200);
    const replay = await api("request", "brisas", { deliveryCount: 3, idempotencyKey: key });
    assert.equal(replay.data.request.requestId, request.requestId);
    assert.equal(replay.data.request.status, "cancelled");
  });

  await t.test("pending → offer_sent → searching → claimed and late cancellation rejected", async () => {
    const result = await api("request", "la-fonda", { deliveryCount: 2, idempotencyKey: randomUUID() });
    assert.equal(result.status, 201);
    assert.equal(result.data.restaurant.name, restaurants.find((entry) => entry.slug === "la-fonda").name);
    const request = result.data.request;
    assert.equal(request.status, "pending");
    await waitUntil(request, 5500);
    assert.equal((await api("status", "la-fonda", { requestId: request.requestId })).data.request.status, "offer_sent");
    await waitUntil(request, 10_500);
    assert.equal((await api("status", "la-fonda", { requestId: request.requestId })).data.request.status, "searching");
    await waitUntil(request, 20_500);
    // Cancellation must check server time, not a stale searching state in the client.
    assert.equal((await api("cancel", "la-fonda", { requestId: request.requestId })).status, 409);
    const claimed = (await api("status", "la-fonda", { requestId: request.requestId })).data.request;
    assert.equal(claimed.status, "claimed");
    assert.equal(claimed.driverName, "Conductor Demo");
  });

  await t.test("offer_sent and searching can be cancelled; history caps at five", async () => {
    for (const [elapsed, expected] of [[5500, "offer_sent"], [10_500, "searching"]]) {
      const result = await api("request", "jade-lee", { deliveryCount: 4, idempotencyKey: randomUUID() });
      assert.equal(result.status, 201);
      await waitUntil(result.data.request, elapsed);
      assert.equal((await api("status", "jade-lee")).data.request.status, expected);
      assert.equal((await api("cancel", "jade-lee", { requestId: result.data.request.requestId })).data.request.status, "cancelled");
    }
    for (let count = 1; count <= 6; count++) {
      const result = await api("request", "brisas", { deliveryCount: count, idempotencyKey: randomUUID() });
      assert.equal(result.status, 201);
      await api("cancel", "brisas", { requestId: result.data.request.requestId });
    }
    const history = (await api("status", "brisas")).data.history;
    assert.equal(history.length, 5);
    assert.deepEqual(history.map((entry) => entry.deliveryCount), [6, 5, 4, 3, 2]);
  });
});
