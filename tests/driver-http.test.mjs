import assert from "node:assert/strict";
import { test } from "node:test";

// Run against a local production server with the synthetic profiles documented in README-DRIVER.
const base = new URL(process.env.DRIVER_TEST_BASE_URL ?? "http://localhost:3107");
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(base.hostname), "HTTP checks must stay local");
const slugs = ["maria-elizabeth", "patricia-castaneda"];

test("production PWA serves the same manifest and scoped worker from both driver routes", async () => {
  const manifestResponse = await fetch(new URL("/driver-manifest.webmanifest", base));
  const manifest = await manifestResponse.json();
  assert.equal(manifest.name, "Recogido Conductor");
  assert.equal(manifest.scope, "/driver/");
  assert.equal(manifest.start_url, "/driver/");
  assert.equal(manifest.id, "/driver/");
  for (const slug of slugs) {
    const response = await fetch(new URL(`/driver/${slug}`, base));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control"), /no-store/);
    const html = await response.text();
    assert.match(html, /Ingrese el PIN de este conductor/);
    assert.match(html, /rel="manifest" href="\/driver-manifest.webmanifest"/);
    for (const secret of ["synthetic-http-maria", "synthetic-http-patricia", "whatsapp:", "TWILIO_DRIVER_", "Basic "]) {
      assert.ok(!html.includes(secret));
    }
  }
  const entry = await fetch(new URL(manifest.start_url, base));
  assert.equal(entry.status, 200);
  assert.match(await entry.text(), /Identificador de conductor/);
  const worker = await fetch(new URL("/driver/sw.js", base));
  assert.equal(worker.status, 200);
  assert.match(worker.headers.get("cache-control"), /no-store/);
  assert.match(worker.headers.get("content-type"), /javascript/);
});

test("production API routing blocks cross-account PINs, unknown and inactive drivers without upstream calls", async () => {
  for (const operation of ["config", "dashboard", "action"]) {
    for (const [slug, token, status] of [
      ["maria-elizabeth", "synthetic-http-patricia", 401],
      ["patricia-castaneda", "synthetic-http-maria", 401],
      ["missing-driver", "synthetic-http-maria", 404],
      ["inactive-driver", "synthetic-http-inactive", 403],
    ]) {
      const response = await fetch(new URL(`/api/driver/${slug}/${operation}`, base), {
        method: operation === "action" ? "POST" : "GET",
        headers: { "X-Device-Token": token, "Content-Type": "application/json" },
        ...(operation === "action" ? { body: JSON.stringify({ action: "set_availability", available: true }) } : {}),
      });
      assert.equal(response.status, status);
      assert.equal(response.headers.get("cache-control"), "no-store");
      const body = await response.json();
      assert.equal(body.success, false);
      assert.equal(body.error, status === 401 ? "PIN incorrecto. Inténtelo nuevamente." : "Conductor no autorizado");
    }
  }
  const missing = await fetch(new URL("/driver/missing-driver", base));
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /Conductor no autorizado/);
  const inactive = await fetch(new URL("/driver/inactive-driver", base));
  assert.match(await inactive.text(), /Conductor no autorizado/);
});

test("production demo stays simulated and has no driver PIN form", async () => {
  const response = await fetch(new URL("/driver/demo", base));
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Modo de demostración/);
  assert.match(html, /Controles de demostración/);
  assert.ok(!html.includes('id="driver-pin"'));
});
