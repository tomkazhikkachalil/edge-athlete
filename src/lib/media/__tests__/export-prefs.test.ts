import { describe, it, expect } from 'vitest';
import {
  DEFAULT_EXPORT_PREFS,
  deriveOutput,
  EXPORT_QUALITY_VALUES,
  parseExportPrefs,
} from '../export-prefs';
import type { OutputConfig } from '../types';

const surface: OutputConfig = { maxDimension: 2048, mime: 'image/jpeg', quality: 0.9 };

describe('deriveOutput', () => {
  it('defaults keep the surface cap and lift quality to the high tier', () => {
    const out = deriveOutput(surface, DEFAULT_EXPORT_PREFS);
    expect(out.maxDimension).toBe(2048);
    expect(out.mime).toBe('image/jpeg');
    expect(out.quality).toBe(EXPORT_QUALITY_VALUES.high);
  });

  it('size only clamps — never exceeds the surface cap', () => {
    expect(deriveOutput(surface, { ...DEFAULT_EXPORT_PREFS, size: 'medium' }).maxDimension).toBe(1280);
    expect(deriveOutput(surface, { ...DEFAULT_EXPORT_PREFS, size: 'small' }).maxDimension).toBe(720);
    const avatar: OutputConfig = { maxDimension: 512, mime: 'image/jpeg', quality: 0.85 };
    // A 1280 preference on a 512-cap surface stays 512.
    expect(deriveOutput(avatar, { ...DEFAULT_EXPORT_PREFS, size: 'medium' }).maxDimension).toBe(512);
  });

  it('maps formats and quality tiers', () => {
    expect(deriveOutput(surface, { ...DEFAULT_EXPORT_PREFS, format: 'png' }).mime).toBe('image/png');
    expect(deriveOutput(surface, { ...DEFAULT_EXPORT_PREFS, format: 'webp' }).mime).toBe('image/webp');
    expect(deriveOutput(surface, { ...DEFAULT_EXPORT_PREFS, quality: 'compact' }).quality).toBe(
      EXPORT_QUALITY_VALUES.compact
    );
  });

  it('never forces heavy compression: every tier stays above 0.7', () => {
    for (const value of Object.values(EXPORT_QUALITY_VALUES)) {
      expect(value).toBeGreaterThanOrEqual(0.7);
    }
  });
});

describe('parseExportPrefs', () => {
  it('round-trips a stored preference', () => {
    const prefs = { quality: 'balanced', size: 'small', format: 'webp' } as const;
    expect(parseExportPrefs(JSON.stringify(prefs))).toEqual(prefs);
  });

  it('degrades every malformed shape to defaults, field-wise', () => {
    expect(parseExportPrefs(null)).toEqual(DEFAULT_EXPORT_PREFS);
    expect(parseExportPrefs('not json')).toEqual(DEFAULT_EXPORT_PREFS);
    expect(parseExportPrefs('{"quality":"ultra","size":"small"}')).toEqual({
      ...DEFAULT_EXPORT_PREFS,
      size: 'small', // valid field survives, invalid one defaults
    });
  });
});
