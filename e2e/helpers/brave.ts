// ── Brave Android, as Playwright can run it (every-browser round, Oct 16 2026) ─
// A Brave Android user could not change their cover photo. Brave is Chromium
// with Shields ON by default, and Shields change what a page gets:
//
//   blocking   requests and elements matched by Brave's default lists
//              (scripts/brave-lists.mjs) — the same engine as
//              `npm run check:blocklists`, applied to every page
//   farbling   canvas readback (getImageData / toDataURL / toBlob) carries
//              ±1 noise, seeded per session; hardwareConcurrency is farbled
//   removed    navigator.connection (no Network Information API)
//   push       PushManager.subscribe rejects — Brave Android's push is off
//              until the user turns on "Use Google services for push
//              messaging"; permission is still granted first
//   marker     navigator.brave.isBrave() — what Brave itself exposes, and the
//              only thing the app may read to tell a user how to fix push
//
// Applied by e2e/helpers/test.ts to every context of the `brave-android`
// project, including the ones a spec makes with browser.newContext(). What it
// cannot be: Brave's own Chromium build. A bug only in that build reaches us
// through Sentry (tunnelled, so Shields do not drop it).

import type { BrowserContext, Page } from '@playwright/test';
import { PlaywrightBlocker } from '@ghostery/adblocker-playwright';
import { braveListsText } from '../../scripts/brave-lists.mjs';

let blockerPromise: Promise<PlaywrightBlocker> | null = null;
/** One engine per worker: the lists are ~5 MB to parse. */
const blocker = () =>
  (blockerPromise ??= braveListsText().then(text => {
    const b = PlaywrightBlocker.parse(text, { loadCosmeticFilters: true, loadNetworkFilters: true });
    b.on('request-blocked', req => console.log(`[brave] blocked ${req.type} ${req.url}`));
    return b;
  }));

/** Runs in the page before any of its scripts. Kept dependency-free: it is serialized. */
function shields(seed: number) {
  let s = seed >>> 0;
  const rand = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const noise = (data: Uint8ClampedArray) => {
    for (let i = 0; i < data.length; i += 4 * 97) data[i] = Math.max(0, Math.min(255, data[i] + (rand() < 0.5 ? -1 : 1)));
  };
  const getImageData = CanvasRenderingContext2D.prototype.getImageData;
  CanvasRenderingContext2D.prototype.getImageData = function (this: CanvasRenderingContext2D, ...args: Parameters<typeof getImageData>) {
    const img = getImageData.apply(this, args);
    noise(img.data);
    return img;
  } as typeof getImageData;
  // toDataURL / toBlob: encode a farbled copy (the canvas itself is untouched),
  // in the same task — a WebGL canvas still holds its frame here.
  const farbledCopy = (c: HTMLCanvasElement): HTMLCanvasElement | null => {
    if (!c.width || !c.height) return null;
    const copy = document.createElement('canvas');
    copy.width = c.width;
    copy.height = c.height;
    const ctx = copy.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(c, 0, 0);
    const img = getImageData.call(ctx, 0, 0, copy.width, copy.height);
    noise(img.data);
    ctx.putImageData(img, 0, 0);
    return copy;
  };
  const toDataURL = HTMLCanvasElement.prototype.toDataURL;
  HTMLCanvasElement.prototype.toDataURL = function (this: HTMLCanvasElement, ...args: Parameters<typeof toDataURL>) {
    const copy = farbledCopy(this);
    return toDataURL.apply(copy ?? this, args);
  } as typeof toDataURL;
  const toBlob = HTMLCanvasElement.prototype.toBlob;
  HTMLCanvasElement.prototype.toBlob = function (this: HTMLCanvasElement, ...args: Parameters<typeof toBlob>) {
    const copy = farbledCopy(this);
    return toBlob.apply(copy ?? this, args);
  } as typeof toBlob;

  const cores = 2 + Math.floor(rand() * 7);
  Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get: () => cores, configurable: true });
  Object.defineProperty(Navigator.prototype, 'connection', { get: () => undefined, configurable: true });
  Object.defineProperty(Navigator.prototype, 'brave', { get: () => ({ isBrave: () => Promise.resolve(true) }), configurable: true });
  if (typeof PushManager !== 'undefined') {
    PushManager.prototype.subscribe = function () {
      return Promise.reject(new DOMException('Registration failed - push service not available', 'AbortError'));
    };
  }
}

const enabled = new WeakSet<BrowserContext>();

/** Turn a context into Brave Android with default Shields (idempotent). */
export async function applyBrave(context: BrowserContext): Promise<void> {
  if (enabled.has(context)) return;
  enabled.add(context);
  await context.addInitScript(shields, Math.floor(Math.random() * 2 ** 31));
  const b = await blocker();
  const onPage = (page: Page) => {
    b.enableBlockingInPage(page as never).catch(err => console.log(`[brave] could not enable blocking: ${err}`));
  };
  context.pages().forEach(onPage);
  context.on('page', onPage);
}
