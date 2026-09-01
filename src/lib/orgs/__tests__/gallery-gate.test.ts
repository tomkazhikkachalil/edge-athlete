import { describe, expect, it } from 'vitest';
import { isProfileCleared, orgKey } from '../gallery-gate';

describe('isProfileCleared — the public-gallery consent match', () => {
  const pairs = new Set([
    `kid1|${orgKey('club', 'c1')}`, // consented to their club
    `kid2|${orgKey('league', 'l9')}`, // consented to some OTHER league
  ]);

  it('clears a profile whose consented org touches the contest', () => {
    expect(isProfileCleared('kid1', [orgKey('league', 'l1'), orgKey('club', 'c1')], pairs)).toBe(
      true
    );
  });

  it('a consent with an unrelated org clears nothing', () => {
    expect(isProfileCleared('kid2', [orgKey('league', 'l1'), orgKey('club', 'c1')], pairs)).toBe(
      false
    );
  });

  it('no consent row ⇒ never cleared (fail closed)', () => {
    expect(isProfileCleared('kid3', [orgKey('club', 'c1')], pairs)).toBe(false);
  });

  it('an empty contest-org set clears nothing', () => {
    expect(isProfileCleared('kid1', [], pairs)).toBe(false);
  });

  it('league and club keys never collide on the same id', () => {
    const collide = new Set([`kid4|${orgKey('league', 'x1')}`]);
    expect(isProfileCleared('kid4', [orgKey('club', 'x1')], collide)).toBe(false);
  });
});
