import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isStaticAssetPath, staticCacheEnabled, swUrl } from '../static-cache';

describe('the static cache rules', () => {
  it('is off unless the deployment says so', () => {
    expect(staticCacheEnabled(undefined)).toBe(false);
    expect(staticCacheEnabled('0')).toBe(false);
    expect(staticCacheEnabled('1')).toBe(true);
  });
  it('one worker URL per deployment', () => {
    expect(swUrl(false)).toBe('/sw.js');
    expect(swUrl(true)).toBe('/sw.js?static=1');
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
    expect(sw).toContain("searchParams.get('static') === '1'");
    expect(sw).toMatch(/request\.method !== 'GET'/);
  });
  it('never touches documents, the API, push or itself', () => {
    const start = sw.indexOf("addEventListener('fetch'");
    const next = sw.indexOf('addEventListener(', start + 1);
    const fetchHandler = sw.slice(start, next === -1 ? undefined : next);
    expect(fetchHandler).not.toMatch(/\/api\//);
    expect(fetchHandler).not.toMatch(/mode === 'navigate'[^\n]*respondWith/);
    // One respondWith, and it is inside the static-asset branch.
    expect(fetchHandler.match(/respondWith\(/g)?.length).toBe(1);
  });
});
