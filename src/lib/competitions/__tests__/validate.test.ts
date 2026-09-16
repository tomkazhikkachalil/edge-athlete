import { describe, expect, it } from 'vitest';
import {
  CompetitionCreateSchema,
  CompetitionPatchSchema,
  EntryAddSchema,
  GolfSeasonGenerateSchema,
} from '../validate';

describe('CompetitionCreateSchema', () => {
  const base = {
    side: 'league',
    orgId: '00000000-0000-4000-8000-000000000001',
    seasonId: '00000000-0000-4000-8000-000000000002',
    sportKey: 'ice_hockey',
    name: 'House League',
    format: 'fixture',
  };

  it('accepts the minimal create and defaults visibility PRIVATE', () => {
    const parsed = CompetitionCreateSchema.parse(base);
    expect(parsed.visibility).toBe('private');
    expect(parsed.divisionId).toBeUndefined();
  });

  it('the live gate: meet is rejected HERE, not by the DB; bracket is live since track 2 PR 3', () => {
    expect(CompetitionCreateSchema.safeParse({ ...base, format: 'bracket' }).success).toBe(true);
    expect(CompetitionCreateSchema.safeParse({ ...base, format: 'meet' }).success).toBe(false);
    expect(CompetitionCreateSchema.safeParse({ ...base, format: 'leaderboard' }).success).toBe(true);
  });

  it('strips client-sent entrant_type; the camelCase entrantType is an optional named kind (the profile decides in the server lib)', () => {
    const parsed = CompetitionCreateSchema.parse({ ...base, entrant_type: 'athlete' });
    expect('entrant_type' in parsed).toBe(false);
    expect(CompetitionCreateSchema.parse({ ...base, entrantType: 'ad_hoc_team' }).entrantType).toBe('ad_hoc_team');
    expect(CompetitionCreateSchema.safeParse({ ...base, entrantType: 'club' }).success).toBe(false);
  });
});

describe('CompetitionPatchSchema', () => {
  it('requires at least one change', () => {
    expect(
      CompetitionPatchSchema.safeParse({ id: '00000000-0000-4000-8000-000000000001' }).success
    ).toBe(false);
    expect(
      CompetitionPatchSchema.safeParse({
        id: '00000000-0000-4000-8000-000000000001',
        visibility: 'public',
      }).success
    ).toBe(true);
  });
});

describe('EntryAddSchema', () => {
  const competitionId = '00000000-0000-4000-8000-000000000001';
  const ref = '00000000-0000-4000-8000-000000000002';

  it('exactly one of teamId / profileId', () => {
    expect(EntryAddSchema.safeParse({ competitionId }).success).toBe(false);
    expect(EntryAddSchema.safeParse({ competitionId, teamId: ref, profileId: ref }).success).toBe(false);
    expect(EntryAddSchema.safeParse({ competitionId, teamId: ref }).success).toBe(true);
    expect(EntryAddSchema.safeParse({ competitionId, profileId: ref }).success).toBe(true);
    // Track 2 PR 6: an ad-hoc entry is a name (+ members); members without a name are refused.
    expect(EntryAddSchema.safeParse({ competitionId, name: 'Reds', memberProfileIds: [ref] }).success).toBe(true);
    expect(EntryAddSchema.safeParse({ competitionId, name: 'Reds', teamId: ref }).success).toBe(false);
    expect(EntryAddSchema.safeParse({ competitionId, teamId: ref, memberProfileIds: [ref] }).success).toBe(false);
  });
});

describe('GolfSeasonGenerateSchema (phase 6d W3)', () => {
  const base = {
    competitionId: '00000000-0000-4000-8000-000000000001',
    venueId: '00000000-0000-4000-8000-000000000002',
    startDate: '2026-09-01',
    weeks: 20,
    windowDays: 7,
    holes: 9,
  };
  it('accepts a season and defaults to a dry run', () => {
    const parsed = GolfSeasonGenerateSchema.safeParse(base);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.dryRun).toBe(true);
  });
  it('bounds weeks 1..52, window 1..14, holes 9|18, a real date; the course is optional since R4 (any-course leagues)', () => {
    expect(GolfSeasonGenerateSchema.safeParse({ ...base, weeks: 0 }).success).toBe(false);
    expect(GolfSeasonGenerateSchema.safeParse({ ...base, weeks: 53 }).success).toBe(false);
    expect(GolfSeasonGenerateSchema.safeParse({ ...base, windowDays: 15 }).success).toBe(false);
    expect(GolfSeasonGenerateSchema.safeParse({ ...base, holes: 12 }).success).toBe(false);
    expect(GolfSeasonGenerateSchema.safeParse({ ...base, startDate: '9/1/2026' }).success).toBe(false);
    const { venueId: _venueId, ...noVenue } = base;
    void _venueId;
    expect(GolfSeasonGenerateSchema.safeParse(noVenue).success).toBe(true);
    expect(GolfSeasonGenerateSchema.safeParse({ ...base, venueId: null }).success).toBe(true);
  });
  it('the label pattern is bounded so "{n}" always fits the 40-char round column', () => {
    expect(GolfSeasonGenerateSchema.safeParse({ ...base, labelPattern: 'Round {n}' }).success).toBe(true);
    expect(GolfSeasonGenerateSchema.safeParse({ ...base, labelPattern: 'x'.repeat(35) }).success).toBe(false);
  });
});
