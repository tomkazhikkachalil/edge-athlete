/*
 * Edge Athlete service worker — PHONE NOTIFICATIONS ONLY (mig 248, Oct 2026).
 *
 * What it does, and all it does:
 *   push              show the notification the server sent and put the
 *                     bell's unread count on the app icon
 *   notificationclick open the exact item (the row's own action_url), mark
 *                     that notification read, and lower the icon number
 *
 * What it deliberately does NOT do: there is no `fetch` handler, no cache and
 * no offline mode. Every page loads from the network exactly as it did before
 * this file existed — a worker that cached pages could serve a stale app after
 * a deploy, and that is a separate, deliberate round (CLAUDE.md conv. 31).
 *
 * The payload's shape is src/lib/push/payload.ts (`PushPayload`); its `url` is
 * already a same-origin path, and it is checked again here.
 */

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(self.clients.claim());
});

function setBadge(count) {
  var nav = self.navigator;
  if (!nav) return Promise.resolve();
  try {
    if (count > 0 && typeof nav.setAppBadge === 'function') return nav.setAppBadge(count).catch(function () {});
    if (count <= 0 && typeof nav.clearAppBadge === 'function') return nav.clearAppBadge().catch(function () {});
  } catch {
    /* badging is a nicety — never fail a push over it */
  }
  return Promise.resolve();
}

function safePath(url) {
  if (typeof url !== 'string' || url.charAt(0) !== '/' || url.charAt(1) === '/' || url.indexOf('\\') !== -1) {
    return '/app/notifications';
  }
  return url;
}

self.addEventListener('push', function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  var title = typeof data.title === 'string' && data.title ? data.title : 'Edge Athlete';
  var badge = typeof data.badge === 'number' ? data.badge : 0;
  // iOS requires every push to show a notification — always show one.
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body: typeof data.body === 'string' ? data.body : '',
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: typeof data.tag === 'string' ? data.tag : undefined,
        data: { url: safePath(data.url), id: typeof data.id === 'string' ? data.id : null },
      }),
      setBadge(badge),
    ])
  );
});

self.addEventListener('notificationclick', function (event) {
  event.notification.close();
  var info = event.notification.data || {};
  var path = safePath(info.url);
  var target = new URL(path, self.location.origin).href;

  var markRead = info.id
    ? fetch('/api/notifications/' + encodeURIComponent(info.id), {
        method: 'PATCH',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_read: true }),
      })
        .then(function () {
          return fetch('/api/notifications/unread-count', { credentials: 'same-origin' });
        })
        .then(function (response) {
          return response.ok ? response.json() : null;
        })
        .then(function (body) {
          if (body && typeof body.count === 'number') return setBadge(body.count);
        })
        .catch(function () {})
    : Promise.resolve();

  var open = self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (windows) {
    for (var i = 0; i < windows.length; i++) {
      var client = windows[i];
      if (new URL(client.url).origin !== self.location.origin) continue;
      if ('navigate' in client && 'focus' in client) {
        return client.focus().then(function (focused) {
          return (focused || client).navigate(target);
        }).catch(function () {
          return self.clients.openWindow(target);
        });
      }
    }
    return self.clients.openWindow(target);
  });

  event.waitUntil(Promise.all([markRead, open]));
});
