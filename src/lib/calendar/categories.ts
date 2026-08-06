// Event category colors — STATIC Tailwind class strings only (never
// interpolated; SPORT_TAILWIND_COLORS precedent in config/sports-config.ts).

export interface CategoryColor {
  bg: string;      // solid chip/block fill
  text: string;    // text on white
  border: string;
  dot: string;     // month-view mobile dot
}

export const CATEGORY_COLORS: Record<string, CategoryColor> = {
  general:    { bg: 'bg-violet-600',  text: 'text-violet-700 dark:text-violet-300',  border: 'border-violet-600 dark:border-violet-500',  dot: 'bg-violet-600' },
  practice:   { bg: 'bg-sky-600',     text: 'text-sky-700 dark:text-sky-300',     border: 'border-sky-600 dark:border-sky-500',     dot: 'bg-sky-600' },
  game:       { bg: 'bg-emerald-600', text: 'text-emerald-700 dark:text-emerald-300', border: 'border-emerald-600 dark:border-emerald-500', dot: 'bg-emerald-600' },
  tournament: { bg: 'bg-amber-600',   text: 'text-amber-700 dark:text-amber-300',   border: 'border-amber-600 dark:border-amber-500',   dot: 'bg-amber-600' },
  training:   { bg: 'bg-rose-600',    text: 'text-rose-700 dark:text-rose-300',    border: 'border-rose-600 dark:border-rose-500',    dot: 'bg-rose-600' },
  social:     { bg: 'bg-teal-600',    text: 'text-teal-700 dark:text-teal-300',    border: 'border-teal-600 dark:border-teal-500',    dot: 'bg-teal-600' },
  other:      { bg: 'bg-gray-500',    text: 'text-gray-700 dark:text-stone-300',    border: 'border-gray-500',    dot: 'bg-gray-500' },
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
