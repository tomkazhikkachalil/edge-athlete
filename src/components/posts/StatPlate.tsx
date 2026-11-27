'use client';

import { useUnitSystem } from '@/hooks/useUnitSystem';
import { readingFor, type HoleTone, type PlateTone, type StatPlateData } from '@/lib/posts/attachment';

/**
 * The stat plate (Tom's General post spec, Nov 26 2026 — D4, A2): a post's
 * attached activity on the feed card and in the composer's preview. The
 * headline number in the sport's colour, a unit where there is one; beside
 * it the sport, the activity's name and one line of detail; a golf round
 * kept hole by hole also draws a block per hole on the live round's score
 * scale.
 *
 * It wears the mechanical dialect on its own (`ea-mech`): the feed card
 * around it keeps the house look, and the score tones resolve here. A
 * distance reads in the viewer's unit.
 */
const TONE_COLOUR: Record<Exclude<PlateTone, 'sport'>, string> = {
  golf: 'var(--mech-good)',
  strength: 'var(--mech-danger)',
  run: 'var(--mech-media)',
};

const HOLE_COLOUR: Record<HoleTone, string> = {
  great: 'var(--mech-great)',
  good: 'var(--mech-good)',
  text: 'var(--mech-text)',
  warn: 'var(--mech-warn)',
  bad: 'var(--mech-bad)',
  none: 'var(--mech-progress-empty)',
};

const HOLE_WORD: Record<HoleTone, string> = { great: 'eagle or better', good: 'par or better', text: 'bogey', warn: 'double bogey', bad: 'triple bogey or worse', none: 'not recorded' };

export function plateColour(plate: Pick<StatPlateData, 'tone' | 'colour'>): string {
  return plate.tone === 'sport' ? plate.colour ?? 'var(--mech-accent-light)' : TONE_COLOUR[plate.tone];
}

/** The plate's colour for SMALL text (the sport's name): the `-text` twin of
 *  a signal colour; a sport's own colour is not a text colour, so the accent. */
const TONE_TEXT: Record<string, string> = {
  golf: 'var(--mech-good-text)',
  strength: 'var(--mech-danger-text)',
  run: 'var(--mech-media-text)',
};
function plateTextColour(plate: StatPlateData): string {
  return plate.tone === 'sport' ? 'var(--mech-accent-light)' : TONE_TEXT[plate.tone] ?? 'var(--mech-accent-light)';
}

export default function StatPlate({ plate, className = '' }: { plate: StatPlateData; className?: string }) {
  const { sys } = useUnitSystem();
  const reading = readingFor(plate, sys === 'imperial' ? 'mi' : 'km');
  const colour = plateColour(plate);
  return (
    <div className={`ea-mech ${className}`} data-stat-plate={plate.kind}>
      <div className="ea-mech-recess rounded-[14px] px-3.5 py-3" style={{ borderLeft: `3px solid ${colour}` }}>
        <div className="flex min-w-0 items-center gap-3.5">
          <p className="flex shrink-0 items-baseline gap-1" data-stat-plate-headline="">
            <span className="ea-mech-readout text-[38px] leading-[42px] max-[359px]:text-[30px] max-[359px]:leading-[34px]" style={{ color: colour }}>{reading.headline}</span>
            {reading.unit && <span className="text-sm font-medium text-[color:var(--mech-text-soft)]">{reading.unit}</span>}
          </p>
          <div className="min-w-0 flex-1">
            <p className="ea-mech-micro truncate" style={{ color: plateTextColour(plate) }}>{plate.sport}</p>
            <p className="truncate text-sm font-semibold text-[color:var(--mech-text)]" data-stat-plate-name="">{plate.name}</p>
            {reading.detail && <p className="truncate text-xs text-[color:var(--mech-text-soft)]" data-stat-plate-detail="">{reading.detail}</p>}
          </div>
        </div>
        {plate.holes && (
          <ol className="mt-2.5 flex gap-0.5" aria-label="Score by hole" data-stat-plate-holes={plate.holes.length}>
            {plate.holes.map((tone, i) => (
              <li key={i} className="h-2 min-w-0 flex-1 rounded-[2px]" style={{ backgroundColor: HOLE_COLOUR[tone] }} data-hole-tone={tone}>
                <span className="sr-only">Hole {i + 1}: {HOLE_WORD[tone]}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
