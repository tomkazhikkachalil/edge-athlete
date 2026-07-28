// Event category colors — STATIC Tailwind class strings only (never
// interpolated; SPORT_TAILWIND_COLORS precedent in config/sports-config.ts).

export interface CategoryColor {
  bg: string;      // solid chip/block fill
  text: string;    // text on white
  border: string;
  dot: string;     // month-view mobile dot
}

export const CATEGORY_COLORS: Record<string, CategoryColor> = {
  general:    { bg: 'bg-violet-600',  text: 'text-violet-700',  border: 'border-violet-600',  dot: 'bg-violet-600' },
  practice:   { bg: 'bg-sky-600',     text: 'text-sky-700',     border: 'border-sky-600',     dot: 'bg-sky-600' },
  game:       { bg: 'bg-emerald-600', text: 'text-emerald-700', border: 'border-emerald-600', dot: 'bg-emerald-600' },
  tournament: { bg: 'bg-amber-600',   text: 'text-amber-700',   border: 'border-amber-600',   dot: 'bg-amber-600' },
  training:   { bg: 'bg-rose-600',    text: 'text-rose-700',    border: 'border-rose-600',    dot: 'bg-rose-600' },
  social:     { bg: 'bg-teal-600',    text: 'text-teal-700',    border: 'border-teal-600',    dot: 'bg-teal-600' },
  other:      { bg: 'bg-gray-500',    text: 'text-gray-700',    border: 'border-gray-500',    dot: 'bg-gray-500' },
};

export const DEFAULT_CATEGORY_COLOR: CategoryColor = CATEGORY_COLORS.general;

export function categoryColor(category: string | null | undefined): CategoryColor {
  return CATEGORY_COLORS[category ?? ''] ?? DEFAULT_CATEGORY_COLOR;
}

export const CATEGORY_LABELS: Record<string, string> = {
  general: 'General',
  practice: 'Practice',
  game: 'Game',
  tournament: 'Tournament',
  training: 'Training',
  social: 'Social',
  other: 'Other',
};
