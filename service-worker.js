const CACHE_NAME = 'slevao-shell-20260822-15';
const OFFLINE_URL = '/offline.html';
const SHELL = [
  '/',
  '/index.html',
  '/letaky.html',
  '/seznam.html',
  '/ucet.html',
  '/produkt.html',
  '/offline.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/assets/rpc-request-dedupe.js?v=20260819-1',
  '/assets/home-favorite-offer-sync.js?v=20260822-1',
  '/assets/public-features.css?v=20260816-5',
  '/assets/public-features.js?v=20260815-3',
  '/assets/public-nav-upgrade.js?v=20260822-2',
  '/assets/mobile-leaflet-nav-position.js?v=20260809-8',
  '/assets/home-autopilot.css?v=20260810-4',
  '/assets/home-autopilot.js?v=20260822-1',
  '/assets/product-personalization.css?v=20260804-2',
  '/assets/product-personalization.js?v=20260821-4',
  '/assets/product-intelligence.css?v=20260810-2',
  '/assets/product-premium.css?v=20260811-2',
  '/assets/product-equivalence.css?v=20260811-1',
  '/assets/product-identity-guard.css?v=20260811-1',
  '/assets/product-detail.js?v=20260821-3',
  '/assets/product-detail-safety.js?v=20260811-1',
  '/assets/product-identity-guard.js?v=20260821-1',
  '/assets/product-leaflet-location-global.js?v=20260821-1',
  '/assets/product-seo.js?v=20260811-3',
  '/assets/product-premium-runtime.js?v=20260815-4',
  '/assets/product-intelligence.js?v=20260821-1',
  '/assets/product-equivalence.js?v=20260821-1',
  '/assets/home-personal-deals.css?v=20260804-1',
  '/assets/home-personal-deals.js?v=20260804-1',
  '/assets/pwa-install.js?v=20260804-1',
  '/assets/location-service.js?v=20260821-1',
  '/assets/store-arrival-alerts.css?v=20260811-1',
  '/assets/store-arrival-copy-variation.js?v=20260811-2',
  '/assets/store-arrival-alerts.js?v=20260811-3',
  '/assets/store-arrival-test.js?v=20260811-5',
  '/assets/search-notifications.css?v=20260804-1',
  '/assets/product-search.js?v=20260804-2',
  '/assets/shopping-list.js?v=20260822-2',
  '/assets/shopping-insights.css?v=20260804-1',
  '/assets/shopping-insights-bootstrap.js?v=20260822-3',
  '/assets/shopping-insights.js?v=20260821-1',
  '/assets/shopping-route.css?v=20260815-3',
  '/assets/shopping-route.js?v=20260815-4',
  '/assets/shopping-route-autostart.js?v=20260807-1',
  '/assets/account-notification-seen-guard.js?v=20260822-1',
  '/assets/account.js?v=20260822-3'
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

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }

  const title = data.title || 'SLEVAO.cz upozornění';
  const options = {
    body: data.body || 'Sledovaná nabídka právě splnila tvoje podmínky.',
    icon: data.icon || '/favicon.svg',
    badge: data.badge || '/favicon.svg',
    tag: data.tag || `slevao-${data.notification_id || Date.now()}`,
    renotify: false,
    requireInteraction: false,
    data: {
      url: data.url || '/ucet.html',
      notification_id: data.notification_id || null,
      product_id: data.product_id || null,
      type: data.type || 'notification'
    }
  };

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    const visibleAccount = windows.some((client) => {
      try {
        const url = new URL(client.url);
        return url.origin === self.location.origin
          && url.pathname.endsWith('/ucet.html')
          && client.visibilityState === 'visible';
      } catch {
        return false;
      }
    });

    if (visibleAccount) return;
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const requested = event.notification?.data?.url || '/ucet.html';
  let targetUrl;
  try {
    targetUrl = new URL(requested, self.location.origin);
  } catch {
    targetUrl = new URL('/ucet.html', self.location.origin);
  }
  if (targetUrl.origin !== self.location.origin) targetUrl = new URL('/ucet.html', self.location.origin);
  const target = targetUrl.href;

  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type:'window', includeUncontrolled:true });
    for (const client of windows) {
      try {
        if ('navigate' in client && client.url !== target) await client.navigate(target);
        if ('focus' in client) return await client.focus();
      } catch {}
    }
    if (self.clients.openWindow) return self.clients.openWindow(target);
    return null;
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

function isCriticalStatic(url) {
  return /\.(?:css|js|webmanifest)$/i.test(url.pathname);
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
      const cache = await caches.open(CACHE_NAME);

      if (isCriticalStatic(url)) {
        try {
          const freshRequest = new Request(request, { cache: 'reload' });
          const response = await fetch(freshRequest);
          if (response.ok) cache.put(request, response.clone()).catch(() => {});
          return response;
        } catch {
          return (await caches.match(request)) || Response.error();
        }
      }

      const cached = await caches.match(request);
      const network = fetch(request).then(async (response) => {
        if (response.ok) cache.put(request, response.clone()).catch(() => {});
        return response;
      }).catch(() => null);
      return cached || (await network) || Response.error();
    })());
  }
});
