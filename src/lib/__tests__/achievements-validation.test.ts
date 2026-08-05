import { describe, it, expect } from 'vitest';
import { validateAchievementInput } from '../achievements';

const valid = { title: 'State Amateur', achievedOn: '2026-06-15' };

describe('validateAchievementInput (POST)', () => {
  it('accepts a minimal valid body', () => {
    const result = validateAchievementInput(valid);
    expect(result).toEqual({
      ok: true,
      fields: { title: 'State Amateur', achieved_on: '2026-06-15' },
    });
  });

  it('requires title', () => {
    expect(validateAchievementInput({ achievedOn: '2026-06-15' }).ok).toBe(false);
    expect(validateAchievementInput({ ...valid, title: '   ' }).ok).toBe(false);
  });

  it('requires a valid, non-future date', () => {
    expect(validateAchievementInput({ title: 'X' }).ok).toBe(false);
    expect(validateAchievementInput({ ...valid, achievedOn: 'June 2026' }).ok).toBe(false);
    expect(validateAchievementInput({ ...valid, achievedOn: '2199-01-01' }).ok).toBe(false);
  });

  it('trims title and enforces the 120-char cap', () => {
    const ok = validateAchievementInput({ ...valid, title: '  Club Champ  ' });
    expect(ok).toEqual(expect.objectContaining({ ok: true }));
    if (ok.ok) expect(ok.fields.title).toBe('Club Champ');
    expect(validateAchievementInput({ ...valid, title: 'x'.repeat(121) }).ok).toBe(false);
  });

  it('enforces optional-text caps (description 1000, organization 120, placement 60)', () => {
    expect(validateAchievementInput({ ...valid, description: 'x'.repeat(1001) }).ok).toBe(false);
    expect(validateAchievementInput({ ...valid, organization: 'x'.repeat(121) }).ok).toBe(false);
    expect(validateAchievementInput({ ...valid, placement: 'x'.repeat(61) }).ok).toBe(false);
  });

  it('normalizes empty optional text to null', () => {
    const result = validateAchievementInput({ ...valid, organization: '  ', placement: '' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fields.organization).toBeNull();
      expect(result.fields.placement).toBeNull();
    }
  });

  it('rejects non-string optional text', () => {
    expect(validateAchievementInput({ ...valid, placement: 3 }).ok).toBe(false);
  });

  it('validates sportKey against the registry; empty/null → General (null)', () => {
    const golf = validateAchievementInput({ ...valid, sportKey: 'golf' });
    expect(golf.ok && golf.fields.sport_key).toBe('golf');
    const general = validateAchievementInput({ ...valid, sportKey: '' });
    expect(general.ok && general.fields.sport_key).toBeNull();
    const nulled = validateAchievementInput({ ...valid, sportKey: null });
    expect(nulled.ok && nulled.fields.sport_key).toBeNull();
    expect(validateAchievementInput({ ...valid, sportKey: 'curling' }).ok).toBe(false);
  });
});

describe('validateAchievementInput (PATCH, partial)', () => {
  it('allows omitting title and date entirely', () => {
    const result = validateAchievementInput({ placement: '1st Place' }, { partial: true });
    expect(result).toEqual({ ok: true, fields: { placement: '1st Place' } });
  });

  it('still validates provided fields', () => {
    expect(validateAchievementInput({ title: ' ' }, { partial: true }).ok).toBe(false);
    expect(validateAchievementInput({ achievedOn: 'nope' }, { partial: true }).ok).toBe(false);
  });

  it('produces an empty field set when nothing relevant is provided', () => {
    const result = validateAchievementInput({}, { partial: true });
    expect(result).toEqual({ ok: true, fields: {} });
  });
});
