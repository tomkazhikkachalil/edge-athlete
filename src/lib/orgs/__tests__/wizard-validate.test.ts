import { describe, expect, it } from 'vitest';
import {
  CapabilitiesSchema,
  ClubRequestWizardSchema,
  ConnectionsDraftSchema,
  LeagueRequestWizardSchema,
  StructureDraftSchema,
} from '../wizard-validate';

const UUID = '00000000-0000-4000-8000-000000000001';

describe('CapabilitiesSchema', () => {
  it('requires at least one capability', () => {
    expect(CapabilitiesSchema.safeParse({ operatesCompetitions: false, operatesTeams: false }).success).toBe(false);
    expect(CapabilitiesSchema.safeParse({ operatesCompetitions: true, operatesTeams: false }).success).toBe(true);
  });
});

describe('StructureDraftSchema', () => {
  it('caps divisions at 60 and teams at 50', () => {
    const division = { sportKey: 'ice_hockey', name: 'U13 A' };
    expect(
      StructureDraftSchema.safeParse({ divisions: Array(60).fill(division), teams: [] }).success
    ).toBe(true);
    expect(
      StructureDraftSchema.safeParse({ divisions: Array(61).fill(division), teams: [] }).success
    ).toBe(false);
    expect(
      StructureDraftSchema.safeParse({ divisions: [], teams: Array(51).fill('Blazers') }).success
    ).toBe(false);
  });
});

describe('ConnectionsDraftSchema', () => {
  it('caps both lists at 10; stub email normalized; sportKey optional', () => {
    const ok = ConnectionsDraftSchema.safeParse({
      existing: [{ id: UUID, name: 'Eagle Creek' }],
      stubs: [{ name: 'HEO District 11', email: '  Ops@HEO.ca ', sportKey: 'ice_hockey' }],
    });
    expect(ok.success).toBe(true);
    if (ok.success) expect(ok.data.stubs[0].email).toBe('ops@heo.ca');
    expect(
      ConnectionsDraftSchema.safeParse({
        existing: Array(11).fill({ id: UUID, name: 'x' }),
        stubs: [],
      }).success
    ).toBe(false);
  });
});

describe('widened request schemas', () => {
  it('BACK-COMPAT: the pre-wizard minimal payload still parses', () => {
    expect(
      LeagueRequestWizardSchema.safeParse({ name: 'Spring League', sportKey: 'golf' }).success
    ).toBe(true);
    expect(ClubRequestWizardSchema.safeParse({ name: 'Eagle Creek' }).success).toBe(true);
  });

  it('carries the full wizard payload and strips unknown keys', () => {
    const parsed = LeagueRequestWizardSchema.safeParse({
      name: 'Spring League',
      sportKey: 'ice_hockey',
      capabilities: { operatesCompetitions: true, operatesTeams: true },
      structure: { seasonLabel: '2026–27 Season', divisions: [{ sportKey: 'x', name: 'U13 A' }], teams: ['Blazers'] },
      connections: { existing: [], stubs: [{ name: 'Some Club' }] },
      ownerProfileId: UUID, // stripped by the base schema's omit
      evil: 'dropped',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect('ownerProfileId' in parsed.data).toBe(false);
      expect('evil' in parsed.data).toBe(false);
      expect(parsed.data.structure?.divisions).toHaveLength(1);
    }
  });
});
