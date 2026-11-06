'use client';

/**
 * The Crop tab's geometry row (Nov 6 2026): ONE slider with a chooser of
 * what it turns — Straighten · Vertical · Horizontal — the way iOS Photos
 * keeps the keystone dials inside its crop tool. Perspective used to be the
 * editor's seventh tab for these two sliders.
 *
 * Straighten belongs to the crop stages (the box is refitted as the picture
 * tilts); Vertical / Horizontal belong to the engine preview (the warp
 * applies to the FRAMED picture), so the modal swaps the stage when the
 * axis changes. This row only draws; the owner decides what the value does.
 */

import { signedToUi } from '@/lib/media/slider-scale';

export type GeometryAxis = 'straighten' | 'vertical' | 'horizontal';

const AXES: Array<{ id: GeometryAxis; label: string }> = [
  { id: 'straighten', label: 'Straighten' },
  { id: 'vertical', label: 'Vertical' },
  { id: 'horizontal', label: 'Horizontal' },
];

interface GeometryRowProps {
  axis: GeometryAxis;
  onAxisChange: (axis: GeometryAxis) => void;
  /** False hides the chooser (a surface whose tools exclude 'perspective'). */
  offersPerspective: boolean;
  /** Straighten: degrees (−45..45). Vertical / Horizontal: the recipe's
   *  −1..1 value — shown as ±100 like every other editor slider. */
  value: number;
  /** Receives degrees for Straighten, the −1..1 value otherwise. */
  onValueChange: (value: number) => void;
}

export default function GeometryRow({
  axis,
  onAxisChange,
  offersPerspective,
  value,
  onValueChange,
}: GeometryRowProps) {
  const straighten = axis === 'straighten';
  const ui = straighten ? value : signedToUi(value);
  return (
    <div className="px-4 pb-3 w-full max-w-xl mx-auto space-y-1">
      {offersPerspective && (
        <div className="flex items-center gap-2">
          {AXES.map(a => (
            <button
              key={a.id}
              type="button"
              onClick={() => onAxisChange(a.id)}
              aria-pressed={axis === a.id}
              className={`px-3 min-h-[36px] rounded-full text-chip transition-colors whitespace-nowrap ${
                axis === a.id ? 'bg-white/20 text-white font-semibold' : 'text-white/60 hover:text-white'
              }`}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center gap-3">
        {!offersPerspective && <span className="text-chip text-white/60 w-16">Straighten</span>}
        <input
          type="range"
          min={straighten ? -45 : -100}
          max={straighten ? 45 : 100}
          step={straighten ? 0.5 : 1}
          value={ui}
          onChange={e => {
            const next = Number(e.target.value);
            onValueChange(straighten ? next : next / 100);
          }}
          className="flex-1 accent-violet-500 min-h-[44px]"
          aria-label={straighten ? 'Straighten angle' : axis === 'vertical' ? 'Vertical' : 'Horizontal'}
        />
        <span className="text-chip text-white/60 w-10 text-right tabular-nums">
          {straighten ? `${value.toFixed(1)}°` : ui > 0 ? `+${ui}` : ui}
        </span>
      </div>
    </div>
  );
}
