import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { FRESH_MASK, bumpMask, maskValue, retained, seenOn } from '../platform-stats/bitmap';

const mig = readFileSync(resolve(__dirname, '../../../database/migrations/267_platform_stats.sql'), 'utf8');
const twin = readFileSync(resolve(__dirname, '../../../database/migrations/267_platform_stats.indexes.sql'), 'utf8');

describe('the seen bitmap (267)', () => {
  it('a bump shifts by the gap and sets today; same or past day changes nothing', () => {
    expect(bumpMask(FRESH_MASK, 100, 100)).toEqual([0]);
    expect(bumpMask(FRESH_MASK, 100, 99)).toEqual([0]);
    expect(bumpMask(FRESH_MASK, 100, 101)).toEqual([0, 1]);
    expect(maskValue(bumpMask(FRESH_MASK, 100, 101))).toBe(3);
    expect(bumpMask([0, 1], 101, 104)).toEqual([0, 3, 4]);
    expect(maskValue(bumpMask([0, 1], 101, 104))).toBe(25);
    // The staging proof (Oct 19 2026): a 9-day gap → 513, the next day → 1027.
    expect(maskValue(bumpMask(FRESH_MASK, 0, 9))).toBe(513);
    expect(maskValue(bumpMask(bumpMask(FRESH_MASK, 0, 9), 9, 10))).toBe(1027);
  });
  it('63 days away keeps the oldest bit at the edge; 64 or more forgets everything (the Postgres shift cap)', () => {
    const m63 = bumpMask(FRESH_MASK, 0, 63);
    expect(seenOn(m63, 63, 0)).toBe(true);
    expect(seenOn(m63, 63, 63)).toBe(true);
    expect(bumpMask(FRESH_MASK, 0, 64)).toEqual([0]);
    expect(bumpMask([0, 1, 3], 0, 400)).toEqual([0]);
    expect(bumpMask([0, 60], 0, 5)).toEqual([0, 5]); // 60 + 5 passes the edge and is dropped
  });
  it('seenOn reads the right offset and refuses days outside the window', () => {
    const mask = bumpMask(bumpMask(FRESH_MASK, 10, 12), 12, 15); // seen on 10, 12, 15
    expect(seenOn(mask, 15, 15)).toBe(true);
    expect(seenOn(mask, 15, 14)).toBe(false);
    expect(seenOn(mask, 15, 12)).toBe(true);
    expect(seenOn(mask, 15, 10)).toBe(true);
    expect(seenOn(mask, 15, 11)).toBe(false);
    expect(seenOn(mask, 15, 16)).toBe(false);
    expect(seenOn(mask, 15, 15 - 64)).toBe(false);
  });
  it('strict Dn retention counts the cohort and those seen ON day C+n', () => {
    const rows = [
      { firstDay: 100, lastDay: 101, mask: bumpMask(FRESH_MASK, 100, 101) },   // back on D1
      { firstDay: 100, lastDay: 107, mask: bumpMask(FRESH_MASK, 100, 107) },   // back on D7, not D1
      { firstDay: 100, lastDay: 100, mask: FRESH_MASK },                        // never back
      { firstDay: 99, lastDay: 101, mask: bumpMask(FRESH_MASK, 99, 101) },     // another cohort
    ];
    expect(retained(rows, 100, 1)).toEqual({ size: 3, retained: 1 });
    expect(retained(rows, 100, 7)).toEqual({ size: 3, retained: 1 });
    expect(retained(rows, 100, 30)).toEqual({ size: 3, retained: 0 });
  });
});

describe('migration 267 keeps posture A and the shape the code relies on', () => {
  it('every table is RLS-on, revoked from anon/authenticated and granted to service_role', () => {
    for (const t of ['profile_seen', 'platform_stats_daily', 'platform_health_samples', 'platform_jobs']) {
      expect(mig).toContain(`ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`);
      expect(mig).toContain(`REVOKE ALL ON TABLE public.${t} FROM PUBLIC, anon, authenticated;`);
      expect(mig).toContain(`GRANT ALL ON TABLE public.${t} TO service_role;`);
    }
    expect(mig).not.toMatch(/CREATE POLICY/i);
  });
  it('every function is SECURITY DEFINER, revoked and granted to service_role only', () => {
    for (const f of ['bump_profile_seen(uuid, date)', 'platform_table_estimates()', 'platform_cron_runs()', 'platform_storage_by_bucket()', 'platform_rollup_day(date, text, boolean)']) {
      expect(mig).toContain(`REVOKE EXECUTE ON FUNCTION public.${f} FROM PUBLIC, anon, authenticated;`);
      expect(mig).toContain(`GRANT  EXECUTE ON FUNCTION public.${f} TO service_role;`);
    }
    expect((mig.match(/SECURITY DEFINER/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
  it('first_day is the signup day: the trigger and the seed are both there, and the shift is capped', () => {
    expect(mig).toContain('CREATE TRIGGER profile_seen_on_insert AFTER INSERT ON public.profiles');
    expect(mig).toMatch(/INSERT INTO public\.profile_seen \(profile_id, first_day, last_day, days_mask\)\s+SELECT id/);
    expect(mig).toContain('WHEN EXCLUDED.last_day - s.last_day >= 64 THEN 1::bigint');
    expect(mig).toContain('WHERE s.last_day < EXCLUDED.last_day');
    expect(mig).toContain('s.last_day - p_day <= 63');
  });
  it('the rollup writes by delete-then-insert per group, never an upsert, and refuses the future', () => {
    expect(mig).toContain('DELETE FROM platform_stats_daily d WHERE d.day = p_day AND d.metric = ANY (v_keys);');
    expect(mig).not.toMatch(/platform_stats_daily[^;]*ON CONFLICT/);
    expect(mig).toContain("RAISE EXCEPTION 'platform_rollup_day: % is in the future', p_day");
  });
  it('the CONCURRENTLY twin carries the four indexes the day ranges need, one statement each', () => {
    for (const t of ['activities', 'workout_sessions', 'tickets', 'organizations']) {
      expect(twin).toContain(`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_${t}_created_at ON public.${t} (created_at);`);
    }
    expect(twin).not.toMatch(/BEGIN|COMMIT/);
  });
});

describe('the jobs registry helper', () => {
  it('a phased summary is ok unless a phase says ok:false; a string summary is cut', async () => {
    const { defaultOk, trim } = await import('../platform-jobs/record');
    expect(defaultOk({ a: { ok: true }, b: { skipped: 'flag off' } })).toBe(true);
    expect(defaultOk({ a: { ok: true }, b: { ok: false } })).toBe(false);
    expect(defaultOk({ ok: false })).toBe(false);
    expect(defaultOk(undefined)).toBe(true);
    expect((trim({ s: 'x'.repeat(300), arr: new Array(50).fill(1) }) as { s: string; arr: unknown[] }).s.length).toBe(201);
    expect((trim({ arr: new Array(50).fill(1) }) as { arr: unknown[] }).arr.length).toBe(20);
  });
});
