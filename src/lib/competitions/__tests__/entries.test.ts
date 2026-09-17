import { describe, expect, it } from 'vitest';
import { adHocEntryRefusal, entryDisplayName, isAdHocEntry, isTeamEntry } from '../entries';

describe('entries — one naming rule; an ad-hoc entry is a named side with members', () => {
  it('names: team → athlete → the ad-hoc name → a kind word', () => {
    expect(entryDisplayName({ team_id: 't', profile_id: null }, 'Blazers', null)).toBe('Blazers');
    expect(entryDisplayName({ team_id: 't', profile_id: null }, null, null)).toBe('Team');
    expect(entryDisplayName({ team_id: null, profile_id: 'p' }, null, 'Edge B.')).toBe('Edge B.');
    expect(entryDisplayName({ team_id: null, profile_id: 'p' }, null, null)).toBe('Athlete');
    expect(entryDisplayName({ team_id: null, profile_id: null, name: ' Reds ' }, null, null)).toBe('Reds');
    expect(entryDisplayName({ team_id: null, profile_id: null }, null, null)).toBe('Entrant');
  });
  it('kinds', () => {
    expect(isAdHocEntry({ team_id: null, profile_id: null, name: 'Reds' })).toBe(true);
    expect(isAdHocEntry({ team_id: 't', profile_id: null, name: 'Reds' })).toBe(false);
    expect(isTeamEntry({ team_id: null, profile_id: null, name: 'Reds' })).toBe(true);
    expect(isTeamEntry({ team_id: null, profile_id: 'p' })).toBe(false);
  });
  it('refusals by name', () => {
    const roster = new Set(['a', 'b']);
    expect(adHocEntryRefusal({ name: 'Reds', memberProfileIds: ['a', 'b'] }, roster)).toBeNull();
    expect(adHocEntryRefusal({ name: 'Reds', memberProfileIds: [] }, roster)).toBeNull();
    expect(adHocEntryRefusal({ name: '  ', memberProfileIds: [] }, roster)).toBe('name_required');
    expect(adHocEntryRefusal({ name: 'x'.repeat(81), memberProfileIds: [] }, roster)).toBe('name_too_long');
    expect(adHocEntryRefusal({ name: 'Reds', memberProfileIds: ['a', 'a'] }, roster)).toBe('member_duplicate');
    expect(adHocEntryRefusal({ name: 'Reds', memberProfileIds: ['z'] }, roster)).toBe('member_not_rostered');
    expect(adHocEntryRefusal({ name: 'Reds', memberProfileIds: Array.from({ length: 31 }, (_, i) => `m${i}`) }, new Set(Array.from({ length: 31 }, (_, i) => `m${i}`)))).toBe('too_many_members');
  });
});
