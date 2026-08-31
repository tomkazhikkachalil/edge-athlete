import { describe, expect, it } from 'vitest';
import {
  DivisionCreateSchema,
  EntryCreateSchema,
  SeasonCreateSchema,
  TeamCreateSchema,
  TeamPatchSchema,
} from '../validate';

const ID = '2f1b46c8-2964-4139-9689-d1c3f736ed93';

describe('SeasonCreateSchema', () => {
  it('accepts a minimal season and trims the label', () => {
    const parsed = SeasonCreateSchema.parse({ side: 'league', orgId: ID, label: '  2026-27  ' });
    expect(parsed.label).toBe('2026-27');
  });

  it('enforces date shape and order', () => {
    expect(
      SeasonCreateSchema.safeParse({
        side: 'club', orgId: ID, label: 'Summer', startsOn: '2026-05-01', endsOn: '2026-10-15',
      }).success
    ).toBe(true);
    expect(
      SeasonCreateSchema.safeParse({
        side: 'club', orgId: ID, label: 'Bad', startsOn: '2026-10-01', endsOn: '2026-05-01',
      }).success
    ).toBe(false);
    expect(
      SeasonCreateSchema.safeParse({ side: 'club', orgId: ID, label: 'Bad', startsOn: 'May 1' }).success
    ).toBe(false);
    expect(SeasonCreateSchema.safeParse({ side: 'org', orgId: ID, label: 'X' }).success).toBe(false);
  });
});

describe('DivisionCreateSchema', () => {
  it('requires season, sport and name; bounds the optionals', () => {
    expect(
      DivisionCreateSchema.safeParse({ seasonId: ID, sportKey: 'ice_hockey', name: 'U13 A' }).success
    ).toBe(true);
    expect(
      DivisionCreateSchema.safeParse({
        seasonId: ID, sportKey: 'ice_hockey', name: 'U13 A',
        ageBand: 'U13', genderStream: 'Boys', tier: 'A', capacityEstimate: 120,
      }).success
    ).toBe(true);
    expect(DivisionCreateSchema.safeParse({ seasonId: ID, sportKey: '', name: 'X' }).success).toBe(false);
    expect(
      DivisionCreateSchema.safeParse({ seasonId: ID, sportKey: 'golf', name: 'X', capacityEstimate: 0 }).success
    ).toBe(false);
    expect(
      DivisionCreateSchema.safeParse({ seasonId: ID, sportKey: 'golf', name: 'X', capacityEstimate: 10001 }).success
    ).toBe(false);
  });
});

describe('team + entry schemas', () => {
  it('team create/patch and the entry PAIR', () => {
    expect(TeamCreateSchema.safeParse({ side: 'league', orgId: ID, name: 'Blazers U13 A' }).success).toBe(true);
    expect(TeamCreateSchema.safeParse({ side: 'league', orgId: ID, name: '' }).success).toBe(false);
    expect(TeamPatchSchema.safeParse({ id: ID, status: 'archived' }).success).toBe(true);
    expect(TeamPatchSchema.safeParse({ id: ID, status: 'deleted' }).success).toBe(false);
    const entry = EntryCreateSchema.parse({ teamId: ID, divisionId: ID });
    expect(entry).toEqual({ teamId: ID, divisionId: ID });
    expect(EntryCreateSchema.safeParse({ teamId: ID }).success).toBe(false);
  });
});
