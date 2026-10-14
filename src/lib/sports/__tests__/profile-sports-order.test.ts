import { describe, expect, it } from 'vitest';
import { orderProfileSports } from '../profile-sports-order';

const REG = ['baseball', 'basketball', 'football', 'golf', 'ice_hockey', 'soccer', 'swimming', 'tennis', 'track_field', 'volleyball'];

describe('orderProfileSports — pinned lead, the primary leads the rest, registry order breaks ties', () => {
  it('no pins: the primary first, then registry order', () => {
    expect(orderProfileSports({ active: ['volleyball', 'golf', 'basketball'], pins: [], primary: 'volleyball', registryOrder: REG }))
      .toEqual({ pinned: [], rest: ['volleyball', 'basketball', 'golf'] });
  });
  it('a pinned sport leads regardless of the primary; the primary still leads the rest', () => {
    expect(orderProfileSports({ active: ['golf', 'basketball', 'soccer'], pins: [{ key: 'basketball', order: 1 }], primary: 'golf', registryOrder: REG }))
      .toEqual({ pinned: ['basketball'], rest: ['golf', 'soccer'] });
  });
  it('pins sort by order; a gap (1, 3) is fine; a tie breaks by registry order', () => {
    expect(orderProfileSports({ active: ['golf', 'soccer', 'basketball'], pins: [{ key: 'soccer', order: 3 }, { key: 'golf', order: 1 }, { key: 'basketball', order: 3 }], primary: null, registryOrder: REG }).pinned)
      .toEqual(['golf', 'basketball', 'soccer']);
  });
  it('a pin on a sport that is not active is ignored; an unknown key is dropped', () => {
    expect(orderProfileSports({ active: ['golf', 'curling'], pins: [{ key: 'tennis', order: 1 }], primary: 'curling', registryOrder: REG }))
      .toEqual({ pinned: [], rest: ['golf'] });
  });
  it('a disabled registry sport (tennis) is listed like any other', () => {
    expect(orderProfileSports({ active: ['tennis'], pins: [], primary: 'tennis', registryOrder: REG })).toEqual({ pinned: [], rest: ['tennis'] });
  });
});
