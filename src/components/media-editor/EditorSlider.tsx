'use client';

import { useRef } from 'react';

interface EditorSliderProps {
  label: string;
  /** UI-space value (integer, 0 = neutral). Mapping lives in slider-scale.ts. */
  value: number;
  min?: number;
  max?: number;
  onChange: (ui: number) => void;
}

/**
 * One adjustment slider. Native range input (keyboard arrows for free),
 * 44px touch target, tabular readout. Double-click / double-tap on the
 * label-or-value resets to neutral (0) — the Lightroom convention.
 */
export default function EditorSlider({ label, value, min = -100, max = 100, onChange }: EditorSliderProps) {
  const lastTapRef = useRef(0);

  const reset = () => onChange(0);
  const handleTap = () => {
    const now = Date.now();
    if (now - lastTapRef.current < 300) reset();
    lastTapRef.current = now;
  };

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={handleTap}
        onDoubleClick={reset}
        title="Double-tap to reset"
        className="text-chip text-white/60 w-24 text-left truncate"
      >
        {label}
      </button>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={e => onChange(Number(e.target.value))}
        className="flex-1 accent-violet-500 min-h-[44px]"
        aria-label={label}
      />
      <span className="text-chip text-white/60 w-10 text-right tabular-nums">
        {value > 0 && min < 0 ? `+${value}` : value}
      </span>
    </div>
  );
}
