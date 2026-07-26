'use client';

import { Filter } from 'lucide-react';

interface FilterBarProps {
  /** Tab-specific filter controls (selects / MultiSelectDropdowns). */
  children: React.ReactNode;
  /** Shown as the "N items" pill; omit to hide the pill. */
  resultCount?: number;
  resultNoun?: string;
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
 */
export default function FilterBar({
  children,
  resultCount,
  resultNoun = 'item',
  actions,
  activeCount,
  onClearAll,
}: FilterBarProps) {
  const hasActive = activeCount > 0;

  return (
    <>
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">{children}</div>

        <div className="flex items-center gap-3">
          {resultCount !== undefined && (
            <div className="inline-flex items-center px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-sm font-semibold whitespace-nowrap">
              {resultCount} {resultCount === 1 ? resultNoun : `${resultNoun}s`}
            </div>
          )}
          {actions}
        </div>
      </div>

      {/* Filter status + clear-all — always visible so the reset affordance
          is discoverable. Muted when idle, brand-colored when active. */}
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg">
        <div className="flex items-center gap-2 text-sm">
          <Filter
            className={`w-4 h-4 ${hasActive ? 'text-blue-600' : 'text-gray-400'}`}
            aria-hidden="true"
          />
          <span className={hasActive ? 'font-medium text-gray-800' : 'text-gray-500'}>
            {hasActive
              ? `${activeCount} active filter${activeCount === 1 ? '' : 's'}`
              : 'No filters applied'}
          </span>
        </div>
        <button
          type="button"
          disabled={!hasActive}
          onClick={onClearAll}
          className={`inline-flex items-center gap-1 text-sm font-semibold transition-colors ${
            hasActive
              ? 'text-blue-600 hover:text-blue-700 cursor-pointer'
              : 'text-gray-400 cursor-not-allowed'
          }`}
          aria-label="Clear all filters"
        >
          <span aria-hidden="true">×</span>
          Clear all filters
        </button>
      </div>
    </>
  );
}
