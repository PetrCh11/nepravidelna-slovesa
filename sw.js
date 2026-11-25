// Simple cache-first service worker for offline PWA use
const CACHE = 'slovesa-v258';
const ASSETS = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './cloud.js',
  './install.js',
  './celebrate.js',
  './data/verbs.json',
  './manifest.json',
  './icon-180.png',
  './icon-192.png',
  './icon-512.png',
  // Polská mutace (docs/i18n.md) — ?v musí odpovídat script tagu v pl/index.html
  './pl/',
  './pl/index.html',
  './pl/manifest.json',
  './pl/icon-180.png',
  './pl/icon-192.png',
  './pl/icon-512.png',
  './lang/pl.js?v=27',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;
  // Administrace se nikdy necachuje (vždy čerstvá data i kód)
  const url = new URL(request.url);
  if (url.pathname.startsWith('/admin')) return;
  // Cizí domény (Firestore long-poll, Firebase, Plausible, Stripe…) nechat prohlížeči.
  // Dlouhé spojení přes SW drželo starý worker „zaneprázdněný", takže nová verze
  // appky čekala (waiting) a aktivovala se až po zavření všech oken.
  if (url.origin !== location.origin) return;
  e.respondWith(
    caches.match(request).then((hit) => hit || fetch(request).then((resp) => {
      // cache same-origin successful GETs
      if (resp.ok && new URL(request.url).origin === location.origin) {
        const copy = resp.clone();
        caches.open(CACHE).then((c) => c.put(request, copy));
      }
      return resp;
    }).catch(() => caches.match(new URL(request.url).pathname.startsWith('/pl/') ? './pl/index.html' : './index.html')))
  );
});
