'use client';

import type { EquipmentNavSport } from '@/lib/equipment-display';

/**
 * Desktop category rail — the "store departments" sidebar. lg+ only; mobile
 * keeps the stacked flow. Sticky below the app header using the established
 * --ea-banner-h contract (StickyBanner publishes it; header is h-16 at z-40,
 * so the rail docks under both at z-30). Plain anchor jumps — no scrollspy
 * (a deliberate v1 simplification; targets carry scroll-mt offsets).
 */

interface EquipmentRailProps {
  nav: EquipmentNavSport[];
  onJump: (anchorId: string) => void;
  /** History jumps also need to expand the target section first. */
  onJumpHistory: (sportKey: string, anchorId: string) => void;
  /** Optional extra entries rendered at the top (e.g. the Seasons switcher). */
  topSlot?: React.ReactNode;
}

export default function EquipmentRail({ nav, onJump, onJumpHistory, topSlot }: EquipmentRailProps) {
  return (
    <nav
      aria-label="Equipment sections"
      className="hidden lg:block w-[210px] flex-shrink-0 self-start sticky top-[calc(var(--ea-banner-h,0px)+5rem)] z-30 max-h-[calc(100vh-var(--ea-banner-h,0px)-6rem)] overflow-y-auto pr-1"
    >
      <div className="space-y-4">
        {topSlot}
        {nav.map(sport => (
          <div key={sport.sportKey}>
            <button
              onClick={() => onJump(sport.anchorId)}
              className="ea-interactive w-full text-left rounded-lg px-2 py-1.5 text-xs font-bold uppercase tracking-wide text-gray-500"
            >
              {sport.label}
            </button>
            <ul className="mt-1 space-y-0.5">
              {sport.categories.map(category => (
                <li key={category.value}>
                  <button
                    onClick={() => onJump(category.anchorId)}
                    className="ea-interactive w-full flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm text-gray-700"
                  >
                    <span className="truncate">{category.label}</span>
                    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold bg-gray-200 text-gray-700">
                      {category.count > 99 ? '99+' : category.count}
                    </span>
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
                    <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-xs font-bold bg-gray-200 text-gray-700">
                      {sport.retiredCount > 99 ? '99+' : sport.retiredCount}
                    </span>
                  </button>
                </li>
              )}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  );
}
