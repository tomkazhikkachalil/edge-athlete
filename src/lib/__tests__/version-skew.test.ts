import { describe, it, expect } from 'vitest';
import { isChunkLoadError, shouldReloadForSkew, SKEW_RELOAD_WINDOW_MS } from '../version-skew';

describe('isChunkLoadError', () => {
  it('recognises the three engines\' chunk failures and nothing else', () => {
    expect(isChunkLoadError({ name: 'ChunkLoadError', message: 'Loading chunk 4821 failed.' })).toBe(true);
    expect(isChunkLoadError({ name: 'Error', message: 'Loading CSS chunk 12 failed. (/_next/static/css/x.css)' })).toBe(true);
    expect(isChunkLoadError({ name: 'TypeError', message: 'Importing a module script failed.' })).toBe(true);
    expect(isChunkLoadError({ name: 'TypeError', message: 'Failed to fetch dynamically imported module: https://x/_next/static/chunks/a.js' })).toBe(true);
    expect(isChunkLoadError({ name: 'TypeError', message: 'error loading dynamically imported module' })).toBe(true);
    expect(isChunkLoadError({ name: 'TypeError', message: "Cannot read properties of undefined (reading 'id')" })).toBe(false);
    expect(isChunkLoadError({ name: 'Error', message: 'Failed to fetch' })).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });
});

describe('shouldReloadForSkew', () => {
  it('reloads once per window, then shows the screen', () => {
    const now = 5_000_000;
    expect(shouldReloadForSkew(null, now)).toBe(true);
    expect(shouldReloadForSkew('garbage', now)).toBe(true);
    expect(shouldReloadForSkew(String(now - 1_000), now)).toBe(false);
    expect(shouldReloadForSkew(String(now - SKEW_RELOAD_WINDOW_MS - 1), now)).toBe(true);
  });
});
