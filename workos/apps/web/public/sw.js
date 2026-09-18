// Minimal PWA service worker (ТЗ §30).
// App-shell caching: serve cached shell when offline so previously-loaded UI
// still renders. Message data is cached separately in IndexedDB (see lib/cache.ts).

const CACHE = "workos-shell-v1";
const SHELL = ["/", "/manifest.webmanifest", "/icons/icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // Never cache API or WebSocket traffic.
  if (url.pathname.startsWith("/api") || url.protocol === "ws:" || url.protocol === "wss:") {
    return;
  }

  // Navigations: network-first, fall back to cached shell (offline support).
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/").then((r) => r || Response.error())),
    );
    return;
  }

  // Static assets: cache-first.
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
          return res;
        }),
    ),
  );
});
