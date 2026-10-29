'use client';

import { GOLF_LABEL } from '@/components/golf/golf-form-styles';

export type GolfGameFormat = 'stroke' | 'stableford' | 'match';

export const GAME_FORMAT_OPTIONS = [
  { value: 'stroke', label: 'Stroke Play', icon: 'fa-golf-ball' },
  { value: 'stableford', label: 'Stableford', icon: 'fa-star' },
  { value: 'match', label: 'Match Play', icon: 'fa-people-arrows' },
] as const satisfies readonly { value: GolfGameFormat; label: string; icon: string }[];

export function gameFormatLabel(value: GolfGameFormat): string {
  return GAME_FORMAT_OPTIONS.find(o => o.value === value)?.label ?? value;
}

/**
 * Step 3 of the golf round: the game format, unchanged from the one-page
 * form — the three options and their two help lines, on a screen of their own.
 */
interface FormatStepProps {
  value: GolfGameFormat;
  onChange: (value: GolfGameFormat) => void;
}

export default function FormatStep({ value, onChange }: FormatStepProps) {
  return (
    <div data-round-step="format">
      <label className={GOLF_LABEL}>Game Format</label>
      {/* Stacks on phones — three ~100px columns wrap the two-word labels
          badly at 360px */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
        {GAME_FORMAT_OPTIONS.map(({ value: option, label, icon }) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={value === option}
            className={`px-3 py-3 min-h-[44px] rounded-lg font-semibold text-sm transition-all ${
              value === option
                ? 'bg-green-600 text-white'
                : 'bg-surface text-secondary border-2 border-border-strong hover:border-green-300 dark:hover:border-green-700'
            }`}
          >
            <i className={`fas ${icon} mr-1.5`} aria-hidden="true"></i>
            {label}
          </button>
        ))}
      </div>
      {value === 'stableford' && (
        <p className="mt-2 text-xs text-tertiary">
          Points per hole — eagle 4, birdie 3, par 2, bogey 1. Highest points wins.
        </p>
      )}
      {value === 'match' && (
        <p className="mt-2 text-xs text-tertiary">
          Head-to-head holes won — best with exactly 2 players. Scores are still recorded per hole.
        </p>
      )}
    </div>
  );
}
