const CACHE_VERSION = '20260901-5';
const CORE_CACHE_NAME = `slevao-core-${CACHE_VERSION}`;
const RUNTIME_CACHE_NAME = `slevao-runtime-${CACHE_VERSION}`;
const CACHE_NAME = RUNTIME_CACHE_NAME;
const OFFLINE_URL = '/offline.html';

// Keep install atomic and tiny. Public-page assets are cached on demand by the
// fetch handler instead of making the whole service-worker installation depend
// on hundreds of independently versioned files.
const CORE_SHELL = [
  OFFLINE_URL,
  '/manifest.webmanifest',
  '/favicon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CORE_CACHE_NAME);
    await cache.addAll(CORE_SHELL.map((url) => new Request(url, { cache: 'reload' })));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([CORE_CACHE_NAME, RUNTIME_CACHE_NAME]);
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => (
        name.startsWith('slevao-shell-')
        || name.startsWith('slevao-core-')
        || name.startsWith('slevao-runtime-')
      ) && !keep.has(name))
      .map((name) => caches.delete(name)));
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
    if (self.clients.openWindow) return await self.clients.openWindow(target);
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

async function putRuntime(request, response) {
  if (!response?.ok) return;
  const cache = await caches.open(RUNTIME_CACHE_NAME);
  await cache.put(request, response.clone());
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (url.origin !== self.location.origin || isAdmin(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const runtime = await caches.open(RUNTIME_CACHE_NAME);
      try {
        const response = await fetch(request);
        if (response.ok) putRuntime(request, response).catch(() => {});
        return response;
      } catch {
        const core = await caches.open(CORE_CACHE_NAME);
        return (await runtime.match(request))
          || (await runtime.match(url.pathname))
          || (await core.match(OFFLINE_URL))
          || Response.error();
      }
    })());
    return;
  }

  if (isLocalStatic(request, url)) {
    event.respondWith((async () => {
      const runtime = await caches.open(RUNTIME_CACHE_NAME);

      // CSS/JS/manifest stay network-first so a new deploy cannot be masked by
      // an older runtime cache. They still fall back to the last good response.
      if (isCriticalStatic(url)) {
        try {
          const freshRequest = new Request(request, { cache: 'reload' });
          const response = await fetch(freshRequest);
          if (response.ok) putRuntime(request, response).catch(() => {});
          return response;
        } catch {
          return (await runtime.match(request)) || Response.error();
        }
      }

      // Images/fonts use stale-while-revalidate. Nothing outside CORE_SHELL is
      // required during install, so one missing optional asset cannot break PWA.
      const cached = await runtime.match(request);
      const network = fetch(request).then(async (response) => {
        if (response.ok) await putRuntime(request, response).catch(() => {});
        return response;
      }).catch(() => null);

      if (cached) {
        event.waitUntil(network.then(() => undefined));
        return cached;
      }
      return (await network) || Response.error();
    })());
  }
});
