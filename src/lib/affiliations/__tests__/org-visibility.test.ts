import { describe, expect, it } from 'vitest';
import { filterOrgsForViewer, orgKey } from '../org-visibility';

const orgs = [
  { kind: 'club' as const, id: 'c-public', visibility: 'public', listing_status: 'unlisted' },
  { kind: 'club' as const, id: 'c-private', visibility: 'private' },
  { kind: 'league' as const, id: 'l-private', visibility: 'private' },
  { kind: 'league' as const, id: 'l-legacy' }, // pre-177: no column → public
];

describe('filterOrgsForViewer', () => {
  it('self or a guardian sees everything, listing and visibility notwithstanding', () => {
    expect(filterOrgsForViewer(orgs, { isSelfOrGuardian: true, viewerOrgKeys: new Set() }).map(o => o.id))
      .toEqual(['c-public', 'c-private', 'l-private', 'l-legacy']);
  });
  it('a stranger sees public orgs (listed or not) and legacy rows, never a private one', () => {
    expect(filterOrgsForViewer(orgs, { isSelfOrGuardian: false, viewerOrgKeys: new Set() }).map(o => o.id))
      .toEqual(['c-public', 'l-legacy']);
  });
  it('a fellow member of a private org sees it', () => {
    expect(filterOrgsForViewer(orgs, { isSelfOrGuardian: false, viewerOrgKeys: new Set([orgKey('club', 'c-private')]) }).map(o => o.id))
      .toEqual(['c-public', 'c-private', 'l-legacy']);
  });
});
