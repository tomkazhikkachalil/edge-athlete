import { afterEach, describe, expect, it } from 'vitest';
import { getOnline, getOnlineServer, shouldPoll } from '../online';

// The offline rules (maintenance pass, Oct 10 2026): a poller ticks only while
// the page is visible AND the browser reports a network; the server render is
// "online" (no banner flash).
const g = globalThis as unknown as { navigator?: unknown; document?: unknown };
const saved = { navigator: g.navigator, document: g.document };
function setEnv(onLine: boolean | undefined, visibility: 'visible' | 'hidden' | undefined) {
  Object.defineProperty(globalThis, 'navigator', { value: onLine === undefined ? undefined : { onLine }, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: visibility === undefined ? undefined : { visibilityState: visibility }, configurable: true });
}
afterEach(() => {
  Object.defineProperty(globalThis, 'navigator', { value: saved.navigator, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: saved.document, configurable: true });
});

describe('online store', () => {
  it('polls only when visible and online', () => {
    setEnv(true, 'visible');
    expect(shouldPoll()).toBe(true);
    setEnv(false, 'visible');
    expect(shouldPoll()).toBe(false);
    setEnv(true, 'hidden');
    expect(shouldPoll()).toBe(false);
  });
  it('reads online unless the browser says otherwise; the server is online', () => {
    setEnv(undefined, undefined);
    expect(getOnline()).toBe(true);
    expect(shouldPoll()).toBe(true);
    setEnv(false, 'visible');
    expect(getOnline()).toBe(false);
    expect(getOnlineServer()).toBe(true);
  });
});
