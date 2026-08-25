/**
 * Export preferences (Phase 4, round E-W2) — PURE, node-tested. The
 * user's quality / size / format choices for photo exports, applied on
 * top of each surface's OutputConfig:
 *   - size only ever CLAMPS (a surface's maxDimension is its server-side
 *     sanity cap — user choices never exceed it);
 *   - quality tiers stay generous (the mandate: never force heavy
 *     compression — "compact" is a user choice, not a default);
 *   - formats are what browsers can actually ENCODE: JPEG/PNG/WebP.
 *     HEIC decode works (inputs re-encode), but no browser encodes HEIC —
 *     offering it would be a lie.
 *
 * Persisted in localStorage under a versioned key, parsed defensively.
 */

import type { OutputConfig } from './types';

export type ExportQuality = 'high' | 'balanced' | 'compact';
export type ExportSize = 'max' | 'medium' | 'small';
export type ExportFormat = 'jpeg' | 'png' | 'webp';

export interface ExportPrefs {
  quality: ExportQuality;
  size: ExportSize;
  format: ExportFormat;
}

export const DEFAULT_EXPORT_PREFS: ExportPrefs = {
  quality: 'high',
  size: 'max',
  format: 'jpeg',
};

export const EXPORT_PREFS_KEY = 'ea:export-prefs:v1';

export const EXPORT_QUALITY_VALUES: Record<ExportQuality, number> = {
  high: 0.92,
  balanced: 0.85,
  compact: 0.72,
};

/** null = keep the surface cap. */
export const EXPORT_SIZE_CAPS: Record<ExportSize, number | null> = {
  max: null,
  medium: 1280,
  small: 720,
};

export const EXPORT_FORMAT_MIMES: Record<ExportFormat, OutputConfig['mime']> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

const QUALITIES: ExportQuality[] = ['high', 'balanced', 'compact'];
const SIZES: ExportSize[] = ['max', 'medium', 'small'];
const FORMATS: ExportFormat[] = ['jpeg', 'png', 'webp'];

/** Apply preferences to a surface's OutputConfig. */
export function deriveOutput(base: OutputConfig, prefs: ExportPrefs): OutputConfig {
  const cap = EXPORT_SIZE_CAPS[prefs.size];
  return {
    maxDimension: cap === null ? base.maxDimension : Math.min(base.maxDimension, cap),
    mime: EXPORT_FORMAT_MIMES[prefs.format],
    quality: EXPORT_QUALITY_VALUES[prefs.quality],
  };
}

/** Parse a stored preference string; anything malformed → defaults. */
export function parseExportPrefs(raw: string | null): ExportPrefs {
  if (!raw) return { ...DEFAULT_EXPORT_PREFS };
  try {
    const value = JSON.parse(raw) as Partial<ExportPrefs>;
    return {
      quality: QUALITIES.includes(value.quality as ExportQuality)
        ? (value.quality as ExportQuality)
        : DEFAULT_EXPORT_PREFS.quality,
      size: SIZES.includes(value.size as ExportSize)
        ? (value.size as ExportSize)
        : DEFAULT_EXPORT_PREFS.size,
      format: FORMATS.includes(value.format as ExportFormat)
        ? (value.format as ExportFormat)
        : DEFAULT_EXPORT_PREFS.format,
    };
  } catch {
    return { ...DEFAULT_EXPORT_PREFS };
  }
}
