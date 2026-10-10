import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { buildTag, isStaticAssetPath, staticCacheEnabled, staticCacheName, swUrl } from '../static-cache';

describe('the static cache rules', () => {
  it('is off unless the deployment says so', () => {
    expect(staticCacheEnabled(undefined)).toBe(false);
    expect(staticCacheEnabled('0')).toBe(false);
    expect(staticCacheEnabled('1')).toBe(true);
  });
  it('one worker URL per deployment — and a new one per build, so old assets go', () => {
    expect(swUrl(false, 'abc123')).toBe('/sw.js');
    expect(swUrl(true, 'abc123')).toBe('/sw.js?static=1&v=abc123');
    expect(swUrl(true, 'def456')).not.toBe(swUrl(true, 'abc123'));
    expect(staticCacheName('abc123')).toBe('ea-static-abc123');
  });
  it('the build tag is cache- and URL-safe', () => {
    expect(buildTag('a1b2c3d4e5f6')).toBe('a1b2c3d4e5f6');
    expect(buildTag('../x?y&z')).toBe('xyz');
    expect(buildTag('')).toBe('v1');
    expect(buildTag(undefined)).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(buildTag('x'.repeat(80))).toHaveLength(40);
  });
  it('only hashed static files may be answered from the cache', () => {
    expect(isStaticAssetPath('/_next/static/chunks/abc.js')).toBe(true);
    expect(isStaticAssetPath('/_next/static/media/fa-solid.woff2')).toBe(true);
    expect(isStaticAssetPath('/_next/image?url=x')).toBe(false);
    expect(isStaticAssetPath('/api/notifications')).toBe(false);
    expect(isStaticAssetPath('/feed')).toBe(false);
    expect(isStaticAssetPath('/sw.js')).toBe(false);
    expect(isStaticAssetPath('/_next/static/../../api/x')).toBe(false);
  });
});

describe('public/sw.js keeps to the rules (the worker cannot import them)', () => {
  const sw = fs.readFileSync(path.join(process.cwd(), 'public/sw.js'), 'utf8');
  it('answers only GETs under /_next/static/, and only when registered with ?static=1', () => {
    expect(sw).toContain("'/_next/static/'");
    expect(sw).toContain("SW_PARAMS.get('static') === '1'");
    expect(sw).toMatch(/request\.method !== 'GET'/);
  });
  it('never caches a page, the API, push or itself — a page is the network, or the offline page when it fails', () => {
    const start = sw.indexOf("addEventListener('fetch'");
    const next = sw.indexOf('addEventListener(', start + 1);
    const fetchHandler = sw.slice(start, next === -1 ? undefined : next);
    expect(fetchHandler).not.toMatch(/\/api\//);
    // Two answers: the navigation (network, then the offline page) and the static asset.
    expect(fetchHandler.match(/respondWith\(/g)?.length).toBe(2);
    const nav = fetchHandler.slice(fetchHandler.indexOf("request.mode === 'navigate'"), fetchHandler.indexOf('return;', fetchHandler.indexOf("request.mode === 'navigate'")));
    expect(nav).toContain('fetch(request)');
    expect(nav).toContain('.catch(');
    expect(nav).toContain('OFFLINE_PAGE');
    expect(nav).not.toMatch(/cache\.put|\.put\(/);
    // The only thing ever put in the cache is a /_next/static/ response.
    expect(sw.match(/cache\.put\(/g)?.length).toBe(1);
  });
  it('names its cache by the build and deletes every other on activate', () => {
    expect(sw).toContain("'ea-static-' + BUILD");
    expect(sw).toMatch(/n !== STATIC_CACHE/);
    expect(sw).toContain("cache.add(new Request(OFFLINE_PAGE");
  });
  it('the offline page is static: no user data, no fetch of its own', () => {
    const page = fs.readFileSync(path.join(process.cwd(), 'public/offline.html'), 'utf8');
    expect(page).not.toMatch(/fetch\(|XMLHttpRequest|localStorage|indexedDB|document\.cookie/);
    expect(page).toContain('location.reload()');
  });
});
