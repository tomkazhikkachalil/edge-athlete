import { describe, expect, it } from 'vitest';
import { FIXTURE_RULES, LEADERBOARD_RULES, resolveFixtureRule, resolveLeaderboardRule } from '@/lib/competitions/scoring';
import { STAT_SCHEMAS, TRACK_EVENTS } from '../stat-schemas';
import { COMPETITION_FORMATS, DEFAULT_PROFILE, defaultEntrantFor, defaultRuleFor, formatEntrantRefusal, PROFILED_SPORTS, resolveCompetitionProfile } from '../competition-profiles';

describe('competition profiles — one owner for format × entrant × rule per sport', () => {
  it('every rule key a profile names exists in the scoring registries', () => {
    for (const sport of [...PROFILED_SPORTS, 'default']) {
      const p = sport === 'default' ? DEFAULT_PROFILE : resolveCompetitionProfile(sport);
      for (const format of COMPETITION_FORMATS) {
        const f = p.formats[format];
        if (!f) continue;
        const registry = format === 'fixture' ? FIXTURE_RULES : format === 'leaderboard' ? LEADERBOARD_RULES : null;
        if (registry) {
          if (f.defaultRule) expect(registry[f.defaultRule], `${sport}.${format} default ${f.defaultRule}`).toBeTruthy();
          for (const r of f.rules) expect(registry[r], `${sport}.${format} rule ${r}`).toBeTruthy();
          if (f.defaultRule) expect(f.rules, `${sport}.${format} offers its default`).toContain(f.defaultRule);
        } else {
          expect(f.defaultRule).toBeNull();
        }
        expect(f.entrants.length).toBeGreaterThan(0);
      }
    }
  });
  it('the team-score stat is a real stat-schema key; the meet vocabulary is TRACK_EVENTS', () => {
    for (const sport of PROFILED_SPORTS) {
      const p = resolveCompetitionProfile(sport);
      if (p.teamScoreStat) expect(STAT_SCHEMAS[sport as keyof typeof STAT_SCHEMAS]?.fields.map(f => f.key), `${sport} teamScoreStat`).toContain(p.teamScoreStat);
    }
    expect(resolveCompetitionProfile('track_field').meetEvents?.map(e => e.key)).toEqual(TRACK_EVENTS.map(e => e.key));
    expect(resolveCompetitionProfile('track_field').defaultMeetPoints).toEqual([10, 8, 6, 5, 4, 3, 2, 1]);
  });
  it('the scoring defaults read the profile — yesterday\'s answers exactly', () => {
    expect(resolveFixtureRule('soccer', null)).toBe(FIXTURE_RULES.points_3_1_0);
    expect(resolveFixtureRule('ice_hockey', null)).toBe(FIXTURE_RULES.points_2_1_0);
    expect(resolveFixtureRule('curling', null)).toBe(FIXTURE_RULES.points_2_1_0);
    expect(resolveFixtureRule('soccer', 'points_2_1_0')).toBe(FIXTURE_RULES.points_2_1_0);
    expect(resolveLeaderboardRule('golf', null)).toBe(LEADERBOARD_RULES.stroke_total);
    expect(resolveLeaderboardRule('tennis', null)).toBe(LEADERBOARD_RULES.points_total);
  });
  it('the entrant kind: the format\'s first by default; a named kind must be on offer; a missing format is refused by name', () => {
    const hockey = resolveCompetitionProfile('ice_hockey');
    expect(defaultEntrantFor(hockey, 'fixture')).toBe('team');
    expect(defaultEntrantFor(hockey, 'leaderboard')).toBeNull();
    expect(formatEntrantRefusal(hockey, 'fixture', null)).toBeNull();
    expect(formatEntrantRefusal(hockey, 'fixture', 'team')).toBeNull();
    expect(formatEntrantRefusal(hockey, 'fixture', 'athlete')).toBe('entrant_unsupported');
    expect(formatEntrantRefusal(hockey, 'leaderboard', null)).toBe('format_unsupported');
    const golf = resolveCompetitionProfile('golf');
    expect(defaultEntrantFor(golf, 'leaderboard')).toBe('athlete');
    expect(defaultRuleFor(golf, 'leaderboard')).toBe('stroke_total');
    expect(defaultRuleFor(golf, 'bracket')).toBeNull();
    // An unprofiled sport keeps the v1 pairs.
    expect(defaultEntrantFor(resolveCompetitionProfile('tennis'), 'fixture')).toBe('team');
    expect(defaultEntrantFor(resolveCompetitionProfile('tennis'), 'leaderboard')).toBe('athlete');
    expect(resolveCompetitionProfile('tennis').validateResultPayload('fixture', { score: 1 })).toEqual({ ok: true });
    expect(resolveCompetitionProfile('tennis').validateResultPayload('fixture', 'x')).toMatchObject({ ok: false });
  });
});
