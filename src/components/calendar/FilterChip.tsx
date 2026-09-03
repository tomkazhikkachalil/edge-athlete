'use client';

import type { ReactNode } from 'react';

/**
 * A toggleable filter pill with a leading colour dot — the person and
 * category chips on /calendar and in the feed sidebar widget. One markup so
 * the two surfaces cannot drift. Layout stays with the caller (no width or
 * display here — the shared-class trap in CLAUDE.md).
 */
export default function FilterChip({
  selected,
  onClick,
  dot,
  size = 'md',
  children,
}: {
  selected: boolean;
  onClick: () => void;
  /** Tailwind background class for the leading dot; omit for no dot. */
  dot?: string;
  size?: 'sm' | 'md';
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`inline-flex min-h-[44px] items-center gap-1.5 px-3 py-1 rounded-full font-medium border transition ${
        size === 'sm' ? 'text-xs' : 'text-sm'
      } ${
        selected
          ? 'border-brand bg-brand-soft text-brand-fg-strong'
          : 'border-border-strong text-tertiary hover:border-violet-300 dark:hover:border-violet-700'
      }`}
    >
      {dot && <span className={`w-2 h-2 rounded-full ${dot}`} />}
      {children}
    </button>
  );
}
