import { describe, it, expect } from 'vitest';
import { installMode, isHandheld, type InstallSignals } from '../platform';

const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/21F90 Instagram 338.0.0.26.86 (iPhone15,3; iOS 17_5; en_US; en; scale=3.00; 1290x2796; 615072868)',
  iphoneWebView:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  ipadDesktopSite:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
  androidFacebook:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP2A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36 [FB_IAB/FB4A;FBAV/470.0.0.0;]',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};

const on = (userAgent: string, over: Partial<InstallSignals> = {}): InstallSignals => ({
  userAgent,
  maxTouchPoints: 0,
  standalone: false,
  hasPrompt: false,
  ...over,
});

describe('installMode', () => {
  it('reads "installed" for anything running from the icon, whatever the device', () => {
    expect(installMode(on(UA.iphoneSafari, { standalone: true, maxTouchPoints: 5 }))).toBe('installed');
    expect(installMode(on(UA.androidChrome, { standalone: true, hasPrompt: true }))).toBe('installed');
    expect(installMode(on(UA.macChrome, { standalone: true }))).toBe('installed');
  });

  it('sends an iPhone in Safari to the Share steps', () => {
    expect(installMode(on(UA.iphoneSafari, { maxTouchPoints: 5 }))).toBe('ios-safari');
  });

  it('tells Chrome on iOS apart — its Share button is somewhere else', () => {
    expect(installMode(on(UA.iphoneChrome, { maxTouchPoints: 5 }))).toBe('ios-browser');
  });

  it("knows another app's browser on iOS cannot add to the home screen", () => {
    expect(installMode(on(UA.iphoneInstagram, { maxTouchPoints: 5 }))).toBe('ios-in-app');
    // A bare WKWebView: no "Safari/" token.
    expect(installMode(on(UA.iphoneWebView, { maxTouchPoints: 5 }))).toBe('ios-in-app');
  });

  it('reads an iPad asking for the desktop site as iOS, and a real Mac as a desktop', () => {
    expect(installMode(on(UA.ipadDesktopSite, { maxTouchPoints: 5 }))).toBe('ios-safari');
    expect(installMode(on(UA.ipadDesktopSite, { maxTouchPoints: 0 }))).toBe('desktop');
  });

  it('offers the one-tap install wherever the browser handed over a prompt', () => {
    expect(installMode(on(UA.androidChrome, { hasPrompt: true }))).toBe('prompt');
    expect(installMode(on(UA.macChrome, { hasPrompt: true }))).toBe('prompt');
  });

  it('points Android without a prompt at the browser menu, and an in-app browser at Chrome', () => {
    expect(installMode(on(UA.androidChrome))).toBe('android-menu');
    expect(installMode(on(UA.androidFirefox))).toBe('android-menu');
    expect(installMode(on(UA.androidFacebook))).toBe('android-in-app');
  });

  it('never claims a prompt on iOS — no such thing exists there', () => {
    expect(installMode(on(UA.iphoneSafari, { hasPrompt: true, maxTouchPoints: 5 }))).toBe('ios-safari');
  });
});

describe('isHandheld', () => {
  it('is true for phones and tablets only', () => {
    expect(isHandheld({ userAgent: UA.iphoneSafari, maxTouchPoints: 5 })).toBe(true);
    expect(isHandheld({ userAgent: UA.ipadDesktopSite, maxTouchPoints: 5 })).toBe(true);
    expect(isHandheld({ userAgent: UA.androidChrome, maxTouchPoints: 5 })).toBe(true);
    expect(isHandheld({ userAgent: UA.macChrome, maxTouchPoints: 0 })).toBe(false);
  });
});
