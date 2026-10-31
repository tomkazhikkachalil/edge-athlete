import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { BACKFILL_DEFAULT_LIMIT, BACKFILL_MAX_LIMIT, backfillRetryCutoff, parseBackfillParams } from '../sheet-backfill';

describe('parseBackfillParams', () => {
  it('is a dry run unless dryRun is exactly false', () => {
    expect(parseBackfillParams({ countryCode: 'CA' })?.dryRun).toBe(true);
    expect(parseBackfillParams({ countryCode: 'CA', dryRun: 'false' })?.dryRun).toBe(true);
    expect(parseBackfillParams({ countryCode: 'CA', dryRun: false })?.dryRun).toBe(false);
  });
  it('requires a country, normalizes codes, and caps the batch', () => {
    expect(parseBackfillParams({})).toBeNull();
    expect(parseBackfillParams(null)).toBeNull();
    expect(parseBackfillParams({ countryCode: "x'; drop" })).toBeNull();
    expect(parseBackfillParams({ countryCode: 'ca', regionCode: 'on' })).toMatchObject({ countryCode: 'CA', regionCode: 'ON', limit: BACKFILL_DEFAULT_LIMIT });
    expect(parseBackfillParams({ countryCode: 'CA', limit: 9999 })?.limit).toBe(BACKFILL_MAX_LIMIT);
    expect(parseBackfillParams({ countryCode: 'CA', limit: 0 })?.limit).toBe(1);
  });
  it('the retry cutoff is seven days back', () => {
    expect(backfillRetryCutoff(Date.UTC(2026, 9, 31))).toBe('2026-10-24T00:00:00.000Z');
  });
});

describe('POST /api/admin/golf-sheet-backfill, from the source', () => {
  const route = fs.readFileSync(path.join(process.cwd(), 'src/app/api/admin/golf-sheet-backfill/route.ts'), 'utf8');
  it('is admin-only and returns thrown responses', () => {
    expect(route).toMatch(/await requireAdmin\(request\)/);
    expect(route).toMatch(/if \(error instanceof Response\) return error;/);
  });
  it('stops at the time budget and when the provider budget refuses', () => {
    expect(route).toContain('BACKFILL_WORK_BUDGET_MS');
    expect(route).toContain("outcome === 'budget_refused'");
  });
});
