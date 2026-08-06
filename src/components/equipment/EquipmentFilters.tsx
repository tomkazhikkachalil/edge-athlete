'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import type { EquipmentView } from '@/lib/equipment-display';

/**
 * The "Filters" control: one button with an active-count badge opening a
 * popover with three parameter groups —
 *   Season   radio list (Now + the athlete's in-bag years; the time machine)
 *   Category checkboxes of categories present in the current gear
 *   History  a "show retired gear" toggle
 * Open/close, outside-click, Escape and edge-flip mechanics mirror
 * MultiSelectDropdown (src/components/filters) — the established popover.
 */

interface EquipmentFiltersProps {
  years: number[];
  view: EquipmentView;
  onViewChange: (view: EquipmentView) => void;
  categoryOptions: Array<{ value: string; label: string }>;
  selectedCategories: string[];
  onSelectedCategories: (categories: string[]) => void;
  showHistory: boolean;
  onShowHistory: (show: boolean) => void;
}

export default function EquipmentFilters({
  years, view, onViewChange,
  categoryOptions, selectedCategories, onSelectedCategories,
  showHistory, onShowHistory,
}: EquipmentFiltersProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // Edge-flip after paint, straight to the DOM (panel remounts per open, so
  // the inline style self-resets) — same rationale as MultiSelectDropdown.
  useLayoutEffect(() => {
    if (!isOpen) return;
    const panel = panelRef.current;
    const container = containerRef.current;
    if (!panel || !container) return;
    const rect = panel.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    if (rect.right > window.innerWidth - 8 && containerRect.right - rect.width >= 8) {
      panel.style.left = 'auto';
      panel.style.right = '0';
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  const activeCount =
    (view !== 'now' ? 1 : 0) + selectedCategories.length + (showHistory ? 0 : 1);
  const hasActive = activeCount > 0;

  const toggleCategory = (value: string) => {
    onSelectedCategories(
      selectedCategories.includes(value)
        ? selectedCategories.filter(v => v !== value)
        : [...selectedCategories, value]
    );
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className={`px-3 py-2 border rounded-lg text-sm inline-flex items-center gap-2 transition-colors ${
          hasActive
            ? 'border-violet-500 text-brand-fg-strong bg-brand-soft'
            : 'border-border-strong text-secondary bg-surface hover:bg-surface-muted'
        }`}
      >
        <SlidersHorizontal className="w-4 h-4" aria-hidden="true" />
        <span>Filters</span>
        {hasActive && (
          <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold bg-brand text-white">
            {activeCount}
          </span>
        )}
        <ChevronDown
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          role="dialog"
          aria-label="Equipment filters"
          className="absolute left-0 top-full mt-1 w-64 max-w-[calc(100vw-2rem)] bg-surface-raised border border-border rounded-lg shadow-lg z-20 flex flex-col"
        >
          <div className="max-h-[60vh] overflow-y-auto p-3 space-y-4">
            {/* Season — the time machine. A year shows that season's in-bag
                setup, retired-since gear included. */}
            {years.length > 0 && (
              <fieldset>
                <legend className="text-xs font-bold uppercase tracking-wide text-muted mb-2">
                  Season
                </legend>
                <div className="space-y-1">
                  {(['now', ...years] as EquipmentView[]).map(option => (
                    <label
                      key={String(option)}
                      className="flex items-center gap-2 px-1 py-1 text-sm text-secondary rounded-lg hover:bg-surface-muted cursor-pointer"
                    >
                      <input
                        type="radio"
                        name="equipment-season"
                        checked={view === option}
                        onChange={() => onViewChange(option)}
                        className="accent-violet-600"
                      />
                      {option === 'now' ? 'Now' : option}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {/* Category */}
            {categoryOptions.length > 1 && (
              <fieldset>
                <legend className="text-xs font-bold uppercase tracking-wide text-muted mb-2">
                  Category
                </legend>
                <div className="space-y-1">
                  {categoryOptions.map(option => (
                    <label
                      key={option.value}
                      className="flex items-center gap-2 px-1 py-1 text-sm text-secondary rounded-lg hover:bg-surface-muted cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCategories.includes(option.value)}
                        onChange={() => toggleCategory(option.value)}
                        className="accent-violet-600"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}

            {/* Retired gear */}
            <fieldset>
              <legend className="text-xs font-bold uppercase tracking-wide text-muted mb-2">
                Retired gear
              </legend>
              <label className="flex items-center gap-2 px-1 py-1 text-sm text-secondary rounded-lg hover:bg-surface-muted cursor-pointer">
                <input
                  type="checkbox"
                  checked={showHistory}
                  onChange={e => onShowHistory(e.target.checked)}
                  className="accent-violet-600"
                />
                Show History
              </label>
            </fieldset>
          </div>

          {hasActive && (
            <>
              <div className="border-t border-border-subtle" />
              <button
                type="button"
                onClick={() => {
                  onViewChange('now');
                  onSelectedCategories([]);
                  onShowHistory(true);
                }}
                className="w-full text-left px-3 py-2 text-sm text-muted hover:bg-surface-muted transition-colors rounded-b-lg"
              >
                Reset filters
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
