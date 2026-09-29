import { describe, expect, it } from 'vitest';
import { FEATURE_FLAGS } from '@/lib/features';
import { STAT_SCHEMAS } from '@/lib/sports/stat-schemas';
import { BADGES, BADGE_SPORTS, badgeDef } from '../badges/catalog';
import { evaluateBadges, isVerifiedRow, type EvalInput, type EvalRow } from '../badges/evaluate';
import { badgeBellCopy } from '../badges-server';

const golfRow = (over: Partial<EvalRow> = {}): EvalRow => ({
  natural_key: 'golf_round:1', sport_key: 'golf', occurred_on: '2026-09-20', metrics: { gross: 101, holes: 18, to_par: 29 }, ...over,
});
const input = (over: Partial<EvalInput> = {}): EvalInput => ({
  rows: [golfRow()], resultCounts: { golf: 1 }, sportsPlayed: 1, handicapIndex: null, held: new Set(), ...over,
});
const keys = (i: EvalInput) => evaluateBadges(i).map(a => a.badgeKey).sort();

describe('the catalog', () => {
  it('keys are unique and match 244\'s CHECK', () => {
    const all = BADGES.map(b => b.key);
    expect(new Set(all).size).toBe(all.length);
    for (const k of all) expect(k).toMatch(/^[a-z0-9_]{1,40}\.[a-z0-9_]{1,60}$/);
  });
  it('every FEATURE sport has its pack (the per-sport list is kept in step)', () => {
    expect([...BADGE_SPORTS].sort()).toEqual([...FEATURE_FLAGS.FEATURE_SPORTS].sort());
    for (const s of FEATURE_FLAGS.FEATURE_SPORTS) {
      expect(badgeDef(`${s}.first_result`), s).toBeDefined();
      expect(badgeDef(`${s}.first_verified`), s).toBeDefined();
    }
  });
  it('every declared milestone becomes a badge, the sport\'s data the only input', () => {
    for (const schema of Object.values(STAT_SCHEMAS)) {
      for (const f of schema.fields) {
        for (const m of f.milestones ?? []) {
          const v = typeof m === 'number' ? m : m.value;
          expect(badgeDef(`${schema.sport_key}.${f.key}_${v}`), `${schema.sport_key}.${f.key}_${v}`).toBeDefined();
        }
      }
    }
    expect(badgeDef('basketball.points_30')?.label).toBe('30 Points');
    expect(badgeDef('ice_hockey.goals_3')?.label).toBe('Hat trick');
  });
  it('every milestone metric is a field of its sport (never a typo nobody can earn)', () => {
    for (const b of BADGES) {
      if (b.rule.kind !== 'metric' || b.sportKey === 'golf' || !b.sportKey) continue;
      const schema = STAT_SCHEMAS[b.sportKey as keyof typeof STAT_SCHEMAS];
      expect(schema?.fields.some(f => f.key === (b.rule as { metric: string }).metric), b.key).toBe(true);
    }
  });
});

describe('evaluateBadges', () => {
  it('a first round earns the first-result badge only', () => {
    expect(keys(input())).toEqual(['golf.first_result']);
  });
  it('golf thresholds: 18 holes only, every line crossed at once', () => {
    expect(keys(input({ rows: [golfRow({ metrics: { gross: 78, holes: 18 } })] }))).toEqual(['golf.break_100', 'golf.break_80', 'golf.break_90', 'golf.first_result']);
    expect(keys(input({ rows: [golfRow({ metrics: { gross: 38, holes: 9 } })] }))).toEqual(['golf.first_result']);
    expect(keys(input({ rows: [golfRow({ metrics: { gross: 70, holes: 18, to_par: -2 } })] }))).toContain('golf.under_par');
  });
  it('hole facts: birdies, eagles, an ace', () => {
    const k = keys(input({ rows: [golfRow({ metrics: { gross: 95, holes: 18, birdies: 3, eagles: 1, aces: 1 } })] }));
    expect(k).toEqual(expect.arrayContaining(['golf.first_birdie', 'golf.birdie_barrage', 'golf.first_eagle', 'golf.hole_in_one']));
  });
  it('held badges are never re-awarded', () => {
    expect(keys(input({ held: new Set(['golf.first_result']) }))).toEqual([]);
  });
  it('counts come from the whole record, not the batch', () => {
    expect(keys(input({ resultCounts: { golf: 10 }, held: new Set(['golf.first_result']) }))).toEqual(['golf.results_10']);
  });
  it('a handicap badge needs an index (the server passes one only when non-provisional)', () => {
    expect(keys(input({ handicapIndex: 9.4, held: new Set(['golf.first_result']) }))).toEqual(['golf.handicap_10', 'golf.handicap_20']);
    expect(keys(input({ handicapIndex: null, held: new Set(['golf.first_result']) }))).toEqual([]);
  });
  it('stat-line milestones and a win — the outcome, or a self-posted W', () => {
    const row: EvalRow = { natural_key: 'post:1', sport_key: 'basketball', occurred_on: '2026-09-20', metrics: { points: 31, rebounds: 4 }, outcome: 'win' };
    expect(keys(input({ rows: [row], resultCounts: { basketball: 1 } }))).toEqual(['basketball.first_result', 'basketball.first_win', 'basketball.points_20', 'basketball.points_30']);
    const selfPosted: EvalRow = { ...row, outcome: null, context: { result: 'W' }, metrics: { points: 2 } };
    expect(keys(input({ rows: [selfPosted], resultCounts: { basketball: 1 } }))).toEqual(['basketball.first_result', 'basketball.first_win']);
  });
  it('verified: an org-recorded row earns "On the record" and marks the award', () => {
    const row = golfRow({ provenance: 'club_recorded', metrics: { gross: 88, holes: 18 } });
    const awards = evaluateBadges(input({ rows: [row] }));
    expect(awards.map(a => a.badgeKey)).toContain('golf.first_verified');
    expect(awards.every(a => a.verified)).toBe(true);
    expect(isVerifiedRow({ provenance: 'self_reported' })).toBe(false);
  });
  it('a verified qualifying row is preferred as the source', () => {
    const plain = golfRow({ natural_key: 'golf_round:a', occurred_on: '2026-09-21', metrics: { gross: 79, holes: 18 } });
    const official = golfRow({ natural_key: 'golf_round:b', occurred_on: '2026-09-20', metrics: { gross: 78, holes: 18 }, provenance: 'league_verified' });
    const award = evaluateBadges(input({ rows: [plain, official], resultCounts: { golf: 2 } })).find(a => a.badgeKey === 'golf.break_80');
    expect(award).toMatchObject({ sourceKey: 'golf_round:b', verified: true, detail: { gross: 78 } });
  });
  it('two and three sports', () => {
    const k = keys(input({ sportsPlayed: 3, held: new Set(['golf.first_result']) }));
    expect(k).toEqual(['all.three_sports', 'all.two_sports']);
  });
  it('nothing written → nothing earned', () => {
    expect(evaluateBadges(input({ rows: [] }))).toEqual([]);
  });
});

describe('the bell copy', () => {
  it('one badge names it; several count them', () => {
    expect(badgeBellCopy(['golf.break_80'])).toEqual({ title: 'Badge earned: Broke 80', message: 'Shot 79 or better over 18 holes.' });
    expect(badgeBellCopy(['golf.break_80', 'golf.first_birdie'])).toEqual({ title: '2 badges earned', message: 'Broke 80 · First birdie' });
    expect(badgeBellCopy(['nope.unknown'])).toBeNull();
  });
});
