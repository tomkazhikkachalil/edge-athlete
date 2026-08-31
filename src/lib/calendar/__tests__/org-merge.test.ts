import { describe, it, expect } from 'vitest';
import { mergeOrgEvents, type OrgEventRow } from '../org-merge-server';

const ev = (
  id: string,
  scope: { league_id?: string; club_id?: string; division_id?: string; team_id?: string } = {}
): OrgEventRow => ({
  id,
  league_id: scope.league_id ?? null,
  club_id: scope.club_id ?? null,
  division_id: scope.division_id ?? null,
  team_id: scope.team_id ?? null,
  title: `Event ${id}`,
});

const NAMES = new Map([
  ['league-1', 'Spring League'],
  ['club-1', 'Eagle Creek GC'],
]);

describe('mergeOrgEvents', () => {
  it('decorates org events with the merged shape and the org name', () => {
    const out = mergeOrgEvents(new Set(), [[ev('a', { league_id: 'league-1' })]], NAMES);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      id: 'a',
      title: 'Event a',
      my_status: null,
      is_organizer: false,
      is_org_event: true,
      org_name: 'Spring League',
    });
  });

  it('falls back to a null org name when the org row is unknown', () => {
    const out = mergeOrgEvents(new Set(), [[ev('a', { club_id: 'club-x' })]], NAMES);
    expect(out[0].org_name).toBeNull();
  });

  it('drops every event where the viewer holds their own guest row — declined included', () => {
    // The guest row is authoritative: invited/accepted rows already surface
    // via the guest-row query, and a declined row means "hide this from me".
    const out = mergeOrgEvents(
      new Set(['guest-of', 'declined']),
      [
        [ev('guest-of', { league_id: 'league-1' }), ev('declined', { league_id: 'league-1' })],
        [ev('fresh', { club_id: 'club-1' })],
      ],
      NAMES
    );
    expect(out.map(e => e.id)).toEqual(['fresh']);
  });

  it('dedupes across the scope lists by event id', () => {
    const out = mergeOrgEvents(
      new Set(),
      [
        [ev('dup', { league_id: 'league-1' })],
        [ev('dup', { league_id: 'league-1' }), ev('other', { club_id: 'club-1' })],
      ],
      NAMES
    );
    expect(out.map(e => e.id)).toEqual(['dup', 'other']);
    expect(out[0].org_name).toBe('Spring League');
  });

  it('resolves org_name for sub-org-scoped events through scopeOrg (0.9)', () => {
    const scopeOrg = new Map([
      ['division-1', 'league-1'],
      ['team-1', 'club-1'],
    ]);
    const out = mergeOrgEvents(
      new Set(),
      [[ev('d', { division_id: 'division-1' })], [ev('t', { team_id: 'team-1' })]],
      NAMES,
      scopeOrg
    );
    expect(out.map(e => [e.id, e.org_name])).toEqual([
      ['d', 'Spring League'],
      ['t', 'Eagle Creek GC'],
    ]);
    expect(out[0]).toMatchObject({ is_org_event: true, my_status: null });
  });

  it('unknown sub-org scope → null org name, event still merges', () => {
    const out = mergeOrgEvents(new Set(), [[ev('x', { team_id: 'team-gone' })]], NAMES, new Map());
    expect(out[0].org_name).toBeNull();
  });

  it('returns [] for empty inputs', () => {
    expect(mergeOrgEvents(new Set(), [[], []], NAMES)).toEqual([]);
  });
});
