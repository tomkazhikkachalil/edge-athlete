'use client';

import { Filter } from 'lucide-react';

interface FilterBarProps {
  /** Tab-specific filter controls (selects / MultiSelectDropdowns). */
  children: React.ReactNode;
  /** Shown as the "N items" pill; omit to hide the pill. */
  resultCount?: number;
  resultNoun?: string;
  /** Irregular plural (e.g. "entries"); defaults to resultNoun + "s". */
  resultNounPlural?: string;
  /** Right-aligned slot next to the count pill (e.g. an Add button). */
  actions?: React.ReactNode;
  /** Number of active filter selections — drives the status strip. */
  activeCount: number;
  onClearAll: () => void;
}

/**
 * The shared two-row filter treatment used across the athlete-profile tabs:
 * a controls row (filters left, count pill + actions right) and the gray
 * status strip with the active-filter count and "Clear all filters" reset.
 * Markup/styling matches the original ProfileMediaTabs filter rows exactly.
 *
 * ONE block that carries its own spacing (Oct 2 2026). It used to return two
 * bare rows and lean on a `space-y-6` parent for the gap between them — the
 * Stats tab's parent had none, so the controls sat flush on the strip's
 * border and the strip flush on the grid. A shared block never depends on
 * its host for its own insides; the host only spaces what comes after it.
 */
export default function FilterBar({
  children,
  resultCount,
  resultNoun = 'item',
  resultNounPlural,
  actions,
  activeCount,
  onClearAll,
}: FilterBarProps) {
  const hasActive = activeCount > 0;

  return (
    <div className="space-y-6" data-filter-bar="">
      <div className="flex items-center justify-between gap-4 flex-wrap" data-filter-controls="">
        <div className="flex items-center gap-3 flex-wrap">{children}</div>

        <div className="flex items-center gap-3">
          {resultCount !== undefined && (
            <div className="inline-flex items-center px-3 py-1 rounded-full bg-brand-soft text-brand-fg-strong text-sm font-semibold whitespace-nowrap">
              {resultCount} {resultCount === 1 ? resultNoun : resultNounPlural ?? `${resultNoun}s`}
            </div>
          )}
          {actions}
        </div>
      </div>

      {/* Filter status + clear-all — always visible so the reset affordance
          is discoverable. Muted when idle, brand-colored when active. */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-surface-muted border border-border rounded-lg" data-filter-status="">
        <div className="flex items-center gap-2 text-sm">
          <Filter
            className={`w-4 h-4 ${hasActive ? 'text-brand-fg' : 'text-faint'}`}
            aria-hidden="true"
          />
          <span className={hasActive ? 'font-medium text-primary' : 'text-muted'}>
            {hasActive
              ? `${activeCount} active filter${activeCount === 1 ? '' : 's'}`
              : 'No filters applied'}
          </span>
        </div>
        <button
          type="button"
          disabled={!hasActive}
          onClick={onClearAll}
          className={`relative after:absolute after:content-[''] after:-inset-y-3 after:-inset-x-1 inline-flex items-center gap-1 text-sm font-semibold transition-colors ${
            hasActive
              ? 'text-brand-fg hover:text-brand-fg-strong cursor-pointer'
              : 'text-faint cursor-not-allowed'
          }`}
          aria-label="Clear all filters"
        >
          <span aria-hidden="true">×</span>
          Clear all filters
        </button>
      </div>
    </div>
  );
}
