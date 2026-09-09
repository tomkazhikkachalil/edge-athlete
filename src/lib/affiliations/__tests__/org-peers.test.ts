import { describe, it, expect } from 'vitest';
import { unionPeerIds, isOrgLensVisible, ORG_PEER_CAP } from '../org-peers';
import { parseOrgParam } from '../org-peers';

describe('unionPeerIds', () => {
  it('unions across groups preserving first-seen order', () => {
    expect(unionPeerIds([['a', 'b'], ['c']])).toEqual(['a', 'b', 'c']);
  });

  it('dedupes within and across groups', () => {
    expect(unionPeerIds([['a', 'a', 'b'], ['b', 'c', 'a']])).toEqual(['a', 'b', 'c']);
  });

  it('caps the result', () => {
    expect(unionPeerIds([['a', 'b', 'c', 'd']], 2)).toEqual(['a', 'b']);
    // Cap applies across groups too.
    expect(unionPeerIds([['a'], ['b', 'c']], 2)).toEqual(['a', 'b']);
  });

  it('returns [] for empty input and exports a sane default cap', () => {
    expect(unionPeerIds([])).toEqual([]);
    expect(unionPeerIds([[], []])).toEqual([]);
    expect(ORG_PEER_CAP).toBeGreaterThan(0);
  });
});

describe('isOrgLensVisible', () => {
  it('allows only public post + public author (the anonymous-visible rule)', () => {
    expect(isOrgLensVisible('public', 'public')).toBe(true);
    expect(isOrgLensVisible('private', 'public')).toBe(false);
    expect(isOrgLensVisible('public', 'private')).toBe(false);
    expect(isOrgLensVisible('private', 'private')).toBe(false);
  });

  it('treats missing visibility as not visible', () => {
    expect(isOrgLensVisible(null, 'public')).toBe(false);
    expect(isOrgLensVisible('public', undefined)).toBe(false);
  });
});

describe('parseOrgParam (Org Pages R5)', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  it('accepts league:<uuid> and club:<uuid>, lower-casing both parts', () => {
    expect(parseOrgParam(`league:${uuid}`)).toEqual({ side: 'league', orgId: uuid });
    expect(parseOrgParam(`CLUB:${uuid.toUpperCase()}`)).toEqual({ side: 'club', orgId: uuid });
  });
  it('rejects anything else', () => {
    for (const bad of [null, undefined, '', 'league', `team:${uuid}`, `league:${uuid}x`, 'league:not-a-uuid', `league:${uuid}:extra`]) {
      expect(parseOrgParam(bad)).toBeNull();
    }
  });
});
