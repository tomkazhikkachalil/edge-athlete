import { describe, it, expect, vi, afterEach } from 'vitest';
import { readParEvidence, recordParEvidence } from '../par-evidence-server';
import type { ParEvidenceRow } from '../par-evidence';

// The one writer of golf_par_evidence (migration 317).
afterEach(() => vi.restoreAllMocks());

function fake(over: { upsertError?: { code?: string; message: string }; throws?: boolean; rows?: unknown[]; readError?: boolean } = {}) {
  const calls: string[] = [];
  let written: Array<Record<string, unknown>> = [];
  let conflict = '';
  const admin = {
    from: (table: string) => ({
      upsert: async (rows: Array<Record<string, unknown>>, opts: { onConflict: string }) => {
        if (over.throws) throw new Error('network');
        calls.push(`upsert:${table}`);
        written = rows;
        conflict = opts.onConflict;
        return { error: over.upsertError ?? null };
      },
      delete: () => ({ eq: (c1: string, v1: string) => ({ eq: (c2: string, v2: string) => ({ lt: async (c3: string) => { calls.push(`delete:${c1}=${v1},${c2}=${v2},${c3}<stamp`); return { error: null }; } }) }) }),
      select: () => ({ eq: async () => (over.readError ? { data: null, error: { message: 'x' } } : { data: over.rows ?? [], error: null }) }),
    }),
  };
  return { admin: admin as never, calls, written: () => written, conflict: () => conflict };
}
const box = (label: string, pars: Array<number | null>, votes = true): ParEvidenceRow => ({ source: 'golfcourseapi', label, votes, pars });

describe('recordParEvidence', () => {
  it('upserts one source\'s rows on (course, source, label), then drops that source\'s older rows only', async () => {
    const f = fake();
    expect(await recordParEvidence(f.admin, 'c1', [box('blue', [4, 3]), box('red', [4, null], false)])).toBe(true);
    expect(f.conflict()).toBe('course_id,source,label');
    expect(f.written().map(r => [r.course_id, r.source, r.label, r.votes, r.pars])).toEqual([['c1', 'golfcourseapi', 'blue', true, [4, 3]], ['c1', 'golfcourseapi', 'red', false, [4, null]]]);
    expect(new Set(f.written().map(r => r.observed_at)).size).toBe(1);
    expect(f.calls).toEqual(['upsert:golf_par_evidence', 'delete:course_id=c1,source=golfcourseapi,observed_at<stamp']);
  });

  it('nothing to record, or two sources in one call: nothing is written', async () => {
    const f = fake();
    expect(await recordParEvidence(f.admin, 'c1', [])).toBe(false);
    expect(await recordParEvidence(f.admin, 'c1', [box('blue', [4]), { source: 'website', label: '', votes: false, pars: [4] }])).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it('never throws: a write error or a thrown call answers false, and a missing table is quiet', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await recordParEvidence(fake({ upsertError: { code: '42P01', message: 'no table' } }).admin, 'c1', [box('blue', [4])])).toBe(false);
    expect(error).not.toHaveBeenCalled();
    expect(await recordParEvidence(fake({ upsertError: { message: 'boom' } }).admin, 'c1', [box('blue', [4])])).toBe(false);
    expect(await recordParEvidence(fake({ throws: true }).admin, 'c1', [box('blue', [4])])).toBe(false);
    expect(error).toHaveBeenCalledTimes(2);
  });
});

describe('readParEvidence', () => {
  it('returns the rows; an error or no rows is an empty list', async () => {
    expect(await readParEvidence(fake({ rows: [{ source: 'website', label: '', votes: false, pars: [4, 5] }] }).admin, 'c1')).toEqual([{ source: 'website', label: '', votes: false, pars: [4, 5] }]);
    expect(await readParEvidence(fake({ readError: true }).admin, 'c1')).toEqual([]);
  });
});
