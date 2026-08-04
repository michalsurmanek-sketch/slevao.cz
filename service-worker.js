const CACHE_NAME = 'slevao-shell-20260804-4';
const OFFLINE_URL = '/offline.html';
const SHELL = [
  '/',
  '/index.html',
  '/hledat.html',
  '/seznam.html',
  '/ucet.html',
  '/produkt.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/assets/public-features.css?v=20260804-2',
  '/assets/public-features.js?v=20260804-2',
  '/assets/public-nav-upgrade.js?v=20260804-4',
  '/assets/product-personalization.css?v=20260804-2',
  '/assets/product-personalization.js?v=20260804-2',
  '/assets/home-personal-deals.css?v=20260804-1',
  '/assets/home-personal-deals.js?v=20260804-1',
  '/assets/pwa-install.js?v=20260804-1',
  '/assets/search-notifications.css?v=20260804-1',
  '/assets/product-search.js?v=20260804-2',
  '/assets/shopping-list.js?v=20260804-3',
  '/assets/account.js?v=20260804-3',
  '/assets/product-detail.js?v=20260804-2',
  '/assets/product-seo.js?v=20260804-1'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(SHELL.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); } catch {}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith('slevao-shell-') && name !== CACHE_NAME).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

function isAdmin(url) {
  return /\/admin(?:-|\.|\/)|\/login\.html|\/moderation\.html/i.test(url.pathname);
}

function isLocalStatic(request, url) {
  return url.origin === self.location.origin
    && request.method === 'GET'
    && (url.pathname.startsWith('/assets/') || /\.(?:css|js|svg|png|jpg|jpeg|webp|gif|woff2?|webmanifest)$/i.test(url.pathname));
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin || isAdmin(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      } catch {
        return (await caches.match(request))
          || (await caches.match(url.pathname))
          || (await caches.match(OFFLINE_URL));
      }
    })());
    return;
  }

  if (isLocalStatic(request, url)) {
    event.respondWith((async () => {
      const cached = await caches.match(request);
      const network = fetch(request).then(async (response) => {
        if (response.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(request, response.clone()).catch(() => {});
        }
        return response;
      }).catch(() => null);
      return cached || (await network) || Response.error();
    })());
  }
});