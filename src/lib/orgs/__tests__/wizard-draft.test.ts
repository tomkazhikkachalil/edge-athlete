import { describe, expect, it } from 'vitest';
import { parseOrgWizardDraft, WIZARD_DRAFT_TTL_MS, type OrgWizardDraft } from '../wizard-draft';

const NOW = 1_760_000_000_000;

const full = (over: Partial<OrgWizardDraft> = {}) =>
  JSON.stringify({
    v: 1,
    savedAt: NOW - 1000,
    step: 'structure',
    name: 'Kanata Minor Hockey',
    description: '',
    placeLabel: 'Kanata, ON',
    place: { placeId: 'x' },
    capabilities: { operatesCompetitions: true, operatesTeams: true },
    sportKey: 'ice_hockey',
    seasonLabel: '2026–27 Season',
    divisions: [{ sportKey: 'ice_hockey', name: 'U13 A' }],
    teams: ['Blazers'],
    connectionsExisting: [{ id: 'u', name: 'Eagle Creek' }],
    connectionsStubs: [{ name: 'HEO' }],
    ...over,
  });

describe('parseOrgWizardDraft', () => {
  it('round-trips a full draft', () => {
    const draft = parseOrgWizardDraft(full(), NOW);
    expect(draft).toMatchObject({
      step: 'structure',
      name: 'Kanata Minor Hockey',
      divisions: [{ sportKey: 'ice_hockey', name: 'U13 A' }],
      teams: ['Blazers'],
    });
  });

  it('envelope guards: wrong version, bad savedAt, TTL expiry → null', () => {
    expect(parseOrgWizardDraft(full({ }).replace('"v":1', '"v":2'), NOW)).toBeNull();
    expect(parseOrgWizardDraft(JSON.stringify({ v: 1, savedAt: 'nope', name: 'X' }), NOW)).toBeNull();
    expect(
      parseOrgWizardDraft(
        JSON.stringify({ v: 1, savedAt: NOW - WIZARD_DRAFT_TTL_MS - 1, name: 'X' }),
        NOW
      )
    ).toBeNull();
    expect(parseOrgWizardDraft(null, NOW)).toBeNull();
    expect(parseOrgWizardDraft('not json', NOW)).toBeNull();
  });

  it('coerces bad rows away and re-applies caps at parse time', () => {
    const draft = parseOrgWizardDraft(
      full({
        divisions: [{ sportKey: 'x', name: 'ok' }, { nope: true }, 'garbage'] as never,
        teams: Array(60).fill('T') as never,
      }),
      NOW
    );
    expect(draft?.divisions).toHaveLength(1);
    expect(draft?.teams).toHaveLength(50);
  });

  it('phase 7 C2: the golf extras round-trip, and a pre-C2 envelope gets safe defaults', () => {
    const golf = parseOrgWizardDraft(
      full({
        sports: ['golf', 7 as never],
        homeCourseId: 'course-1',
        homeCourseLabel: 'Eagle Creek Golf Club',
        website: 'https://eaglecreek.example',
        phone: '613-555-0100',
      }),
      NOW
    );
    expect(golf).toMatchObject({
      sports: ['golf'],
      homeCourseId: 'course-1',
      homeCourseLabel: 'Eagle Creek Golf Club',
      website: 'https://eaglecreek.example',
      phone: '613-555-0100',
    });
    expect(parseOrgWizardDraft(full(), NOW)).toMatchObject({
      sports: [],
      homeCourseId: null,
      homeCourseLabel: '',
      website: '',
      phone: '',
    });
    // A draft holding ONLY the golf extras is not empty — it restores.
    const onlyExtras = JSON.stringify({ v: 1, savedAt: NOW, name: '', sports: ['golf'] });
    expect(parseOrgWizardDraft(onlyExtras, NOW)?.sports).toEqual(['golf']);
  });

  it('an empty draft parses to null (never a restore notice for nothing)', () => {
    const empty = JSON.stringify({ v: 1, savedAt: NOW, name: '', description: '' });
    expect(parseOrgWizardDraft(empty, NOW)).toBeNull();
  });
});
