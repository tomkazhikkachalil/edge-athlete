'use client';

import { Plus } from 'lucide-react';
import MultiSelectDropdown from '../filters/MultiSelectDropdown';
import SeasonSwitcher from './SeasonSwitcher';
import type { EquipmentSort, EquipmentView } from '@/lib/equipment-display';

/**
 * The Equipment tab's single control banner: search, sort, the season
 * time-machine chips, the sport filter (mobile only — the rail is the sport
 * selector at lg+) and Add Equipment, all in one place.
 *
 * One flex-wrap container, no duplicated controls (duplicating the season
 * tablist would break ARIA and strict-mode locators): order classes give
 * lg a single row [search | sort | seasons | add], while `basis-full` drops
 * the seasons strip to its own row below lg — two compact rows on a phone,
 * with the Add label collapsing to an icon below sm.
 */

interface EquipmentToolbarProps {
  search: string;
  onSearch: (value: string) => void;
  sort: EquipmentSort;
  onSort: (value: EquipmentSort) => void;
  years: number[];
  view: EquipmentView;
  onViewChange: (view: EquipmentView) => void;
  sportOptions: Array<{ value: string; label: string }>;
  selectedSports: string[];
  onSelectedSports: (sports: string[]) => void;
  isOwnProfile: boolean;
  onAdd: () => void;
}

export default function EquipmentToolbar({
  search, onSearch, sort, onSort,
  years, view, onViewChange,
  sportOptions, selectedSports, onSelectedSports,
  isOwnProfile, onAdd,
}: EquipmentToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 sm:gap-3">
      <input
        type="search"
        value={search}
        onChange={e => onSearch(e.target.value)}
        placeholder="Search gear — brand, model, notes…"
        aria-label="Search equipment"
        className="order-1 flex-1 min-w-[10rem] px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
      />
      <select
        value={sort}
        onChange={e => onSort(e.target.value as EquipmentSort)}
        aria-label="Sort equipment"
        className="order-2 shrink-0 px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
      >
        <option value="newest">Newest</option>
        <option value="brand">Brand A–Z</option>
      </select>
      {isOwnProfile && (
        <button
          onClick={onAdd}
          aria-label="Add equipment"
          className="order-3 lg:order-5 shrink-0 flex items-center gap-2 px-3 sm:px-4 py-2 bg-violet-600 text-white rounded-lg font-semibold text-sm hover:bg-violet-700 transition-colors shadow-sm"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">Add Equipment</span>
        </button>
      )}
      {/* Sport filter — phones/tablets only; the rail owns this at lg+ */}
      <div className="order-4 lg:hidden shrink-0">
        <MultiSelectDropdown<string>
          allLabel="All Sports"
          itemNounPlural="sports"
          searchPlaceholder="Search sports..."
          options={sportOptions}
          selected={selectedSports}
          onChange={onSelectedSports}
          disabled={sportOptions.length < 2}
        />
      </div>
      {years.length > 0 && (
        <div className="order-5 lg:order-4 min-w-0 flex-1 basis-full lg:basis-auto lg:flex-initial">
          <SeasonSwitcher embedded years={years} view={view} onChange={onViewChange} />
        </div>
      )}
    </div>
  );
}
