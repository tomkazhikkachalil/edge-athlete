'use client';

import FaIcon from '@/components/FaIcon';
import { faGolfBallTee } from '@/lib/icons/fa/golf-ball-tee';
import { faPeopleArrows } from '@/lib/icons/fa/people-arrows';
import { faStar } from '@/lib/icons/fa/star';
import type { FaIconDef } from '@/lib/icons/fa-icon';

export type GolfGameFormat = 'stroke' | 'stableford' | 'match';

export const GAME_FORMAT_OPTIONS = [
  { value: 'stroke', label: 'Stroke Play', icon: faGolfBallTee },
  { value: 'stableford', label: 'Stableford', icon: faStar },
  { value: 'match', label: 'Match Play', icon: faPeopleArrows },
] as const satisfies readonly { value: GolfGameFormat; label: string; icon: FaIconDef }[];

export function gameFormatLabel(value: GolfGameFormat): string {
  return GAME_FORMAT_OPTIONS.find(o => o.value === value)?.label ?? value;
}

/**
 * Step 3 of the golf round: the game format.
 *
 * The look (Tom's part 2 spec, Nov 24 2026 — the mechanical dialect): one
 * tile per format in a three-column grid on every width, so a fourth format
 * flows onto a second row without a layout change. The icon sits top left,
 * the name bottom left; exactly one tile is the pressed one (`aria-pressed`,
 * as the three buttons were). The two help lines under the grid are gone
 * (his rule for these steps: no helper sentences).
 */
interface FormatStepProps {
  value: GolfGameFormat;
  onChange: (value: GolfGameFormat) => void;
}

export default function FormatStep({ value, onChange }: FormatStepProps) {
  return (
    <div data-round-step="format">
      <div className="flex items-center h-7 mb-2">
        <span className="ea-mech-micro" id="golf-format-label">Game format</span>
      </div>
      <div className="grid grid-cols-3 gap-2" role="group" aria-labelledby="golf-format-label" data-format-grid="">
        {GAME_FORMAT_OPTIONS.map(({ value: option, label, icon }) => (
          <button
            key={option}
            type="button"
            onClick={() => onChange(option)}
            aria-pressed={value === option}
            data-format={option}
            {...(value === option ? { 'data-selected': '' } : {})}
            className="ea-mech-tile ea-mech-press flex h-[76px] min-w-0 flex-col items-start justify-between pt-[11px] pl-[12px] pb-[10px] pr-[10px] max-[359px]:pl-[8px] max-[359px]:pr-[6px] max-[359px]:pb-[8px] text-left"
          >
            <FaIcon icon={icon} className="ea-mech-icon text-[22px]" />
            {/* Under 360 px a two-word name takes a second line instead of an ellipsis. */}
            <span className="w-full truncate text-[13px] font-semibold leading-[16px] text-[color:var(--mech-text)] max-[359px]:whitespace-normal max-[359px]:[overflow-wrap:anywhere] max-[359px]:line-clamp-2" data-format-name="">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
