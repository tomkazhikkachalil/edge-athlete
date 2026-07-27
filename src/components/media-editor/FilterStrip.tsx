'use client';

import { cssFilterString, PRESET_FILTERS } from '@/lib/media/filters';

interface FilterStripProps {
  imageUrl: string;
  activeFilterId: string | null;
  onSelect: (filterId: string | null) => void;
}

/** Preset thumbnails — tiny <img>s with CSS filters; no canvas thumbnails. */
export default function FilterStrip({ imageUrl, activeFilterId, onSelect }: FilterStripProps) {
  const options: Array<{ id: string | null; label: string; filter: string }> = [
    { id: null, label: 'Original', filter: '' },
    ...PRESET_FILTERS.map(p => ({
      id: p.id as string | null,
      label: p.label,
      filter: cssFilterString(p.adjustments),
    })),
  ];

  return (
    <div className="flex gap-3 px-4 py-3 overflow-x-auto scrollbar-hide sm:justify-center">
      {options.map(option => (
        <button
          key={option.label}
          type="button"
          onClick={() => onSelect(option.id)}
          className="flex flex-col items-center gap-1 flex-shrink-0"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={`${option.label} filter preview`}
            style={option.filter ? { filter: option.filter } : undefined}
            className={`w-16 h-16 rounded-lg object-cover ${
              activeFilterId === option.id ? 'ring-2 ring-blue-500' : 'ring-1 ring-white/20'
            }`}
          />
          <span
            className={`text-chip ${activeFilterId === option.id ? 'text-white' : 'text-white/60'}`}
          >
            {option.label}
          </span>
        </button>
      ))}
    </div>
  );
}
