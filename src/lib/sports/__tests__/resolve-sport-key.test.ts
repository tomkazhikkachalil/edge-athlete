import { describe, it, expect } from 'vitest';
import { resolveSportKey, isComposerSport } from '../resolve-sport-key';

describe('resolveSportKey', () => {
  it('resolves canonical keys', () => {
    expect(resolveSportKey('golf')).toBe('golf');
    expect(resolveSportKey('ice_hockey')).toBe('ice_hockey');
  });

  it('resolves display names case-insensitively', () => {
    expect(resolveSportKey('Golf')).toBe('golf');
    expect(resolveSportKey('Ice Hockey')).toBe('ice_hockey');
    expect(resolveSportKey('BASKETBALL')).toBe('basketball');
  });

  it('returns null for unknown, empty, and null input', () => {
    expect(resolveSportKey('cricket')).toBeNull();
    expect(resolveSportKey('')).toBeNull();
    expect(resolveSportKey(null)).toBeNull();
    expect(resolveSportKey(undefined)).toBeNull();
  });
});

describe('isComposerSport', () => {
  it('accepts golf (full scorecard UI)', () => {
    expect(isComposerSport('golf')).toBe(true);
  });

  it('accepts stat-line sports', () => {
    expect(isComposerSport('ice_hockey')).toBe(true);
    expect(isComposerSport('basketball')).toBe(true);
  });

  it('rejects training (post category, no adapter) and null', () => {
    // 'training' is enabled in the registry but getSportAdapter('training')
    // throws — auto-defaulting the composer to it must be impossible.
    expect(isComposerSport('training')).toBe(false);
    expect(isComposerSport(null)).toBe(false);
  });

  it('rejects schema-less disabled sports', () => {
    expect(isComposerSport('tennis')).toBe(false);
  });
});
