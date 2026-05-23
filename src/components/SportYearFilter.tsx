'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { SPORT_NAMES } from '@/lib/config/sports-config';

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

interface MultiSelectDropdownProps<T extends string | number> {
  allLabel: string;
  itemNounPlural: string;
  searchPlaceholder: string;
  options: { value: T; label: string }[];
  selected: T[];
  onChange: (next: T[]) => void;
}

function MultiSelectDropdown<T extends string | number>({
  allLabel,
  itemNounPlural,
  searchPlaceholder,
  options,
  selected,
  onChange,
}: MultiSelectDropdownProps<T>) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filter options by search query (case-insensitive substring on label).
  // Selected values not matching the query stay selected in parent state —
  // they're just hidden from the visible list until the search is cleared.
  const filteredOptions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return options;
    return options.filter(opt => opt.label.toLowerCase().includes(q));
  }, [options, searchQuery]);

  // Reset search whenever the popover closes so reopening starts clean.
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      return;
    }
    // Auto-focus the search input when the popover opens
    searchInputRef.current?.focus();
  }, [isOpen]);

  // Outside-click + Escape behavior. Escape first clears the search if it's
  // non-empty, otherwise closes the popover (standard search-popover pattern).
  useEffect(() => {
    if (!isOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (searchQuery !== '') {
          setSearchQuery('');
        } else {
          setIsOpen(false);
        }
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen, searchQuery]);

  const toggle = (value: T) => {
    onChange(
      selected.includes(value)
        ? selected.filter(v => v !== value)
        : [...selected, value]
    );
  };

  // Dynamic button label
  let buttonLabel = allLabel;
  if (selected.length === 1) {
    const match = options.find(o => o.value === selected[0]);
    if (match) buttonLabel = match.label;
  } else if (selected.length > 1) {
    buttonLabel = `${selected.length} ${itemNounPlural}`;
  }

  const hasActive = selected.length > 0;

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 inline-flex items-center gap-2 transition-colors ${
          hasActive
            ? 'border-blue-500 text-blue-700 bg-blue-50'
            : 'border-gray-300 text-gray-700 bg-white hover:bg-gray-50'
        }`}
      >
        <span>{buttonLabel}</span>
        <ChevronDown
          className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          aria-multiselectable="true"
          className="absolute left-0 top-full mt-1 min-w-full w-max max-w-[80vw] bg-white border border-gray-200 rounded-lg shadow-lg z-20 flex flex-col"
        >
          {/* Search input — auto-focused on open */}
          <div className="relative border-b border-gray-100">
            <Search
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none"
              aria-hidden="true"
            />
            <input
              ref={searchInputRef}
              type="text"
              inputMode="search"
              placeholder={searchPlaceholder}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-white border-0 focus:outline-none focus:ring-0 rounded-t-lg"
              aria-label={searchPlaceholder}
            />
          </div>

          {/* Filtered options list */}
          <div className="max-h-60 overflow-y-auto py-1">
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-2 text-sm text-gray-500 italic">
                No matches
              </div>
            ) : (
              filteredOptions.map(opt => {
                const isSelected = selected.includes(opt.value);
                return (
                  <button
                    key={String(opt.value)}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => toggle(opt.value)}
                    className="w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-gray-50 transition-colors"
                  >
                    <span
                      aria-hidden="true"
                      className={`w-4 h-4 flex items-center justify-center rounded border ${
                        isSelected
                          ? 'bg-blue-600 border-blue-600 text-white'
                          : 'bg-white border-gray-300'
                      }`}
                    >
                      {isSelected && (
                        <svg viewBox="0 0 12 12" className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M2 6l3 3 5-6" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                    </span>
                    <span className={isSelected ? 'font-medium text-gray-900' : 'text-gray-700'}>
                      {opt.label}
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {hasActive && (
            <>
              <div className="border-t border-gray-100" />
              <button
                type="button"
                onClick={() => onChange([])}
                className="w-full text-left px-3 py-2 text-sm text-gray-500 hover:bg-gray-50 transition-colors rounded-b-lg"
              >
                Clear selection
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
