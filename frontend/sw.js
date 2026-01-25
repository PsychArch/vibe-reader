// Minimal service worker for PWA installability
// No caching - always fetch from network
self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});
