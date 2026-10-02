/**
 * "Download the app" — what THIS device can do (Oct 2026). Edge Athlete is
 * installed straight from the browser (the web manifest, standalone), never
 * through a store, and every platform has its own way in. This is the ONE
 * rule every invitation reads: the menu entry, the feed card, the Settings
 * card and the guide all ask it, so a device is never told two stories.
 * Pure, zero imports — the browser reads live in install-store.ts.
 *
 * The limits are the platforms', not ours:
 *  - Android / desktop Chromium hand the page an install prompt
 *    (`beforeinstallprompt`) — a real one-tap install.
 *  - iOS gives a website NO install API. It is Share → Add to Home Screen,
 *    in Safari always and in Chrome / Edge / Firefox from iOS 16.4.
 *  - An in-app browser (Instagram, Facebook, LinkedIn…) can add nothing to
 *    the home screen: the person has to open the real browser first.
 */

export type InstallMode =
  /** Running from the icon. Every invitation is hidden. */
  | 'installed'
  /** The browser handed us an install prompt: one tap. */
  | 'prompt'
  | 'ios-safari'
  /** Chrome / Edge / Firefox on iOS — Share lives in their own toolbar. */
  | 'ios-browser'
  | 'ios-in-app'
  /** Android without a prompt (Firefox, or before the event): the ⋮ menu. */
  | 'android-menu'
  | 'android-in-app'
  /** Nothing to install here — the app is for a phone or tablet. */
  | 'desktop';

export interface InstallSignals {
  userAgent: string;
  /** `navigator.maxTouchPoints` — iPadOS reports a Mac user agent. */
  maxTouchPoints: number;
  /** `display-mode: standalone`, or iOS's `navigator.standalone`. */
  standalone: boolean;
  /** A captured `beforeinstallprompt` is waiting. */
  hasPrompt: boolean;
}

/** Other apps' embedded browsers. They cannot add to the home screen. */
const IN_APP_RE = /FBAN|FBAV|FB_IAB|Instagram|LinkedInApp|Line\/|TikTok|musical_ly|Snapchat|Twitter|Pinterest|GSA\//i;
/** Real browsers on iOS that are not Safari (all WebKit underneath). */
const IOS_OTHER_BROWSER_RE = /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|Brave/i;

export function isIos(signals: Pick<InstallSignals, 'userAgent' | 'maxTouchPoints'>): boolean {
  const ua = signals.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  // iPadOS 13+ asks for the desktop site by default: a "Macintosh" with a
  // touch screen is an iPad (no Mac has one).
  return /Macintosh/.test(ua) && signals.maxTouchPoints > 1;
}

export function isAndroid(signals: Pick<InstallSignals, 'userAgent'>): boolean {
  return /Android/i.test(signals.userAgent);
}

/** A phone or a tablet — where the feed's invitation card belongs. */
export function isHandheld(signals: Pick<InstallSignals, 'userAgent' | 'maxTouchPoints'>): boolean {
  return isIos(signals) || isAndroid(signals);
}

export function installMode(signals: InstallSignals): InstallMode {
  if (signals.standalone) return 'installed';
  const ua = signals.userAgent;
  if (isIos(signals)) {
    // A WKWebView's default user agent carries no "Safari/" token at all.
    if (IN_APP_RE.test(ua) || !/Safari\//.test(ua)) return 'ios-in-app';
    return IOS_OTHER_BROWSER_RE.test(ua) ? 'ios-browser' : 'ios-safari';
  }
  if (signals.hasPrompt) return 'prompt';
  if (isAndroid(signals)) {
    return IN_APP_RE.test(ua) || /; wv\)/.test(ua) ? 'android-in-app' : 'android-menu';
  }
  return 'desktop';
}
