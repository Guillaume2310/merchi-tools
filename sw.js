/* Service worker Merchi Scan — mode hors-ligne (app installable PWA) */
const CACHE = 'merchi-scan-v1';
const ASSETS = [
  './testscan.html',
  './lib/html5-qrcode.min.js',
  './manifest.webmanifest',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/favicon-64.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // APIs externes (Open Beauty/Food Facts) : on laisse passer au réseau, jamais en cache.
  // Hors-ligne, elles échouent et l'app retombe sur la base produits locale.
  if (url.origin !== self.location.origin) return;

  const isHTML = req.mode === 'navigate'
    || url.pathname.endsWith('.html')
    || url.pathname.endsWith('/');

  if (isHTML) {
    // Réseau d'abord (toujours la dernière version en ligne), cache en secours hors-ligne.
    e.respondWith(
      fetch(req)
        .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
        .catch(() => caches.match(req).then(r => r || caches.match('./testscan.html')))
    );
  } else {
    // Assets statiques (lib, icônes) : cache d'abord pour la vitesse et l'offline.
    e.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        if (res && res.status === 200) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
        return res;
      }))
    );
  }
});
