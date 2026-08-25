'use client';

import { cssFilterString, PRESET_FILTERS } from '@/lib/media/filters';
import { uiToUnsigned, unsignedToUi } from '@/lib/media/slider-scale';
import EditorSlider from './EditorSlider';

interface FilterStripProps {
  imageUrl: string;
  activeFilterId: string | null;
  /** 0..1 preset intensity; the slider appears when a filter is active. */
  filterStrength: number;
  onSelect: (filterId: string | null) => void;
  onStrengthChange: (strength: number) => void;
}

/** Preset thumbnails — tiny <img>s with CSS filters; no canvas thumbnails. */
export default function FilterStrip({
  imageUrl,
  activeFilterId,
  filterStrength,
  onSelect,
  onStrengthChange,
}: FilterStripProps) {
  const options: Array<{ id: string | null; label: string; filter: string }> = [
    { id: null, label: 'Original', filter: '' },
    ...PRESET_FILTERS.map(p => ({
      id: p.id as string | null,
      label: p.label,
      filter: cssFilterString(p.adjustments),
    })),
  ];

  return (
    <div className="w-full">
      {activeFilterId !== null && (
        <div className="px-4 pt-2 w-full max-w-xl mx-auto">
          <EditorSlider
            label="Intensity"
            value={unsignedToUi(filterStrength)}
            min={0}
            onChange={ui => onStrengthChange(uiToUnsigned(ui))}
          />
        </div>
      )}
      <div className="flex gap-3 px-4 py-3 overflow-x-auto scrollbar-hide sm:justify-center">
        {options.map(option => (
          <button
            key={option.label}
            type="button"
            onClick={() => onSelect(option.id)}
            className="flex flex-col items-center gap-1 flex-shrink-0"
          >
            {/* Raw <img>: blob: object URL the optimizer cannot fetch, and
                the CSS style={{filter}} below IS the preset preview — it
                must reach the element verbatim. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={`${option.label} filter preview`}
              style={option.filter ? { filter: option.filter } : undefined}
              className={`w-16 h-16 rounded-lg object-cover ${
                activeFilterId === option.id ? 'ring-2 ring-violet-500' : 'ring-1 ring-white/20'
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
    </div>
  );
}
