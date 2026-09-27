import { describe, expect, it } from 'vitest';
import {
  DivisionCreateSchema,
  EntryCreateSchema,
  SeasonCreateSchema,
  TeamCreateSchema,
  TeamPatchSchema,
  DivisionPatchSchema,
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

describe('TeamPatchSchema — the team identity (teams & divisions PR 6)', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  it('takes a rename, a shown name, a sport and colours (lower-cased)', () => {
    const r = TeamPatchSchema.safeParse({ id, name: 'Comets', displayName: 'The Comets', sportKey: 'ice_hockey', primaryColor: '#7C3AED', secondaryColor: '#FFFFFF' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).toMatchObject({ primaryColor: '#7c3aed', secondaryColor: '#ffffff', displayName: 'The Comets' });
  });
  it('an empty shown name clears it; null clears a colour or the sport', () => {
    const r = TeamPatchSchema.safeParse({ id, displayName: '  ', primaryColor: null, sportKey: null });
    expect(r.success && r.data).toMatchObject({ displayName: null, primaryColor: null, sportKey: null });
  });
  it('refuses a colour that is not #rrggbb, and a PATCH that changes nothing', () => {
    expect(TeamPatchSchema.safeParse({ id, primaryColor: 'purple' }).success).toBe(false);
    expect(TeamPatchSchema.safeParse({ id, primaryColor: '#abc' }).success).toBe(false);
    expect(TeamPatchSchema.safeParse({ id }).success).toBe(false);
  });
  it('status alone still archives / restores (today’s console)', () => {
    expect(TeamPatchSchema.safeParse({ id, status: 'archived' }).success).toBe(true);
  });
});

describe('DivisionPatchSchema (teams & divisions PR 9)', () => {
  const id = '22222222-2222-4222-8222-222222222222';
  it('takes a rename and the optional fields; an empty one clears', () => {
    const r = DivisionPatchSchema.safeParse({ id, name: 'U13 A', ageBand: ' ', tier: 'AA', capacityEstimate: 8 });
    expect(r.success && r.data).toMatchObject({ name: 'U13 A', ageBand: null, tier: 'AA', capacityEstimate: 8 });
  });
  it('refuses nothing to change, a bad capacity, and never takes a sport or a season', () => {
    expect(DivisionPatchSchema.safeParse({ id }).success).toBe(false);
    expect(DivisionPatchSchema.safeParse({ id, capacityEstimate: 0 }).success).toBe(false);
    const r = DivisionPatchSchema.safeParse({ id, name: 'X', sportKey: 'golf', seasonId: id });
    expect(r.success && 'sportKey' in r.data).toBe(false);
  });
});
