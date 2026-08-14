// Minimal service worker — exists purely to satisfy Chrome's PWA
// installability check (manifest + service-worker-with-a-fetch-handler +
// secure context). Not doing offline caching yet: every request just passes
// straight through to the network, so this changes zero runtime behavior.
// Revisit if/when actual offline support is wanted.

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
