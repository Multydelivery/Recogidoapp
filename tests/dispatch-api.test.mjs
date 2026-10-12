import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";

const base = process.env.DISPATCH_TEST_BASE_URL ?? "http://localhost:3000";
const restaurants = JSON.parse(process.env.RESTAURANTS_JSON ?? "[]");
const tokenFor = (slug) => {
  const entry = restaurants.find((restaurant) => restaurant.slug === slug);
  assert.ok(entry, `Configure ${slug} in RESTAURANTS_JSON before running tests`);
  return entry.deviceToken;
};

async function api(path, slug, body, token = tokenFor(slug)) {
  const query = path === "status" || path === "config" || path === "recent"
    ? `?restaurant=${encodeURIComponent(slug)}${body?.requestId ? `&requestId=${encodeURIComponent(body.requestId)}` : ""}`
    : "";
  const response = await fetch(`${base}/api/dispatch/${path}${query}`, {
    method: path === "status" || path === "config" || path === "recent" ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(path === "status" || path === "config" || path === "recent" ? {} : { "Content-Type": "application/json" }),
    },
    body: path === "status" || path === "config" || path === "recent"
      ? undefined
      : JSON.stringify({ restaurant: slug, ...body }),
  });
  assert.equal(response.headers.get("cache-control"), "no-store");
  const data = await response.json();
  for (const restaurant of restaurants) {
    assert.ok(!JSON.stringify(data).includes(restaurant.deviceToken), "Response exposed a PIN/token");
    assert.ok(!JSON.stringify(data).includes(restaurant.phone), "Response exposed a restaurant phone");
  }
  return { status: response.status, data };
}

test("dispatch HTTP API uses restaurant-specific individual and batch contracts", { timeout: 40_000 }, async (t) => {
  assert.equal(process.env.DISPATCH_MOCK_MODE, "true", "Only run these tests in mock mode");
  assert.ok(restaurants.some(({ slug }) => slug === "la-fonda"));
  assert.ok(restaurants.some(({ slug }) => slug === "brisas"));
  assert.ok(restaurants.some(({ slug }) => slug === "jade-lee"));

  await t.test("La Fonda configuration, idempotent individual children, and pending cancellation", async () => {
    const config = await api("config", "la-fonda");
    assert.equal(config.status, 200);
    assert.equal(config.data.restaurant.maxDeliveries, 3);
    assert.equal(config.data.restaurant.assignmentMode, "individual");

    const idempotencyKey = randomUUID();
    const created = await api("request", "la-fonda", { deliveryCount: 3, idempotencyKey });
    assert.equal(created.status, 201);
    assert.match(created.data.request.requestId, /^WEB_[a-f0-9]{32}$/);
    assert.equal(created.data.request.requestType, "parent");
    assert.equal(created.data.request.childRequestIds.length, 3);

    const duplicate = await api("request", "la-fonda", { deliveryCount: 3, idempotencyKey });
    assert.equal(duplicate.status, 200);
    assert.equal(duplicate.data.request.requestId, created.data.request.requestId);

    const invalid = await api("request", "la-fonda", { deliveryCount: 4, idempotencyKey: randomUUID() });
    assert.equal(invalid.status, 400);
    const cancelled = await api("cancel", "la-fonda", { requestId: created.data.request.requestId });
    assert.equal(cancelled.data.request.status, "cancelled");
    assert.deepEqual(cancelled.data.request.deliveries.map(({ status }) => status), ["cancelled", "cancelled", "cancelled"]);
  });

  for (const slug of ["brisas", "jade-lee"]) {
    await t.test(`${slug} allows five deliveries as one batch request`, async () => {
      const config = await api("config", slug);
      assert.equal(config.status, 200);
      assert.equal(config.data.restaurant.maxDeliveries, 5);
      assert.equal(config.data.restaurant.assignmentMode, "batch");
      const created = await api("request", slug, { deliveryCount: 5, idempotencyKey: randomUUID() });
      assert.equal(created.status, 201);
      assert.equal(created.data.request.requestType, "batch");
      assert.equal(created.data.request.deliveryCount, 5);
      assert.deepEqual(created.data.request.childRequestIds, []);
      const cancelled = await api("cancel", slug, { requestId: created.data.request.requestId });
      assert.equal(cancelled.data.request.status, "cancelled");
    });
  }

  await t.test("a restaurant cannot read or cancel another restaurant's root", async () => {
    const created = await api("request", "brisas", { deliveryCount: 1, idempotencyKey: randomUUID() });
    const foreignStatus = await api("status", "jade-lee", { requestId: created.data.request.requestId });
    assert.equal(foreignStatus.status, 404);
    const foreignCancel = await api("cancel", "jade-lee", { requestId: created.data.request.requestId });
    assert.equal(foreignCancel.status, 404);
    await api("cancel", "brisas", { requestId: created.data.request.requestId });
  });
});
