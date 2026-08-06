'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

interface YearSelectProps {
  years: number[];
  value: number | null;
  onChange: (year: number | null) => void;
  allLabel?: string;
}

/**
 * Single-select year chip + popover — the working replacement for the old
 * hardcoded season chip. Renders nothing when there are no years to offer.
 */
export default function YearSelect({
  years,
  value,
  onChange,
  allLabel = 'All time',
}: YearSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

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

  if (years.length === 0) return null;

  const select = (year: number | null) => {
    onChange(year);
    setIsOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        className={`inline-flex items-center min-h-[40px] px-3 py-1 rounded-md border text-label font-bold transition-colors ${
          value !== null
            ? 'bg-brand-soft border-violet-500 text-brand-fg-strong'
            : 'bg-surface-muted border-border text-primary hover:bg-surface-sunken'
        }`}
      >
        <span>{value !== null ? String(value) : allLabel}</span>
        <ChevronDown
          className={`w-4 h-4 ml-2 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          aria-hidden="true"
        />
      </button>

      {isOpen && (
        <div
          role="listbox"
          className="absolute right-0 top-full mt-1 min-w-full w-max max-w-[80vw] bg-surface-raised border border-border rounded-lg shadow-lg z-20 max-h-60 overflow-y-auto py-1"
        >
          {[null, ...years].map(year => {
            const isSelected = value === year;
            return (
              <button
                key={year === null ? 'all' : year}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => select(year)}
                className={`w-full text-left px-4 py-2 text-sm transition-colors hover:bg-surface-muted ${
                  isSelected ? 'font-semibold text-brand-fg-strong bg-brand-soft' : 'text-secondary'
                }`}
              >
                {year === null ? allLabel : String(year)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
