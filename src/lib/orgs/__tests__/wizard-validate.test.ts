import { describe, expect, it } from 'vitest';
import {
  CapabilitiesSchema,
  ClubRequestWizardSchema,
  ConnectionsDraftSchema,
  LeagueRequestWizardSchema,
  SiteDraftSchema,
  StructureDraftSchema,
  normalizeWebsiteInput,
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

// Phase 7 C2 — the golf fast path's site draft.
describe('SiteDraftSchema', () => {
  it('every field optional; the golf shape round-trips', () => {
    expect(SiteDraftSchema.safeParse({}).success).toBe(true);
    const parsed = SiteDraftSchema.safeParse({
      sports: ['golf'],
      homeCourseId: UUID,
      contact: { website: 'https://eaglecreek.example', phone: '613-555-0100' },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({
        sports: ['golf'],
        homeCourseId: UUID,
        contact: { website: 'https://eaglecreek.example', phone: '613-555-0100' },
      });
    }
  });

  it('rejects a non-https website, a non-uuid course and more than 12 sports', () => {
    expect(SiteDraftSchema.safeParse({ contact: { website: 'http://eaglecreek.example' } }).success).toBe(false);
    expect(SiteDraftSchema.safeParse({ contact: { website: 'eaglecreek.example' } }).success).toBe(false);
    expect(SiteDraftSchema.safeParse({ homeCourseId: 'course-1' }).success).toBe(false);
    expect(SiteDraftSchema.safeParse({ sports: Array(13).fill('golf') }).success).toBe(false);
    expect(SiteDraftSchema.safeParse({ contact: { phone: '12' } }).success).toBe(false);
  });

  it('rides the widened request schemas (still optional — the pre-C2 payload parses)', () => {
    expect(ClubRequestWizardSchema.safeParse({ name: 'Eagle Creek' }).success).toBe(true);
    const club = ClubRequestWizardSchema.safeParse({ name: 'Eagle Creek', siteDraft: { sports: ['golf'] } });
    expect(club.success && club.data.siteDraft?.sports).toEqual(['golf']);
    const league = LeagueRequestWizardSchema.safeParse({
      name: 'Thursday Nine',
      sportKey: 'golf',
      siteDraft: { contact: { website: 'https://nine.example' } },
    });
    expect(league.success && league.data.siteDraft?.contact?.website).toBe('https://nine.example');
  });
});

describe('normalizeWebsiteInput', () => {
  it("'' omits, a bare host gets https, http upgrades, junk is null", () => {
    expect(normalizeWebsiteInput('   ')).toBeUndefined();
    expect(normalizeWebsiteInput('eaglecreek.example')).toBe('https://eaglecreek.example');
    expect(normalizeWebsiteInput(' http://eaglecreek.example/about ')).toBe('https://eaglecreek.example/about');
    expect(normalizeWebsiteInput('https://eaglecreek.example')).toBe('https://eaglecreek.example');
    expect(normalizeWebsiteInput('not a url')).toBeNull();
    expect(normalizeWebsiteInput('ftp://eaglecreek.example')).toBeNull();
  });
});
