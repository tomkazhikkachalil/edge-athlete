import { describe, it, expect } from 'vitest';
import { sanitizeDisplayName, countEmoji, MAX_DISPLAY_NAME_EMOJI } from '../name-resolver';

describe('sanitizeDisplayName — spoofing defenses', () => {
  it('folds Cyrillic lookalikes in a visually-Latin name', () => {
    // 'Тom Кazhikkachalil' with Cyrillic Т and К renders identically to the
    // Latin name — the impersonation shape this exists to kill.
    expect(sanitizeDisplayName('Тom')).toBe('Tom');
    expect(sanitizeDisplayName('Jоhn Smіth')).toBe('John Smith'); // Cyrillic о, і
  });

  it('folds Greek capital lookalikes too', () => {
    expect(sanitizeDisplayName('Αlex')).toBe('Alex'); // Greek Α
  });

  it('leaves genuinely non-Latin names untouched', () => {
    expect(sanitizeDisplayName('山田太郎')).toBe('山田太郎');
    expect(sanitizeDisplayName('Владимир Петров')).toBe('Владимир Петров'); // real Cyrillic name
  });

  it('mixed real-world names keep their non-Latin parts', () => {
    expect(sanitizeDisplayName('José 山田')).toBe('José 山田');
  });

  it('strips bidi override/isolate controls', () => {
    expect(sanitizeDisplayName('Tom‮moc')).toBe('Tommoc'); // RLO removed, no reversal
    expect(sanitizeDisplayName('⁦Tom⁩')).toBe('Tom');
  });

  it('strips zero-width characters (existing behavior still holds)', () => {
    expect(sanitizeDisplayName('To​m')).toBe('Tom');
  });

  it('caps emoji at the limit, keeping the first ones', () => {
    expect(sanitizeDisplayName('Tom ⛳🏌️🔥🎯🚀')).toBe('Tom ⛳🏌️🔥');
    expect(countEmoji(sanitizeDisplayName('⛳🏌🔥🎯🚀 Tom'))).toBeLessThanOrEqual(MAX_DISPLAY_NAME_EMOJI);
  });

  it('collapses whitespace left by removals and trims', () => {
    expect(sanitizeDisplayName('  Tom ​  K  ')).toBe('Tom K');
  });

  it('still normalizes NFKC and caps length', () => {
    expect(sanitizeDisplayName('Ｔｏｍ')).toBe('Tom'); // fullwidth folds via NFKC
    expect(sanitizeDisplayName('x'.repeat(150)).length).toBe(100);
  });
});
