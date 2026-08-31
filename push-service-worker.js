'use strict';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
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
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
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
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
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
