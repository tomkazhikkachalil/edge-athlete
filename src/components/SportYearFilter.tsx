'use client';

import { SPORT_NAMES } from '@/lib/config/sports-config';
import MultiSelectDropdown from './filters/MultiSelectDropdown';

interface SportYearFilterProps {
  availableSports: string[];
  availableYears: number[];
  selectedSports: string[];
  selectedYears: number[];
  onSportsChange: (next: string[]) => void;
  onYearsChange: (next: number[]) => void;
}

/**
 * Reusable controlled filter — renders two multi-select dropdown buttons
 * (Sport + Year) styled to match the existing Sort / Media-type <select>
 * controls in ProfileMediaTabs. Designed to sit inline alongside those
 * existing controls in a flex row.
 *
 * Renders nothing if both available arrays are empty.
 */
export default function SportYearFilter({
  availableSports,
  availableYears,
  selectedSports,
  selectedYears,
  onSportsChange,
  onYearsChange,
}: SportYearFilterProps) {
  if (availableSports.length === 0 && availableYears.length === 0) return null;

  return (
    <>
      {availableSports.length > 0 && (
        <MultiSelectDropdown<string>
          allLabel="All Sports"
          itemNounPlural="sports"
          searchPlaceholder="Search sports..."
          options={availableSports.map(key => ({ value: key, label: SPORT_NAMES[key] ?? key }))}
          selected={selectedSports}
          onChange={onSportsChange}
        />
      )}
      {availableYears.length > 0 && (
        <MultiSelectDropdown<number>
          allLabel="All Years"
          itemNounPlural="years"
          searchPlaceholder="Search years..."
          options={availableYears.map(year => ({ value: year, label: String(year) }))}
          selected={selectedYears}
          onChange={onYearsChange}
        />
      )}
    </>
  );
}
