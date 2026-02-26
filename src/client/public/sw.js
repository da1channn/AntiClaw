// AntiClaw Service Worker - Offline support & asset caching
const CACHE_NAME = "anticlaw-v1";
const STATIC_ASSETS = [
  "/",
  "/icon-192.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.json",
];

// Install: precache static assets
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// Activate: clean old caches
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: network-first for API/WS, cache-first for static assets
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET and WebSocket
  if (event.request.method !== "GET") return;
  if (url.pathname.startsWith("/ws")) return;
  if (url.pathname.startsWith("/api")) {
    // Network-first for API calls
    event.respondWith(
      fetch(event.request).catch(() =>
        new Response(JSON.stringify({ ok: false, error: "Offline" }), {
          status: 503,
          headers: { "Content-Type": "application/json" },
        })
      )
    );
    return;
  }

  // Cache-first for static assets, fallback to network
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        // Cache successful responses for Next.js assets
        if (response.ok && (url.pathname.startsWith("/_next/") || STATIC_ASSETS.includes(url.pathname))) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() =>
        // Offline fallback for navigation
        url.pathname === "/" || event.request.mode === "navigate"
          ? caches.match("/")
          : new Response("Offline", { status: 503 })
      );
    })
  );
});
