import { afterEach, describe, expect, it, vi } from 'vitest';
import { geolocationGranted } from '../request-position';

// The golf round steps (Oct 28 2026): the course step runs the one-shot fix
// on entry ONLY when the device already granted location — never a prompt
// on arrival. Everything that is not a clear "granted" reads as false.
const setNavigator = (value: unknown) => {
  vi.stubGlobal('navigator', value);
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('geolocationGranted — feature-detected, never asks', () => {
  it('true only when the Permissions API answers granted for geolocation', async () => {
    const query = vi.fn(async () => ({ state: 'granted' }));
    setNavigator({ geolocation: {}, permissions: { query } });
    await expect(geolocationGranted()).resolves.toBe(true);
    expect(query).toHaveBeenCalledWith({ name: 'geolocation' });
  });
  it('false for prompt and denied — the Near me button stands', async () => {
    for (const state of ['prompt', 'denied']) {
      setNavigator({ geolocation: {}, permissions: { query: async () => ({ state }) } });
      await expect(geolocationGranted()).resolves.toBe(false);
    }
  });
  it('false with no Permissions API (iOS 15), no geolocation, no navigator, or a query that throws', async () => {
    setNavigator({ geolocation: {} });
    await expect(geolocationGranted()).resolves.toBe(false);
    setNavigator({ permissions: { query: async () => ({ state: 'granted' }) } });
    await expect(geolocationGranted()).resolves.toBe(false);
    setNavigator(undefined);
    await expect(geolocationGranted()).resolves.toBe(false);
    setNavigator({ geolocation: {}, permissions: { query: async () => { throw new TypeError('geolocation is not a valid name'); } } });
    await expect(geolocationGranted()).resolves.toBe(false);
  });
});
