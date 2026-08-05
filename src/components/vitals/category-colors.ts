/**
 * Vitals category accents — LITERAL values only. vitals-config declares
 * Tailwind token names ('yellow', 'violet', …) but interpolating tokens into
 * class strings is a JIT purge hazard, so the UI maps through this table.
 *
 * Hexes validated with the dataviz palette validator (light mode, all
 * checks pass): speed #d97706 · strength #7c3aed · conditioning #dc2626 ·
 * body #2563eb.
 */

import { VITAL_CATEGORIES } from '@/lib/vitals-config';

export interface CategoryAccent {
  /** Series/chart color. */
  hex: string;
  /** Icon/text tint class. */
  text: string;
  /** Soft chip/badge background + text. */
  chip: string;
}

export const CATEGORY_ACCENTS: Record<string, CategoryAccent> = {
  speed: { hex: '#d97706', text: 'text-amber-600', chip: 'bg-amber-50 text-amber-700' },
  strength: { hex: '#7c3aed', text: 'text-violet-600', chip: 'bg-violet-50 text-violet-700' },
  conditioning: { hex: '#dc2626', text: 'text-red-600', chip: 'bg-red-50 text-red-700' },
  body: { hex: '#2563eb', text: 'text-blue-600', chip: 'bg-blue-50 text-blue-700' },
};

const NEUTRAL: CategoryAccent = {
  hex: '#7c3aed',
  text: 'text-gray-600',
  chip: 'bg-gray-100 text-gray-700',
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
