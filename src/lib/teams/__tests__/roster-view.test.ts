import { describe, expect, it } from 'vitest';
import { filterCandidates } from '../roster-view';

const c = (name: string, onRoster: boolean) => ({ profileId: name, name, supervised: false, onRoster });

describe('filterCandidates', () => {
  const all = [c('Zoe Park', true), c('amir Chen', false), c('Maya Chen', true)];
  it('splits the roster members (add now) from the rest (invite first), A–Z', () => {
    const out = filterCandidates(all, '');
    expect(out.canAdd.map(x => x.name)).toEqual(['Maya Chen', 'Zoe Park']);
    expect(out.needsInvite.map(x => x.name)).toEqual(['amir Chen']);
  });
  it('filters by a case-insensitive name fragment', () => {
    const out = filterCandidates(all, '  CHEN ');
    expect(out.canAdd.map(x => x.name)).toEqual(['Maya Chen']);
    expect(out.needsInvite.map(x => x.name)).toEqual(['amir Chen']);
  });
  it('never mutates the input', () => {
    const input = [...all];
    filterCandidates(input, 'z');
    expect(input).toEqual(all);
  });
});
