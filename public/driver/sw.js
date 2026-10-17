/* Bump this version when changing the offline shell or cached public assets. */
const CACHE_PREFIX = "recogido-driver-static-";
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const OFFLINE_URL = "/driver/offline.html";
const PUBLIC_FILES = [
  OFFLINE_URL,
  "/driver/icons/icon-192.png",
  "/driver/icons/icon-512.png",
  "/driver/icons/maskable-512.png",
  "/driver/icons/apple-touch-icon.png",
  "/recogidoapplogo.png",
];

function cacheable(response) {
  return response.ok && !response.redirected &&
    !/private|no-store/i.test(response.headers.get("cache-control") || "") &&
    !response.headers.has("set-cookie") &&
    !/cookie|authorization|x-device-token|\*/i.test(response.headers.get("vary") || "");
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    for (const path of PUBLIC_FILES) {
      const response = await fetch(new Request(new URL(path, self.location.origin), {
        credentials: "omit", cache: "reload",
      }));
      if (!cacheable(response)) throw new Error("Offline assets could not be prepared");
      await cache.put(path, response);
    }
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "ACTIVATE_UPDATE") event.waitUntil(self.skipWaiting());
});

async function networkOnly(request) {
  try {
    if (self.navigator.onLine === false && request.method !== "GET") throw new Error("Offline");
    return await fetch(request, { cache: "no-store" });
  } catch {
    return new Response(JSON.stringify({
      success: false,
      error: "Sin conexión. Las acciones están deshabilitadas. La operación no se guardó ni se reintentará.",
    }), { status: 503, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });
  }
}

async function staticAsset(url) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(url.pathname);
  if (cached) return cached;
  // Never attach cookies or application headers to cacheable public resources.
  const response = await fetch(new Request(url, { credentials: "omit" }));
  if (cacheable(response)) {
    await cache.put(url.pathname, response.clone());
    const keys = await cache.keys();
    const runtime = keys.filter((key) => !PUBLIC_FILES.includes(new URL(key.url).pathname));
    for (const key of runtime.slice(0, Math.max(0, runtime.length - 150))) await cache.delete(key);
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (request.method !== "GET" || url.pathname.startsWith("/api/") ||
    request.headers.has("authorization") || request.headers.has("x-device-token")) {
    event.respondWith(networkOnly(request));
    return;
  }
  if (request.mode === "navigate" && url.pathname.startsWith("/driver/")) {
    event.respondWith((async () => {
      try { return await fetch(request, { cache: "no-store" }); }
      catch {
        const cache = await caches.open(CACHE_NAME);
        return await cache.match(OFFLINE_URL) || Response.error();
      }
    })());
    return;
  }
  if (!url.search && (url.pathname.startsWith("/_next/static/") || PUBLIC_FILES.includes(url.pathname))) {
    event.respondWith(staticAsset(url));
    return;
  }
  event.respondWith(networkOnly(request));
});
