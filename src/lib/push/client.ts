'use client';

/**
 * Phone notifications, the browser half (mig 248, Oct 2026). Every API is
 * feature-checked: the app's floor is iOS 15, and push itself exists only on
 * iOS 16.4+ inside the HOME-SCREEN app, on Android Chrome, and on desktop
 * browsers. Nothing here runs at module load.
 *
 *   pushSupport()   what this device can do right now
 *   enablePush()    from a TAP only (iOS refuses a permission prompt that a
 *                   tap did not start): permission → the worker → subscribe
 *                   → tell the server
 *   disablePush()   unsubscribe this device and tell the server
 *   syncPush()      on every app start, signed in, permission granted: make
 *                   sure the server holds this device's CURRENT endpoint
 *                   (push services rotate them) — and, when this device CHOSE
 *                   on for this account but holds no subscription (a sign-out
 *                   turned it off, iOS dropped it), subscribe again silently.
 *                   Granted permission needs no gesture to subscribe.
 *   setIconBadge()  the number on the app icon (installed apps)
 *   closeShownNotifications()  take read items off the phone's notification
 *                   center (the worker only ever closes the one tapped)
 */

import { staticCacheEnabled, swUrl } from '@/lib/sw/static-cache';
import { urlBase64ToUint8Array } from './keys';
import {
  deviceChoiceFor,
  parseDeviceChoice,
  serializeDeviceChoice,
  PUSH_DEVICE_CHOICE_KEY,
  type DeviceChoice,
} from './card';

export type PushSupport =
  /** No service worker / PushManager / Notification here at all. */
  | 'unsupported'
  /** An iPhone or iPad in a browser tab: push exists only in the app opened
   *  from the home-screen icon. */
  | 'needs-install'
  /** Can ask. */
  | 'available'
  /** Permission granted (the device may or may not be subscribed yet). */
  | 'granted'
  /** The person said no; only the phone's settings can undo it. */
  | 'denied';

/** The worker's URL — ONE per deployment (static-cache.ts swUrl): the push
 *  opt-in and the boot registration must agree or the browser swaps workers. */
export const SW_PATH = swUrl(staticCacheEnabled());

interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}

function hasPushApis(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    typeof window.PushManager === 'function' &&
    typeof window.Notification === 'function'
  );
}

/**
 * `isIos` and `standalone` come from the install store (the ONE place that
 * knows them — src/lib/install/store.ts), so this stays pure enough to test
 * the iPhone rule without a browser.
 */
export function pushSupportFrom(signals: {
  apis: boolean;
  isIos: boolean;
  standalone: boolean;
  permission: NotificationPermission | null;
}): PushSupport {
  if (signals.isIos && !signals.standalone) return 'needs-install';
  if (!signals.apis || signals.permission === null) return 'unsupported';
  if (signals.permission === 'granted') return 'granted';
  if (signals.permission === 'denied') return 'denied';
  return 'available';
}

export function pushSupport(signals: { isIos: boolean; standalone: boolean }): PushSupport {
  const apis = hasPushApis();
  return pushSupportFrom({
    apis,
    isIos: signals.isIos,
    standalone: signals.standalone,
    permission: apis ? Notification.permission : null,
  });
}

let configPromise: Promise<PushConfig> | null = null;

/** The deployment's push config, fetched once per page load. */
export function loadPushConfig(): Promise<PushConfig> {
  if (!configPromise) {
    configPromise = fetch('/api/push/config', { cache: 'no-store' })
      .then(r => (r.ok ? (r.json() as Promise<PushConfig>) : { enabled: false, publicKey: null }))
      .catch(() => ({ enabled: false, publicKey: null }));
  }
  return configPromise;
}

// ── The device's choice, remembered per account (src/lib/push/card.ts) ─────

/** What this account chose on this device, or null when never asked-and-answered. */
export function readDeviceChoice(userId: string | null): DeviceChoice | null {
  if (typeof window === 'undefined') return null;
  try {
    return deviceChoiceFor(parseDeviceChoice(window.localStorage.getItem(PUSH_DEVICE_CHOICE_KEY)), userId);
  } catch {
    return null;
  }
}

/** Written by the two doors (the feed card, the Settings switch) — never by
 *  sign-out, so the same person is repaired on their next sign-in. */
export function rememberDeviceChoice(userId: string, choice: DeviceChoice): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PUSH_DEVICE_CHOICE_KEY, serializeDeviceChoice(userId, choice, Date.now()));
  } catch {
    // Storage unavailable — the card may ask again next visit; never an error.
  }
}

async function registration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration('/');
  if (existing) return existing;
  return navigator.serviceWorker.register(SW_PATH, { scope: '/' });
}

async function postSubscription(sub: PushSubscription): Promise<boolean> {
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return false;
  const response = await fetch('/api/push/subscriptions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } }),
  });
  return response.ok;
}

/** Subscribe this device (permission already granted) and tell the server. */
async function subscribeHere(config: PushConfig): Promise<boolean> {
  if (!config.enabled || !config.publicKey) return false;
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const key = urlBase64ToUint8Array(config.publicKey);
  let sub = await reg.pushManager.getSubscription();
  // A subscription made against an older key cannot be reused.
  if (sub && !sameKey(sub.options?.applicationServerKey ?? null, key)) {
    await sub.unsubscribe().catch(() => false);
    sub = null;
  }
  if (!sub) {
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
  }
  return postSubscription(sub);
}

export type EnableResult = 'on' | 'denied' | 'unavailable' | 'failed';

/** Call from a click / tap handler only. */
export async function enablePush(): Promise<EnableResult> {
  if (!hasPushApis()) return 'unavailable';
  const config = await loadPushConfig();
  if (!config.enabled || !config.publicKey) return 'unavailable';
  let permission: NotificationPermission = Notification.permission;
  if (permission === 'default') {
    try {
      permission = await Notification.requestPermission();
    } catch {
      return 'failed';
    }
  }
  if (permission === 'denied') return 'denied';
  if (permission !== 'granted') return 'failed';
  try {
    return (await subscribeHere(config)) ? 'on' : 'failed';
  } catch {
    return 'failed';
  }
}

function sameKey(current: ArrayBuffer | null, wanted: Uint8Array): boolean {
  if (!current) return true; // the browser does not say — trust the existing one
  const bytes = new Uint8Array(current);
  if (bytes.length !== wanted.length) return false;
  for (let i = 0; i < bytes.length; i++) if (bytes[i] !== wanted[i]) return false;
  return true;
}

/** Is THIS device subscribed right now? */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!hasPushApis()) return null;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    return reg ? await reg.pushManager.getSubscription() : null;
  } catch {
    return null;
  }
}

/** Turn this device off. Never throws (sign-out calls it). */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe().catch(() => false);
  await fetch('/api/push/subscriptions', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint }),
  }).catch(() => undefined);
}

let syncFor: { userId: string; promise: Promise<void> } | null = null;

/**
 * On app start, signed in: keep the server holding this device's current
 * endpoint, and REPAIR a device that chose on for this account but holds no
 * subscription. Silent; never prompts; ONE run per account per page load (the
 * host and every door await the same promise, so no door reads the device
 * before the repair). Never throws.
 */
export function syncPush(userId: string): Promise<void> {
  if (syncFor?.userId === userId) return syncFor.promise;
  const promise = runSync(userId).catch(() => undefined);
  syncFor = { userId, promise };
  return promise;
}

async function runSync(userId: string): Promise<void> {
  if (!hasPushApis() || Notification.permission !== 'granted') return;
  const sub = await currentSubscription();
  if (sub) {
    await postSubscription(sub);
    return;
  }
  // Allowed, not subscribed. The person turned it off here (choice 'off'), or
  // was never asked (null) — leave it. Only a device that said ON for THIS
  // account is repaired: the subscription went with a sign-out or the phone.
  if (readDeviceChoice(userId) !== 'on') return;
  await subscribeHere(await loadPushConfig());
}

/** The number on the app icon. Feature-detected; a no-op where unsupported. */
export function setIconBadge(count: number): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as Navigator & {
    setAppBadge?: (n?: number) => Promise<void>;
    clearAppBadge?: () => Promise<void>;
  };
  try {
    if (count > 0 && typeof nav.setAppBadge === 'function') {
      void nav.setAppBadge(count).catch(() => undefined);
    } else if (count <= 0 && typeof nav.clearAppBadge === 'function') {
      void nav.clearAppBadge().catch(() => undefined);
    }
  } catch {
    /* a nicety — never an error */
  }
}

export type ShownFilter = { all: true } | { id: string } | { tag: string };

/**
 * Take read items off the phone's notification center. The worker closes only
 * the notification that was TAPPED; something read inside the app (a row, the
 * bell opened, a conversation read) would otherwise sit there until the phone
 * cleared it. Matches by the worker's own `data.id` and `tag`
 * (src/lib/push/payload.ts). Feature-detected; never throws.
 */
export async function closeShownNotifications(filter: ShownFilter): Promise<void> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration('/');
    if (!reg || typeof reg.getNotifications !== 'function') return;
    const shown = await reg.getNotifications();
    for (const n of shown) {
      const matches =
        'all' in filter ||
        ('id' in filter && (n.data as { id?: unknown } | null)?.id === filter.id) ||
        ('tag' in filter && n.tag === filter.tag);
      if (matches) n.close();
    }
  } catch {
    /* a nicety — never an error */
  }
}
