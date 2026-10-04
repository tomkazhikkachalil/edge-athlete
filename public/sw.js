/*
 * Edge Athlete service worker — PHONE NOTIFICATIONS ONLY (mig 248, Oct 2026).
 *
 * What it does, and all it does:
 *   push              show the notification the server sent and put the
 *                     bell's unread count on the app icon
 *   notificationclick open the exact item (the row's own action_url), mark
 *                     that notification read, and lower the icon number
 *
 * STATIC CACHE (speed round 2, phase E — Oct 4 2026; src/lib/sw/static-cache.ts
 * is the rule, copied here because a worker cannot import): when this file is
 * registered as `/sw.js?static=1` (the deployment's NEXT_PUBLIC_SW_STATIC_CACHE
 * flag), GET requests for `/_next/static/*` — content-hashed, immutable — are
 * answered cache-first, so a phone that just reopened the installed app does
 * not ask the network for the ~450 KB it already has. NOTHING else is
 * touched: documents, `/api/*`, images, push and this file pass straight
 * through — the worker never calls respondWith for them, so there is no
 * offline mode and no stale page after a deploy (conv. 31). Registered as a
 * plain `/sw.js`, there is no fetch handler at all, as before.
 *
 * The payload's shape is src/lib/push/payload.ts (`PushPayload`); its `url` is
 * already a same-origin path, and it is checked again here.
 */

var STATIC_CACHE = 'ea-static-v1';
var STATIC_CACHE_MAX_ENTRIES = 400;
var STATIC_PREFIX = '/_next/static/';
var staticCacheOn = new URL(self.location.href).searchParams.get('static') === '1';

self.addEventListener('install', function () {
  self.skipWaiting();
});

self.addEventListener('activate', function (event) {
  event.waitUntil(
    Promise.all([
      self.clients.claim(),
      // Any cache this worker does not own (an older version's) goes.
      caches.keys().then(function (names) {
        return Promise.all(
          names.filter(function (n) { return n !== STATIC_CACHE; }).map(function (n) { return caches.delete(n); })
        );
      }).catch(function () {}),
    ])
  );
});

/** Keep the static cache bounded: old deploys' chunks are never asked for again. */
function trimStaticCache(cache) {
  return cache.keys().then(function (keys) {
    if (keys.length <= STATIC_CACHE_MAX_ENTRIES) return;
    var excess = keys.slice(0, keys.length - STATIC_CACHE_MAX_ENTRIES);
    return Promise.all(excess.map(function (k) { return cache.delete(k); }));
  }).catch(function () {});
}

self.addEventListener('fetch', function (event) {
  if (!staticCacheOn) return;
  var request = event.request;
  if (request.method !== 'GET') return;
  var url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf(STATIC_PREFIX) !== 0 || url.pathname.indexOf('..') !== -1) return;
  // Only here does the worker answer — a hashed, immutable static file.
  event.respondWith(
    caches.open(STATIC_CACHE).then(function (cache) {
      return cache.match(request).then(function (hit) {
        if (hit) return hit;
        return fetch(request).then(function (response) {
          if (response && response.ok && response.type === 'basic') {
            cache.put(request, response.clone()).then(function () { return trimStaticCache(cache); }).catch(function () {});
          }
          return response;
        });
      });
    })
  );
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
