'use client';

import { NEUTRAL_ADJUSTMENTS } from '@/lib/media/filters';
import type { Adjustments } from '@/lib/media/types';

const SLIDERS: Array<{ key: keyof Adjustments; label: string }> = [
  { key: 'brightness', label: 'Brightness' },
  { key: 'contrast', label: 'Contrast' },
  { key: 'saturation', label: 'Saturation' },
];

interface AdjustPanelProps {
  adjustments: Adjustments;
  onChange: (adjustments: Adjustments) => void;
}

/** Three sliders → live CSS-filter preview (zero canvas per frame). */
export default function AdjustPanel({ adjustments, onChange }: AdjustPanelProps) {
  return (
    <div className="px-4 py-3 space-y-2">
      {SLIDERS.map(({ key, label }) => (
        <div key={key} className="flex items-center gap-3">
          <span className="text-chip text-white/60 w-20">{label}</span>
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={adjustments[key]}
            onChange={e => onChange({ ...adjustments, [key]: Number(e.target.value) })}
            className="flex-1 accent-blue-500 min-h-[44px]"
            aria-label={label}
          />
          <span className="text-chip text-white/60 w-10 text-right tabular-nums">
            {Math.round(adjustments[key] * 100)}
          </span>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange({ ...NEUTRAL_ADJUSTMENTS })}
        className="text-chip text-white/60 hover:text-white underline min-h-[36px]"
      >
        Reset
      </button>
    </div>
  );
}
