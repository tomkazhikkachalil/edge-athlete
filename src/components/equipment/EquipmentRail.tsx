'use client';

import { useState } from 'react';
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
      active ? 'bg-violet-100 text-violet-700' : 'bg-gray-200 text-gray-700'
    }`}
  >
    {count > 99 ? '99+' : count}
  </span>
);

export default function EquipmentRail({
  nav, selectedSport, onSelectSport, onJump, onJumpHistory,
}: EquipmentRailProps) {
  // Collapsed rail groups (default expanded). Rail-local state on purpose —
  // it is presentation, not data.
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  return (
    <nav
      aria-label="Equipment sections"
      className="hidden lg:block w-[210px] flex-shrink-0 self-start sticky top-[calc(var(--ea-banner-h,0px)+5rem)] z-30 max-h-[calc(100vh-var(--ea-banner-h,0px)-6rem)] overflow-y-auto pr-1"
    >
      <div className="space-y-4">
        <button
          onClick={() => onSelectSport(null)}
          aria-pressed={selectedSport === null}
          className={`ea-interactive w-full text-left rounded-lg px-2 py-1.5 text-xs font-bold uppercase tracking-wide ${
            selectedSport === null ? 'bg-violet-50 text-violet-800' : 'text-violet-800'
          }`}
        >
          All Sports
        </button>
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
                    isSelected ? 'bg-violet-50 text-violet-800' : 'text-violet-800'
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
                    className={`w-4 h-4 text-violet-700 transition-transform ${
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
                        className="ea-interactive w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm font-semibold text-violet-700"
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
                        className="ea-interactive w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-700"
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
                        className="ea-interactive w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-500"
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
