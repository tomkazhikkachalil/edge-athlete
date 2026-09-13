import { describe, expect, it } from 'vitest';
import {
  BACKFILL_SOURCES,
  countSkip,
  cursorAfterPage,
  decodeCursor,
  emptySummary,
  encodeCursor,
  isBackfillSource,
  keysetAfter,
  MAX_PAGES,
  PAGE_SIZE,
} from '../backfill';

// Data foundation F5 — the backfill's pure half: the opaque cursor, the
// keyset filter and the page maths the admin route relies on.

const ID = 'a0000000-0000-4000-8000-000000000001';
const T = '2026-09-13T10:20:30.123456+00:00';

describe('the cursor', () => {
  it('round-trips and is opaque (base64url, no padding)', () => {
    const raw = encodeCursor({ t: T, id: ID });
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(raw)).toEqual({ t: T, id: ID });
  });
  it('accepts the Z form and refuses garbage, a tampered pair, a non-uuid id, a non-ISO time, an overlong value', () => {
    expect(decodeCursor(encodeCursor({ t: '2026-09-13T10:20:30Z', id: ID }))).toEqual({ t: '2026-09-13T10:20:30Z', id: ID });
    expect(decodeCursor('not base64 json')).toBeNull();
    expect(decodeCursor('')).toBeNull();
    expect(decodeCursor(undefined)).toBeNull();
    expect(decodeCursor(Buffer.from('[1,2]').toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ t: T, id: 'nope' })).toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ t: '13/09/2026', id: ID })).toString('base64url'))).toBeNull();
    expect(decodeCursor(Buffer.from(JSON.stringify({ t: `${T}) or true`, id: ID })).toString('base64url'))).toBeNull();
    expect(decodeCursor('A'.repeat(201))).toBeNull();
  });
  it('the keyset filter is strictly-after in (created_at, id) order', () => {
    expect(keysetAfter({ t: T, id: ID })).toBe(`created_at.gt.${T},and(created_at.eq.${T},id.gt.${ID})`);
  });
});

describe('the page maths', () => {
  it('a full page hands on its last row; a short page ends the walk', () => {
    const full = Array.from({ length: PAGE_SIZE }, (_, i) => ({ created_at: `2026-09-01T00:00:${String(i % 60).padStart(2, '0')}Z`, id: `${i}` }));
    expect(cursorAfterPage(full)).toEqual({ t: full[PAGE_SIZE - 1].created_at, id: `${PAGE_SIZE - 1}` });
    expect(cursorAfterPage(full.slice(0, 3))).toBeNull();
    expect(cursorAfterPage([])).toBeNull();
    expect(cursorAfterPage([{ created_at: T, id: ID }, { created_at: T, id: 'b' }], 2)).toEqual({ t: T, id: 'b' });
  });
  it('the summary counts skips by reason; the sources and budgets are pinned', () => {
    const s = emptySummary('posts', true);
    countSkip(s, 'pending_approval');
    countSkip(s, 'pending_approval');
    countSkip(s, 'failed_schema');
    expect(s).toEqual({ dryRun: true, source: 'posts', scanned: 0, mapped: 0, skipped: { pending_approval: 2, failed_schema: 1 }, upserted: 0, truncated: false, nextCursor: null });
    expect([...BACKFILL_SOURCES]).toEqual(['golf_rounds', 'posts', 'contest_stat_lines', 'contest_results']);
    expect(isBackfillSource('posts')).toBe(true);
    expect(isBackfillSource('profiles')).toBe(false);
    expect(PAGE_SIZE * MAX_PAGES).toBe(5000);
  });
});
