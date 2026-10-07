'use client';

import { useState } from 'react';
import { COPY } from '@/lib/copy';
import { toParColorClass, toParLabel } from '@/lib/golf/scoring';
import { formatRise } from '@/lib/golf/elevation';
import type { HoleHeaderFacts, LiveLine, TeeRow } from '@/lib/golf/hole-detail';
import type { HoleProjection, ProjectedPoint } from '@/lib/golf/hole-svg';

// ── The hole in front of you (hole-detail program PR E, Oct 2026) ───────────
// Replaces the scorer's "Hole N · course · Par P · Y yds" line. Phone-first
// and short (≈120 px) so both wheels stay above the fold at 375×667:
//   row A  "Hole 7"  (the big number — the e2e idiom `/^Hole N\b/` stays
//          unambiguous: row B starts at "Par")        + the thumbnail, right
//   row B  "Par 4 · HCP 11 · 388 yds · White ▾"  (the tee chip opens an
//          INLINE list of every tee — never a new z-layer)
//   row C  "196 yds to green · plays like ≈203 (↑ 7 yd)"  — from a GPS fix
//          when the map has one, else "Tee → green 388 yds · …"; the
//          plays-like part only with an elevation profile; the row only with
//          a line
//   row D  "You E thru 6 · Sam 5 · Alex 4"  — the running to-par and the
//          others' scores on this hole
// No `whitespace-nowrap` anywhere here: at 320 px the rows wrap, never grow.

export interface HoleHeaderProps {
  holeNumber: number;
  facts: HoleHeaderFacts;
  tees: TeeRow[];
  live: LiveLine;
  running: { toPar: number; thru: number } | null;
  /** The label for the card's owner on row D: "You", or a first name. */
  runningLabel: string;
  group: Array<{ label: string; strokes: number }>;
  thumb: (HoleProjection & { player: ProjectedPoint | null }) | null;
  onOpenMap?: () => void;
}

export default function HoleHeader({ holeNumber, facts, tees, live, running, runningLabel, group, thumb, onOpenMap }: HoleHeaderProps) {
  const [teesOpen, setTeesOpen] = useState(false);
  const rise = formatRise(live.riseYds);
  const factBits: string[] = [];
  if (facts.par != null) factBits.push(`Par ${facts.par}`);
  if (facts.hcp != null) factBits.push(`HCP ${facts.hcp}`);
  if (facts.yards != null) factBits.push(`${facts.approx ? '≈' : ''}${facts.yards} yds`);

  return (
    <div className="mb-4 grid grid-cols-[minmax(0,1fr)_auto] gap-3 items-start" data-hole-header="">
      <div className="min-w-0">
        <div className="text-4xl font-black text-green-900 dark:text-green-100 leading-none mb-2">
          Hole {holeNumber}
        </div>
        <div className="text-sm text-secondary break-words" data-hole-facts="">
          {factBits.join(' · ')}
          {facts.teeLabel && (
            tees.length > 0 ? (
              <button
                type="button"
                onClick={() => setTeesOpen(o => !o)}
                aria-expanded={teesOpen}
                data-hole-tee-toggle=""
                className="ml-1 inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-1 -my-1 min-h-[44px] sm:min-h-0 font-semibold text-primary ea-interactive"
              >
                {factBits.length > 0 && <span aria-hidden="true">·</span>}
                {facts.teeLabel}
                <i className={`fas fa-chevron-${teesOpen ? 'up' : 'down'} text-[10px]`} aria-hidden="true"></i>
              </button>
            ) : (
              <span className="ml-1">· {facts.teeLabel}</span>
            )
          )}
        </div>
        {teesOpen && tees.length > 0 && (
          <ul className="mt-2 rounded-lg border border-border bg-surface-muted divide-y divide-border text-sm" data-hole-tees="">
            {tees.map(t => (
              <li key={t.key} className={`flex items-center justify-between gap-3 px-3 py-2 ${t.inPlay ? 'font-bold text-primary' : 'text-secondary'}`}>
                <span>{t.label}{t.inPlay ? ` · ${COPY.GOLF_HOLE.TEE_IN_PLAY}` : ''}</span>
                <span className="tabular-nums">
                  {t.yards} yds
                  {t.rating != null && t.slope != null && <span className="text-tertiary"> · {t.rating} / {t.slope}</span>}
                </span>
              </li>
            ))}
          </ul>
        )}
        {live.kind !== 'none' && live.toGreen != null && (
          <div className="mt-1 text-sm font-semibold text-primary break-words" aria-live="polite" data-hole-plays-like={live.kind}>
            {live.kind === 'gps' ? COPY.GOLF_HOLE.TO_GREEN(live.toGreen) : COPY.GOLF_HOLE.TEE_TO_GREEN(live.toGreen)}
            {live.playsLike != null && (
              <span className="text-secondary"> · {COPY.GOLF_HOLE.PLAYS_LIKE(live.playsLike)}{rise ? ` (${rise})` : ''}</span>
            )}
          </div>
        )}
        {(running || group.length > 0) && (
          <div className="mt-1 text-xs text-tertiary break-words" data-hole-group="">
            {running && (
              <span>
                {runningLabel} <span className={`font-bold ${toParColorClass(running.toPar)}`}>{toParLabel(running.toPar)}</span> {COPY.GOLF_HOLE.THRU(running.thru)}
              </span>
            )}
            {group.map(g => (
              <span key={g.label}> · {g.label} <span className="font-bold text-primary">{g.strokes}</span></span>
            ))}
          </div>
        )}
      </div>
      {thumb && (
        <button
          type="button"
          onClick={onOpenMap}
          disabled={!onOpenMap}
          aria-label={COPY.GOLF_HOLE.OPEN_MAP_ON(holeNumber)}
          data-hole-thumb=""
          className="shrink-0 rounded-lg border border-border bg-surface-muted ea-interactive min-w-[44px] min-h-[44px] p-1 disabled:opacity-100"
        >
          <svg viewBox={thumb.viewBox} width={56} height={56} aria-hidden="true">
            <path d={thumb.paths[0]} fill="none" stroke="currentColor" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" className="text-green-700 dark:text-green-300" />
            <circle cx={thumb.tee[0].x} cy={thumb.tee[0].y} r={4} className="fill-current text-tertiary" />
            <circle cx={thumb.green[0].x} cy={thumb.green[0].y} r={5} className="fill-current text-green-600 dark:text-green-400" />
            {thumb.player && <circle cx={thumb.player.x} cy={thumb.player.y} r={5} className="fill-current text-blue-600 dark:text-blue-400" />}
          </svg>
        </button>
      )}
    </div>
  );
}
