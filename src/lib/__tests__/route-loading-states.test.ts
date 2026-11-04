import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Route-level loading states (launch phase 3, PR I, Nov 4 2026): the heavy
// signed-in segments carry a loading.tsx that renders the SAME view the page
// shows while it fetches (RouteLoading), so the hand-off is one view, not two.
const SEGMENTS: Array<[string, string]> = [
  ['src/app/(app)/feed', 'Loading your feed...'],
  ['src/app/(app)/athlete/[id]', 'Loading athlete profile...'],
  ['src/app/(app)/u/[username]', 'Loading profile...'],
  ['src/app/(app)/settings', 'Loading...'],
];
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

describe('route loading states', () => {
  it('each heavy segment has a loading.tsx rendering RouteLoading with the page\'s own words', () => {
    for (const [dir, message] of SEGMENTS) {
      const loading = read(`${dir}/loading.tsx`);
      expect(loading, dir).toContain("from '@/components/RouteLoading'");
      expect(loading, dir).toContain(`message="${message}"`);
      expect(loading, dir).not.toMatch(/^'use client'/m);
    }
  });
  it('the page\'s own fetching branch renders the same RouteLoading, with the same message', () => {
    for (const [dir, message] of SEGMENTS) {
      const page = read(`${dir}/page.tsx`);
      expect(page, dir).toContain("import RouteLoading from '@/components/RouteLoading';");
      expect(page, dir).toContain(`<RouteLoading message="${message}"`);
      // The old inline spinner is gone from the fetching branch — one view, one place.
      expect(page.match(/animate-spin rounded-full h-(8|12) w-(8|12) border-b-2 border-brand mx-auto/g) ?? [], dir).toHaveLength(0);
    }
  });
  it('RouteLoading is pure presentation: no hooks, no client boundary, a polite status region', () => {
    const src = read('src/components/RouteLoading.tsx');
    expect(src).not.toMatch(/^'use client'/m);
    expect(src).not.toMatch(/\buse[A-Z]\w*\(/);
    expect(src).toContain('role="status"');
    expect(src).toContain('aria-live="polite"');
    expect(src).toContain('data-route-loading');
  });
});
