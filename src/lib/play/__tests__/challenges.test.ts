import { describe, expect, it } from 'vitest';
import { FEATURE_FLAGS } from '@/lib/features';
import { STAT_SCHEMAS } from '@/lib/sports/stat-schemas';
import { LOWER_IS_BETTER, challengeLine, challengeMetrics, expiredStatus, nextStatus, qualifies, validateChallenge, type ChallengeTerms } from '../challenges';

const ME = 'a0000000-0000-4000-8000-000000000001';
const YOU = 'b0000000-0000-4000-8000-000000000002';
const COURSE = 'c0000000-0000-4000-8000-000000000003';

describe('the vocabulary — every sport by its own data', () => {
  it('every FEATURE sport has metrics to challenge on', () => {
    for (const s of FEATURE_FLAGS.FEATURE_SPORTS) expect(challengeMetrics(s).length, s).toBeGreaterThan(0);
  });
  it('the lower-is-better list names real fields only (never a typo that flips a challenge)', () => {
    const fields = new Set(Object.values(STAT_SCHEMAS).flatMap(s => s.fields.map(f => f.key)));
    for (const k of LOWER_IS_BETTER) expect(fields.has(k), k).toBe(true);
  });
  it('directions: golf strokes lower, points higher, goals against lower, a race time lower', () => {
    expect(challengeMetrics('golf').find(m => m.key === 'gross')?.direction).toBe('lower');
    expect(challengeMetrics('basketball').find(m => m.key === 'points')?.direction).toBe('higher');
    expect(challengeMetrics('ice_hockey').find(m => m.key === 'goals_against')?.direction).toBe('lower');
    expect(challengeMetrics('track_field').find(m => m.key.startsWith('time_'))?.direction).toBe('lower');
  });
});

describe('validateChallenge', () => {
  const base = { challengeeId: YOU, sportKey: 'golf', metric: 'gross', target: 78, days: 30 };
  it('a golf score defaults to 18 holes and a window from today', () => {
    const r = validateChallenge(base, ME, '2026-09-28');
    expect(r).toMatchObject({ ok: true, value: { direction: 'lower', min_holes: 18, starts_on: '2026-09-28', ends_on: '2026-10-28', course_id: null } });
  });
  it('refuses: yourself, an unknown metric, a fraction of a stroke, a negative, a bad window, a course off golf', () => {
    expect(validateChallenge({ ...base, challengeeId: ME }, ME, '2026-09-28').ok).toBe(false);
    expect(validateChallenge({ ...base, metric: 'vibes' }, ME, '2026-09-28').ok).toBe(false);
    expect(validateChallenge({ ...base, target: 77.5 }, ME, '2026-09-28').ok).toBe(false);
    expect(validateChallenge({ ...base, target: -3 }, ME, '2026-09-28').ok).toBe(false);
    expect(validateChallenge({ ...base, metric: 'to_par', target: -3 }, ME, '2026-09-28').ok).toBe(true);
    expect(validateChallenge({ ...base, days: 0 }, ME, '2026-09-28').ok).toBe(false);
    expect(validateChallenge({ ...base, days: 91 }, ME, '2026-09-28').ok).toBe(false);
    expect(validateChallenge({ ...base, sportKey: 'basketball', metric: 'points', target: 20, courseId: COURSE }, ME, '2026-09-28').ok).toBe(false);
    expect(validateChallenge({ ...base, message: 'x'.repeat(141) }, ME, '2026-09-28').ok).toBe(false);
  });
  it('a stat-line sport: no holes, no course', () => {
    expect(validateChallenge({ challengeeId: YOU, sportKey: 'basketball', metric: 'points', target: 20, days: 14 }, ME, '2026-09-28')).toMatchObject({ ok: true, value: { direction: 'higher', min_holes: null, course_id: null } });
  });
});

describe('qualifies', () => {
  const golf: ChallengeTerms = { sport_key: 'golf', metric: 'gross', direction: 'lower', target: 78, course_id: COURSE, min_holes: 18, starts_on: '2026-09-28', ends_on: '2026-10-28' };
  const row = (over: Record<string, unknown> = {}) => ({ sport_key: 'golf', occurred_on: '2026-10-01', metrics: { gross: 77, holes: 18 }, context: { course_id: COURSE }, ...over });
  it('beating is strictly under; the course and the holes must match; inside the window', () => {
    expect(qualifies(golf, row())).toBe(true);
    expect(qualifies(golf, row({ metrics: { gross: 78, holes: 18 } }))).toBe(false);
    expect(qualifies(golf, row({ context: { course_id: 'elsewhere' } }))).toBe(false);
    expect(qualifies(golf, row({ metrics: { gross: 38, holes: 9 } }))).toBe(false);
    expect(qualifies(golf, row({ occurred_on: '2026-09-27' }))).toBe(false);
    expect(qualifies(golf, row({ occurred_on: '2026-10-28' }))).toBe(true);
    expect(qualifies(golf, row({ sport_key: 'basketball' }))).toBe(false);
  });
  it('reaching is at-or-over', () => {
    const pts: ChallengeTerms = { sport_key: 'basketball', metric: 'points', direction: 'higher', target: 20, course_id: null, min_holes: null, starts_on: '2026-09-28', ends_on: '2026-10-12' };
    expect(qualifies(pts, { sport_key: 'basketball', occurred_on: '2026-10-01', metrics: { points: 20 } })).toBe(true);
    expect(qualifies(pts, { sport_key: 'basketball', occurred_on: '2026-10-01', metrics: { points: 19 } })).toBe(false);
    expect(qualifies(pts, { sport_key: 'basketball', occurred_on: '2026-10-01', metrics: { rebounds: 30 } })).toBe(false);
  });
});

describe('the status machine', () => {
  it('the challengee answers a pending one; the challenger calls off an open one', () => {
    expect(nextStatus('pending', 'accept', 'challengee')).toBe('accepted');
    expect(nextStatus('pending', 'decline', 'challengee')).toBe('declined');
    expect(nextStatus('pending', 'accept', 'challenger')).toBeNull();
    expect(nextStatus('accepted', 'accept', 'challengee')).toBeNull();
    expect(nextStatus('accepted', 'cancel', 'challenger')).toBe('cancelled');
    expect(nextStatus('pending', 'cancel', 'challengee')).toBeNull();
    expect(nextStatus('won', 'cancel', 'challenger')).toBeNull();
  });
  it('past the window: pending expires, accepted is lost, a final one stays', () => {
    expect(expiredStatus('pending', '2026-10-01', '2026-10-02')).toBe('expired');
    expect(expiredStatus('accepted', '2026-10-01', '2026-10-02')).toBe('lost');
    expect(expiredStatus('accepted', '2026-10-02', '2026-10-02')).toBeNull();
    expect(expiredStatus('won', '2026-10-01', '2026-10-02')).toBeNull();
  });
});

describe('the challenge in words', () => {
  it('golf and a stat sport', () => {
    expect(challengeLine({ sport_key: 'golf', metric: 'gross', direction: 'lower', target: 78, course_id: COURSE, min_holes: 18, starts_on: '2026-09-28', ends_on: '2026-10-28', courseName: 'Eagle Creek' })).toBe('Shoot under 78 (18 holes) at Eagle Creek by Oct 28');
    expect(challengeLine({ sport_key: 'basketball', metric: 'points', direction: 'higher', target: 20, course_id: null, min_holes: null, starts_on: '2026-09-28', ends_on: '2026-10-12' })).toBe('20+ points by Oct 12');
    expect(challengeLine({ sport_key: 'ice_hockey', metric: 'goals_against', direction: 'lower', target: 2, course_id: null, min_holes: null, starts_on: '2026-09-28', ends_on: '2026-10-12' })).toBe('Get goals against under 2 by Oct 12');
  });
});
