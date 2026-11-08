import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FUNCTION_BUDGET_BYTES,
  EXEMPT_ROUTES,
  attributeTracedFile,
  judgeRoutes,
  routeIdFromNftPath,
  summarizeRoute,
} from '../../../scripts/function-weight-rules.mjs';

/**
 * Pins the function-weight gate's rules (scripts/check-function-weight.mjs,
 * part of `npm run check:weight` inside `npm run verify`). The gate exists
 * because the feed's function traced ~175 MB on Nov 7 2026 — the ffmpeg
 * binary, sharp and 95 MB of snapshot PNGs — and nothing noticed. These
 * fixtures pin how a trace is read, attributed and judged.
 */

describe('function weight — reading a trace', () => {
  it('names a route from its nft path, page or route handler', () => {
    expect(routeIdFromNftPath('.next/server/app/(app)/feed/page.js.nft.json')).toBe('(app)/feed');
    expect(routeIdFromNftPath('.next/server/app/api/posts/route.js.nft.json')).toBe('api/posts');
    expect(routeIdFromNftPath('.next/server/app/(public)/org/[slug]/card.png/route.js.nft.json')).toBe('(public)/org/[slug]/card.png');
    expect(routeIdFromNftPath('.next/server/middleware.js.nft.json')).toBeNull();
    expect(routeIdFromNftPath('.next/next-server.js.nft.json')).toBeNull();
  });

  it('attributes a traced file to its npm package, the server chunks, or the project', () => {
    expect(attributeTracedFile('node_modules/ffmpeg-static/ffmpeg')).toBe('ffmpeg-static');
    expect(attributeTracedFile('node_modules/@img/sharp-libvips-linux-x64/lib/libvips.so')).toBe('@img/sharp-libvips-linux-x64');
    expect(attributeTracedFile('../../../node_modules/next/dist/server/x.js')).toBe('next');
    expect(attributeTracedFile('.next/server/chunks/[root-of-the-server]__1.js')).toBe('server/chunks');
    expect(attributeTracedFile('database/ops/snapshots/2026-09-30/storage/uploads/posts/a/b.png')).toBe('project');
    expect(attributeTracedFile('public/logo-mark.png')).toBe('project');
  });

  it('sums a route and ranks its buckets heaviest first', () => {
    const s = summarizeRoute([
      { path: 'node_modules/ffmpeg-static/ffmpeg', bytes: 45_000_000 },
      { path: 'database/ops/snapshots/x.png', bytes: 1_000_000 },
      { path: 'database/ops/snapshots/y.png', bytes: 2_000_000 },
      { path: '.next/server/chunks/a.js', bytes: 500 },
    ], 2);
    expect(s.total).toBe(48_000_500);
    expect(s.files).toBe(4);
    expect(s.buckets).toEqual([
      { name: 'ffmpeg-static', bytes: 45_000_000 },
      { name: 'project', bytes: 3_000_000 },
    ]);
  });
});

describe('function weight — the verdict', () => {
  it('fails a non-exempt route over the budget and reports an exempt one', () => {
    const rows = [
      { route: 'api/posts', total: DEFAULT_FUNCTION_BUDGET_BYTES + 1 },
      { route: 'api/cron/media-jobs', total: 80 * 1024 * 1024 },
      { route: '(app)/feed', total: 6 * 1024 * 1024 },
    ];
    const v = judgeRoutes(rows);
    expect(v.failures.map((r) => r.route)).toEqual(['api/posts']);
    expect(v.exempted.map((r) => r.route)).toEqual(['api/cron/media-jobs']);
  });

  it('judges against the budget it is given', () => {
    expect(judgeRoutes([{ route: 'api/x', total: 10 }], 10).failures).toEqual([]);
    expect(judgeRoutes([{ route: 'api/x', total: 11 }], 10).failures).toHaveLength(1);
  });

  it('exempts exactly the routes that carry a binary on purpose, each with a reason', () => {
    expect(Object.keys(EXEMPT_ROUTES).sort()).toEqual([
      '(public)/[slug]/card.png',
      '(public)/org/[slug]/card.png',
      'api/admin/media-jobs',
      'api/cron/media-jobs',
    ]);
    for (const reason of Object.values(EXEMPT_ROUTES)) expect(reason.length).toBeGreaterThan(10);
  });

  it('keeps the budget at 25 MB — raising it is a decision, written in the devlog', () => {
    expect(DEFAULT_FUNCTION_BUDGET_BYTES).toBe(25 * 1024 * 1024);
  });
});
