import { describe, it, expect } from 'vitest';
import {
  ROOT_GZIP_BUDGET_BYTES,
  ROUTE_GZIP_BUDGET_BYTES,
  entryChunksOf,
  judgeBundle,
  parseReferenceManifest,
  routeIdFromReferenceManifestPath,
} from '../../../scripts/bundle-weight-rules.mjs';

/**
 * Pins the bundle-weight gate's rules (scripts/check-bundle-weight.mjs, part
 * of `npm run check:weight` inside `npm run verify`): how a route's first-
 * paint chunks are read from its client-reference manifest, and the gzipped
 * budgets the root and every route are judged against.
 */

const manifest = `globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {};
globalThis.__RSC_MANIFEST["/(app)/feed/page"] = ${JSON.stringify({
  clientModules: {},
  entryJSFiles: {
    '[project]/src/app/global-error': ['static/chunks/ge.js'],
    '[project]/src/app/(app)/layout': ['static/chunks/root-a.js', 'static/chunks/layout-b.js'],
    '[project]/src/app/(app)/error': ['static/chunks/root-a.js', 'static/chunks/error-c.js'],
    '[project]/src/app/(app)/not-found': ['static/chunks/root-a.js', 'static/chunks/nf.js'],
    '[project]/src/app/(app)/feed/loading': ['static/chunks/root-a.js', 'static/chunks/loading-d.js'],
    '[project]/src/app/(app)/feed/page': ['static/chunks/root-a.js', 'static/chunks/page-e.js'],
  },
})};
`;

describe('bundle weight — reading a route', () => {
  it('names a route from its client-reference manifest path', () => {
    expect(routeIdFromReferenceManifestPath('.next/server/app/(app)/feed/page_client-reference-manifest.js')).toBe('(app)/feed');
    expect(routeIdFromReferenceManifestPath('.next/server/app/(app)/feed/page.js')).toBeNull();
  });

  it('parses the JSON assigned in the manifest file', () => {
    const m = parseReferenceManifest(manifest);
    expect(m).not.toBeNull();
    expect(Object.keys(m!.entryJSFiles)).toHaveLength(6);
    expect(parseReferenceManifest('not a manifest')).toBeNull();
  });

  it('takes the layout, loading and page entries and leaves error, not-found and global-error out', () => {
    const chunks = entryChunksOf(parseReferenceManifest(manifest));
    expect(chunks.sort()).toEqual(['static/chunks/layout-b.js', 'static/chunks/loading-d.js', 'static/chunks/page-e.js', 'static/chunks/root-a.js']);
  });
});

describe('bundle weight — the verdict', () => {
  it('fails the root over its budget and every route over its own', () => {
    const f = judgeBundle({ rootGz: ROOT_GZIP_BUDGET_BYTES + 1, routes: [{ route: '(app)/feed', gz: ROUTE_GZIP_BUDGET_BYTES + 1 }, { route: '(app)/help', gz: 10 }] });
    expect(f.map((x) => x.what)).toEqual(['root', '(app)/feed']);
  });

  it('passes at the budget exactly', () => {
    expect(judgeBundle({ rootGz: ROOT_GZIP_BUDGET_BYTES, routes: [{ route: 'x', gz: ROUTE_GZIP_BUDGET_BYTES }] })).toEqual([]);
  });

  it('keeps the budgets where the ratchet left them (Nov 8 2026, the icons round: root 150 KB — 132 measured — and route 600 KB gz — the athlete page is 586 with its icons on the sprite)', () => {
    expect(ROOT_GZIP_BUDGET_BYTES).toBe(150 * 1024);
    expect(ROUTE_GZIP_BUDGET_BYTES).toBe(600 * 1024);
  });
});
