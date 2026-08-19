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
      type: data.type || 'notification',
    },
  };

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
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

    // The visible account page already has a Realtime foreground notification
    // listener. Suppress only that duplicate; hidden/closed pages still get Web Push.
    if (visibleAccount) return;
    await self.registration.showNotification(title, options);
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const raw = event.notification?.data?.url || '/ucet.html';
  let target;
  try {
    target = new URL(raw, self.location.origin).href;
  } catch {
    target = new URL('/ucet.html', self.location.origin).href;
  }

  if (new URL(target).origin !== self.location.origin) {
    target = new URL('/ucet.html', self.location.origin).href;
  }

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('navigate' in client) {
        try { await client.navigate(target); } catch {}
      }
      if ('focus' in client) return client.focus();
    }
    return clients.openWindow(target);
  })());
});
