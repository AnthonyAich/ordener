// Ordener service worker
// Laat de app opstarten zonder netwerk. Je data komt altijd live uit de Google Sheet:
// API-aanvragen (naar script.google.com) gaan nooit via deze cache.
// Strategie "eerst netwerk": zo krijg je altijd de nieuwste versie, en de cache is enkel een terugval.
// Verhoog VERSION samen met ?v= in index.html bij elke release.
const VERSION = 5;
const CACHE = 'ordener-v' + VERSION;
const SHELL = [
  './', './index.html', './manifest.webmanifest',
  './icon-180.png', './icon-192.png', './icon-512.png', './icon-maskable-512.png',
  './style.css?v=' + VERSION, './config.js?v=' + VERSION, './api.js?v=' + VERSION, './app.js?v=' + VERSION,
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('ordener-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: req.mode === 'navigate' })
        .then((hit) => hit || (req.mode === 'navigate' ? caches.match('./index.html') : Response.error())))
  );
});
