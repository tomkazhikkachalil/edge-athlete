/**
 * Coarse platform detection (browser-only, UA-based — coarse on purpose).
 *
 * `isIOSWebKit`: every browser on iPhone/iPad is Apple's WebKit under its own
 * skin (Chrome for iOS included — Tom's phone). It exists for ONE decision:
 * on these devices the native camera must be opened from a light page, not
 * from the feed — WebKit discards a heavy page's process while the camera is
 * up and reloads it on return (WebKit bug 172533, "A problem occurred with
 * this webpage so it was reloaded"), losing the photo. Never use it for
 * layout or feature gating; feature-detect those.
 */
export function isIOSWebKit(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPadOS 13+ reports as a Mac; the touch points give it away.
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}
