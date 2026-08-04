'use client';

import type { EquipmentView } from '@/lib/equipment-display';

/**
 * The "back in time" strip: Now · 2026 · 2025 · … Single-select — picking a
 * year shows that season's in-bag setup (including gear retired since);
 * "Now" is the live view with its Current Setup / History split. Chip-rail
 * pattern per the explore page (ARIA tablist, canonical overflow-x strip
 * with edge bleed below sm).
 */

interface SeasonSwitcherProps {
  years: number[];
  view: EquipmentView;
  onChange: (view: EquipmentView) => void;
  /** Inside the toolbar: the parent owns spacing, so no edge bleed. */
  embedded?: boolean;
}

export default function SeasonSwitcher({ years, view, onChange, embedded = false }: SeasonSwitcherProps) {
  const chips: Array<{ value: EquipmentView; label: string }> = [
    { value: 'now', label: 'Now' },
    ...years.map(year => ({ value: year as EquipmentView, label: String(year) })),
  ];

  return (
    <div
      id="equip-seasons"
      role="tablist"
      aria-label="Season"
      className={`flex gap-2 overflow-x-auto scrollbar-hide scroll-mt-24 ${
        embedded ? '' : 'pb-1 -mx-4 px-4 sm:mx-0 sm:px-0'
      }`}
    >
      {chips.map(chip => {
        const active = view === chip.value;
        return (
          <button
            key={String(chip.value)}
            role="tab"
            aria-selected={active}
            onClick={() => onChange(chip.value)}
            className={`shrink-0 min-h-[40px] px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
              active
                ? 'bg-violet-600 text-white border-violet-600'
                : 'bg-white text-gray-700 border-gray-300 hover:border-violet-400'
            }`}
          >
            {chip.label}
          </button>
        );
      })}
    </div>
  );
}
