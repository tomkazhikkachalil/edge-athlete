/**
 * Vitals category accents — LITERAL values only. vitals-config declares
 * Tailwind token names ('yellow', 'violet', …) but interpolating tokens into
 * class strings is a JIT purge hazard, so the UI maps through this table.
 *
 * Hexes validated with the dataviz palette validator (light mode, all
 * checks pass): speed #d97706 · strength #7c3aed · conditioning #dc2626 ·
 * body #2563eb. The `hexDark` set is validated for dark-mode #1f1a16
 * surfaces: speed #fbbf24 · strength #a78bfa · conditioning #f87171 ·
 * body #60a5fa. Pick per theme (see ProgressSection/VitalsTab).
 */

import { VITAL_CATEGORIES } from '@/lib/vitals-config';

export interface CategoryAccent {
  /** Series/chart color (light surfaces). */
  hex: string;
  /** Series/chart color (dark #1f1a16 surfaces). */
  hexDark: string;
  /** Icon/text tint class. */
  text: string;
  /** Soft chip/badge background + text. */
  chip: string;
}

export const CATEGORY_ACCENTS: Record<string, CategoryAccent> = {
  speed: { hex: '#d97706', hexDark: '#fbbf24', text: 'text-amber-600 dark:text-amber-400', chip: 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300' },
  strength: { hex: '#7c3aed', hexDark: '#a78bfa', text: 'text-violet-600 dark:text-violet-400', chip: 'bg-violet-50 dark:bg-violet-950/40 text-violet-700 dark:text-violet-300' },
  conditioning: { hex: '#dc2626', hexDark: '#f87171', text: 'text-red-600 dark:text-red-400', chip: 'bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300' },
  body: { hex: '#2563eb', hexDark: '#60a5fa', text: 'text-blue-600 dark:text-blue-400', chip: 'bg-blue-50 dark:bg-blue-950/40 text-blue-700 dark:text-blue-300' },
};

const NEUTRAL: CategoryAccent = {
  hex: '#7c3aed',
  hexDark: '#a78bfa',
  text: 'text-tertiary',
  chip: 'bg-surface-sunken text-secondary',
};

export function categoryAccent(category: string | undefined | null): CategoryAccent {
  return (category && CATEGORY_ACCENTS[category]) || NEUTRAL;
}

/** metric_key → category key (config nests metrics under categories). */
const METRIC_CATEGORY: Record<string, string> = Object.fromEntries(
  VITAL_CATEGORIES.flatMap(c => c.metrics.map(m => [m.key, c.key]))
);

export function metricCategory(metricKey: string): string | undefined {
  return METRIC_CATEGORY[metricKey];
}
