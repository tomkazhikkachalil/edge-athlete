import { describe, it, expect } from 'vitest';
import { mergeOrgEvents, type OrgEventRow } from '../org-merge-server';

const ev = (id: string, org: { league_id?: string; club_id?: string } = {}): OrgEventRow => ({
  id,
  league_id: org.league_id ?? null,
  club_id: org.club_id ?? null,
  title: `Event ${id}`,
});

const NAMES = new Map([
  ['league-1', 'Spring League'],
  ['club-1', 'Eagle Creek GC'],
]);

describe('mergeOrgEvents', () => {
  it('decorates org events with the merged shape and the org name', () => {
    const out = mergeOrgEvents(new Set(), [ev('a', { league_id: 'league-1' })], [], NAMES);
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
    const out = mergeOrgEvents(new Set(), [], [ev('a', { club_id: 'club-x' })], NAMES);
    expect(out[0].org_name).toBeNull();
  });

  it('drops every event where the viewer holds their own guest row — declined included', () => {
    // The guest row is authoritative: invited/accepted rows already surface
    // via the guest-row query, and a declined row means "hide this from me".
    const out = mergeOrgEvents(
      new Set(['guest-of', 'declined']),
      [ev('guest-of', { league_id: 'league-1' }), ev('declined', { league_id: 'league-1' })],
      [ev('fresh', { club_id: 'club-1' })],
      NAMES
    );
    expect(out.map(e => e.id)).toEqual(['fresh']);
  });

  it('dedupes across the league and club sets by event id', () => {
    const out = mergeOrgEvents(
      new Set(),
      [ev('dup', { league_id: 'league-1' })],
      [ev('dup', { league_id: 'league-1' }), ev('other', { club_id: 'club-1' })],
      NAMES
    );
    expect(out.map(e => e.id)).toEqual(['dup', 'other']);
    expect(out[0].org_name).toBe('Spring League');
  });

  it('returns [] for empty inputs', () => {
    expect(mergeOrgEvents(new Set(), [], [], NAMES)).toEqual([]);
  });
});
