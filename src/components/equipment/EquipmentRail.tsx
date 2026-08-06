'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import type { EquipmentNavSport } from '@/lib/equipment-display';

/**
 * Desktop category rail — the store's department sidebar, and (since the
 * toolbar consolidation) the SPORT SELECTOR at lg+: "All Sports" at the top,
 * then each sport as a dark-violet filter button. Clicking a sport filters
 * the whole view to it; clicking again (or All Sports) clears. Categories,
 * sets and History remain jump entries. Each sport group is collapsible via
 * its own chevron — a separate hit area, so collapsing never fights
 * filtering. lg+ only; the toolbar's dropdown covers phones.
 *
 * Sticky below the app header per the --ea-banner-h contract (z-30 under the
 * z-40 header). Anchor jumps only — no scrollspy (deliberate v1 choice).
 */

interface EquipmentRailProps {
  nav: EquipmentNavSport[];
  /** Currently filtered sport, or null for all. */
  selectedSport: string | null;
  onSelectSport: (sportKey: string | null) => void;
  onJump: (anchorId: string) => void;
  /** History jumps also need to expand the target section first. */
  onJumpHistory: (sportKey: string, anchorId: string) => void;
}

const badge = (count: number, active: boolean) => (
  <span
    className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold ${
      active ? 'bg-violet-100 dark:bg-violet-950/60 text-brand-fg-strong' : 'bg-gray-200 dark:bg-stone-800 text-secondary'
    }`}
  >
    {count > 99 ? '99+' : count}
  </span>
);

export default function EquipmentRail({
  nav, selectedSport, onSelectSport, onJump, onJumpHistory,
}: EquipmentRailProps) {
  // Collapsed rail groups. First sport open, the rest closed on arrival —
  // the rail should orient, not overwhelm. Lazy init is safe: the rail only
  // mounts once equipment exists, so nav is populated on first render.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(nav.slice(1).map(sport => [sport.sportKey, true]))
  );

  // Sport nav dropdown (single-select; outside-click + Escape close per the
  // MultiSelectDropdown popover conventions).
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickerOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPickerOpen(false);
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [pickerOpen]);

  const selectedLabel =
    nav.find(s => s.sportKey === selectedSport)?.label ?? 'All Sports';

  return (
    <nav
      aria-label="Equipment sections"
      className="hidden lg:block w-[210px] flex-shrink-0 self-start sticky top-[calc(var(--ea-banner-h,0px)+5rem)] z-30 max-h-[calc(100vh-var(--ea-banner-h,0px)-6rem)] overflow-y-auto pr-1"
    >
      <div className="space-y-4">
        {/* Sport picker — the rail's "department" dropdown */}
        <div className="relative" ref={pickerRef}>
          <button
            onClick={() => setPickerOpen(o => !o)}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            aria-label="Choose sport"
            className={`w-full flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-xs font-bold uppercase tracking-wide transition-colors ${
              selectedSport !== null
                ? 'border-violet-500 bg-brand-soft text-violet-800 dark:text-violet-200'
                : 'border-border-strong bg-surface text-violet-800 dark:text-violet-200 hover:bg-surface-muted'
            }`}
          >
            <span className="truncate">{selectedLabel}</span>
            <ChevronDown
              className={`w-4 h-4 shrink-0 transition-transform ${pickerOpen ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
          {pickerOpen && (
            <div
              role="listbox"
              aria-label="Choose sport"
              className="absolute left-0 top-full mt-1 w-full bg-surface-raised border border-border rounded-lg shadow-lg z-20 py-1"
            >
              <button
                role="option"
                aria-selected={selectedSport === null}
                onClick={() => { onSelectSport(null); setPickerOpen(false); }}
                className={`w-full text-left px-3 py-2 text-sm hover:bg-surface-muted ${
                  selectedSport === null ? 'font-semibold text-violet-800 dark:text-violet-200' : 'text-secondary'
                }`}
              >
                All Sports
              </button>
              {nav.map(sport => (
                <button
                  key={sport.sportKey}
                  role="option"
                  aria-selected={selectedSport === sport.sportKey}
                  onClick={() => { onSelectSport(sport.sportKey); setPickerOpen(false); }}
                  className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2 text-sm hover:bg-surface-muted ${
                    selectedSport === sport.sportKey ? 'font-semibold text-violet-800 dark:text-violet-200' : 'text-secondary'
                  }`}
                >
                  <span className="truncate">{sport.label}</span>
                  {badge(
                    sport.categories.reduce((sum, c) => sum + c.count, 0) +
                      sport.sets.reduce((sum, s) => sum + s.count, 0),
                    selectedSport === sport.sportKey
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
        {nav.map(sport => {
          const isCollapsed = collapsed[sport.sportKey] ?? false;
          const isSelected = selectedSport === sport.sportKey;
          return (
            <div key={sport.sportKey}>
              <div className="flex items-center">
                {/* Sport = filter. Dark violet so the sport level reads
                    clearly above the gray category entries. */}
                <button
                  onClick={() => onSelectSport(isSelected ? null : sport.sportKey)}
                  aria-pressed={isSelected}
                  className={`ea-interactive flex-1 min-w-0 text-left rounded-lg px-2 py-1.5 text-xs font-bold uppercase tracking-wide truncate ${
                    isSelected ? 'bg-brand-soft text-violet-800 dark:text-violet-200' : 'text-violet-800 dark:text-violet-200'
                  }`}
                >
                  {sport.label}
                </button>
                <button
                  onClick={() =>
                    setCollapsed(prev => ({ ...prev, [sport.sportKey]: !isCollapsed }))
                  }
                  aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${sport.label}`}
                  aria-expanded={!isCollapsed}
                  className="ea-interactive flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                >
                  <ChevronDown
                    className={`w-4 h-4 text-brand-fg-strong transition-transform ${
                      isCollapsed ? '-rotate-90' : ''
                    }`}
                  />
                </button>
              </div>
              {!isCollapsed && (
                <ul className="mt-1 space-y-0.5">
                  {sport.sets.map(set => (
                    <li key={`set-${set.value}`}>
                      <button
                        onClick={() => onJump(set.anchorId)}
                        className="ea-interactive w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold text-brand-fg-strong"
                      >
                        <span className="truncate">★ {set.label}</span>
                        {badge(set.count, true)}
                      </button>
                    </li>
                  ))}
                  {sport.categories.map(category => (
                    <li key={category.value}>
                      <button
                        onClick={() => onJump(category.anchorId)}
                        className="ea-interactive w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm text-secondary"
                      >
                        <span className="truncate">{category.label}</span>
                        {badge(category.count, false)}
                      </button>
                    </li>
                  ))}
                  {sport.retiredCount > 0 && (
                    <li>
                      <button
                        onClick={() => onJumpHistory(sport.sportKey, sport.historyAnchorId)}
                        className="ea-interactive w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm text-muted"
                      >
                        <span className="truncate">History</span>
                        {badge(sport.retiredCount, false)}
                      </button>
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </nav>
  );
}
