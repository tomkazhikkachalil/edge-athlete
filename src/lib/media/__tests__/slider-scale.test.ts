import { describe, it, expect } from 'vitest';
import {
  legacyToUi,
  signedToUi,
  uiToLegacy,
  uiToSigned,
  uiToUnsigned,
  unsignedToUi,
} from '../slider-scale';

describe('slider UI ↔ parameter mapping', () => {
  it('neutral is 0 in UI space for every mapping', () => {
    expect(signedToUi(0)).toBe(0);
    expect(legacyToUi(1)).toBe(0);
    expect(unsignedToUi(0)).toBe(0);
  });

  it('signed round-trips losslessly from integer UI values', () => {
    for (const ui of [-100, -37, 0, 1, 42, 100]) {
      expect(signedToUi(uiToSigned(ui))).toBe(ui);
    }
    expect(uiToSigned(-100)).toBe(-1);
    expect(uiToSigned(100)).toBe(1);
  });

  it('legacy trio round-trips losslessly (0..2 ↔ −100..100)', () => {
    for (const ui of [-100, -55, 0, 25, 100]) {
      expect(legacyToUi(uiToLegacy(ui))).toBe(ui);
    }
    expect(uiToLegacy(-100)).toBe(0);
    expect(uiToLegacy(100)).toBe(2);
  });

  it('unsigned round-trips losslessly (0..1 ↔ 0..100)', () => {
    for (const ui of [0, 15, 100]) {
      expect(unsignedToUi(uiToUnsigned(ui))).toBe(ui);
    }
  });
});
