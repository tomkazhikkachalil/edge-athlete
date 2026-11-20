import { describe, it, expect } from 'vitest';
import { createProviderBreaker, hostOf, isHostFailure, PROVIDER_DOWN_MS } from '../provider-breaker';

const OG = 'api.opengolfapi.org';
const GCA = 'api.golfcourseapi.com';

describe('a provider that is down is skipped for a while', () => {
  it('a timeout, a network error or a 5xx trips it; a 4xx never does', () => {
    for (const s of ['timeout', 'network', 500, 502, 503, 599] as const) expect(isHostFailure(s), String(s)).toBe(true);
    for (const s of [400, 401, 403, 404, 429, 499] as const) expect(isHostFailure(s), String(s)).toBe(false);
    const b = createProviderBreaker(() => 0);
    b.record(OG, 404);
    b.record(OG, 429);
    expect(b.isDown(OG)).toBe(false);
  });
  it('skipped for the whole wait, then ONE call tries again', () => {
    let t = 1_000;
    const b = createProviderBreaker(() => t);
    expect(b.isDown(OG)).toBe(false);
    b.record(OG, 500);
    expect(b.isDown(OG)).toBe(true);
    t += PROVIDER_DOWN_MS - 1;
    expect(b.isDown(OG)).toBe(true);
    t += 1;
    expect(b.isDown(OG)).toBe(false); // this caller makes the real call
    b.record(OG, 'timeout'); // …and it failed again
    expect(b.isDown(OG)).toBe(true);
    t += PROVIDER_DOWN_MS;
    expect(b.isDown(OG)).toBe(false);
    b.record(OG, 'ok');
    expect(b.isDown(OG)).toBe(false);
    expect(b.snapshot()).toEqual({});
  });
  it('a success clears it at once; one host never speaks for another', () => {
    let t = 0;
    const b = createProviderBreaker(() => t);
    b.record(OG, 'network');
    expect(b.isDown(GCA)).toBe(false);
    expect(b.snapshot()).toEqual({ [OG]: PROVIDER_DOWN_MS });
    b.record(OG, 'ok');
    expect(b.isDown(OG)).toBe(false);
    t = 5;
    b.record(GCA, 503);
    expect(b.isDown(GCA)).toBe(true);
    expect(b.isDown(OG)).toBe(false);
  });
  it('the host of a URL', () => {
    expect(hostOf('https://api.opengolfapi.org/api/v1/courses/search?q=x')).toBe(OG);
    expect(hostOf('not a url')).toBe('');
  });
});
