import { describe, it, expect } from 'vitest';
import { validateEquipmentPatch, EQUIPMENT_FIELD_CAPS } from '@/lib/equipment-validation';

const CURRENT = { sport_key: 'golf' };

describe('validateEquipmentPatch', () => {
  // The three sparse-body callers that existed before item editing: their
  // bodies contain NO editable fields, so the helper must return zero updates
  // and no error — this is the backward-compat contract.
  it('passes a status-only body through untouched (status toggle caller)', () => {
    const r = validateEquipmentPatch({ status: 'retired' } as never, CURRENT);
    expect(r).toEqual({ ok: true, updates: {} });
  });

  it('passes a dates-only body through untouched (edit-dates caller)', () => {
    const r = validateEquipmentPatch(
      { acquiredOn: '2026-01-01', retiredOn: '2026-02-01' } as never,
      CURRENT
    );
    expect(r).toEqual({ ok: true, updates: {} });
  });

  it('passes an empty body through untouched', () => {
    expect(validateEquipmentPatch({}, CURRENT)).toEqual({ ok: true, updates: {} });
  });

  it('trims brand/model and rejects empty strings', () => {
    const ok = validateEquipmentPatch({ brand: '  Titleist ', model: ' TSR3 ' }, CURRENT);
    expect(ok).toEqual({ ok: true, updates: { brand: 'Titleist', model: 'TSR3' } });

    const bad = validateEquipmentPatch({ brand: '   ' }, CURRENT);
    expect(bad.ok).toBe(false);
  });

  it('rejects an unknown sport', () => {
    const r = validateEquipmentPatch({ sportKey: 'curling' }, CURRENT);
    expect(r).toEqual({ ok: false, error: 'Unknown sport' });
  });

  it('requires category when the sport actually changes', () => {
    const missing = validateEquipmentPatch({ sportKey: 'ice_hockey' }, CURRENT);
    expect(missing).toEqual({ ok: false, error: 'Category is required when changing sport' });

    const withCategory = validateEquipmentPatch(
      { sportKey: 'ice_hockey', category: 'stick' },
      CURRENT
    );
    expect(withCategory.ok).toBe(true);
    if (withCategory.ok) {
      expect(withCategory.updates).toMatchObject({ sport_key: 'ice_hockey', category: 'stick' });
    }
  });

  it('does not require category when sportKey is sent but unchanged', () => {
    const r = validateEquipmentPatch({ sportKey: 'golf' }, CURRENT);
    expect(r).toEqual({ ok: true, updates: { sport_key: 'golf' } });
  });

  it('normalises specs: {} and empty values become null, non-objects are rejected', () => {
    expect(validateEquipmentPatch({ specs: {} }, CURRENT)).toEqual({
      ok: true,
      updates: { specs: null },
    });
    expect(validateEquipmentPatch({ specs: { loft: ' ', shaft: 'Graphite' } }, CURRENT)).toEqual({
      ok: true,
      updates: { specs: { shaft: 'Graphite' } },
    });
    expect(validateEquipmentPatch({ specs: null }, CURRENT)).toEqual({
      ok: true,
      updates: { specs: null },
    });
    expect(validateEquipmentPatch({ specs: ['a'] }, CURRENT).ok).toBe(false);
  });

  it('maps empty imageUrl/notes to null', () => {
    expect(validateEquipmentPatch({ imageUrl: '', notes: '' }, CURRENT)).toEqual({
      ok: true,
      updates: { image_url: null, notes: null },
    });
    expect(validateEquipmentPatch({ imageUrl: ' https://x/y.png ' }, CURRENT)).toEqual({
      ok: true,
      updates: { image_url: 'https://x/y.png' },
    });
  });

  it('enforces the length caps', () => {
    expect(
      validateEquipmentPatch({ brand: 'x'.repeat(EQUIPMENT_FIELD_CAPS.brand + 1) }, CURRENT).ok
    ).toBe(false);
    expect(
      validateEquipmentPatch({ notes: 'x'.repeat(EQUIPMENT_FIELD_CAPS.notes + 1) }, CURRENT).ok
    ).toBe(false);
    expect(
      validateEquipmentPatch({ brand: 'x'.repeat(EQUIPMENT_FIELD_CAPS.brand) }, CURRENT).ok
    ).toBe(true);
  });
});
