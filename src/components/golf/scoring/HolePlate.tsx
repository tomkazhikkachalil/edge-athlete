'use client';

import dynamic from 'next/dynamic';
import { useState } from 'react';
import { COPY } from '@/lib/copy';
import { greenLabel, type HoleHeaderFacts, type LiveLine, type TeeRow } from '@/lib/golf/hole-detail';
import { formatRise } from '@/lib/golf/elevation';
import { teeDotColour } from '@/lib/golf/tees';
import { ChevronDownIcon } from './icons';

// Leaflet loads only when a preview actually renders (the bundle guard).
const HoleMapPreviewInner = dynamic(() => import('./HoleMapPreviewInner'), {
  ssr: false,
  loading: () => <div className="h-full w-full" style={{ background: 'var(--mech-recess)' }} />,
});

/**
 * The hole plate (Tom's live-round spec, Nov 25 2026 — C3). Three parts:
 * the hole NUMBER; the readouts (Par, Hcp, Yds), the tee viewer, "Plays
 * like" and the course; the map preview.
 *
 *  - The tee control is the viewer it always was (Tom, Nov 25 2026): a tap
 *    lists every tee's yards and rating for this hole. It changes and saves
 *    nothing — the tee in play is the one chosen when the round was set up.
 *  - The "Tee → green N yds" words are gone (the yards are in the readouts);
 *    a GPS fix still says how far the green is, and "plays like" stays.
 *  - The preview is a real, still crop of the map for this hole; the tile is
 *    the button that opens the map on it. A hole with nothing to show on a
 *    map (no line, no course position) gets no preview.
 */
interface HolePlateProps {
  holeNumber: number;
  facts: HoleHeaderFacts;
  tees: TeeRow[];
  teeInPlay: string | null;
  live: LiveLine;
  courseName: string | null;
  /** The hole's line of play, tee first. */
  line: ReadonlyArray<readonly [number, number]> | null;
  /** The course's position, for a hole without a line. */
  courseAt: readonly [number, number] | null;
  onOpenMap?: () => void;
}

function Readout({ label, value, hook }: { label: string; value: string; hook?: string }) {
  return (
    <div className="flex min-w-0 flex-col" data-hole-readout={hook}>
      <span className="ea-mech-micro">{label}</span>
      <span className="ea-mech-readout text-base leading-5">{value}</span>
    </div>
  );
}

export default function HolePlate({ holeNumber, facts, tees, teeInPlay, live, courseName, line, courseAt, onOpenMap }: HolePlateProps) {
  const [teesOpen, setTeesOpen] = useState(false);
  const rise = formatRise(live.riseYds);
  const diff = live.playsLike != null && live.toGreen != null ? live.playsLike - live.toGreen : null;
  // From where the player stands: the hole's green, or the nearest one on a greens-only course.
  const fromFix = live.kind === 'gps' || live.kind === 'nearest';
  const hasMap = (!!line && line.length >= 2) || !!courseAt;

  return (
    <div className="ea-mech-panel rounded-2xl p-3" data-hole-header="">
      <div className="flex items-stretch gap-3.5 max-[359px]:gap-2.5">
        <div className="flex shrink-0 flex-col justify-center">
          <span className="ea-mech-micro">Hole</span>
          <span className="ea-mech-readout text-[44px] leading-[44px] max-[359px]:text-[36px] max-[359px]:leading-[36px]" style={{ letterSpacing: '-0.04em' }} data-hole-number="">{holeNumber}</span>
        </div>

        <div className="flex min-w-0 flex-1 flex-col justify-center gap-1">
          <div className="flex flex-wrap items-end gap-x-3 gap-y-1" data-hole-facts="">
            {facts.par != null && <Readout label="Par" value={`${facts.par}${facts.parEstimated ? '*' : ''}`} hook="par" />}
            {facts.hcp != null && <Readout label="Hcp" value={String(facts.hcp)} hook="hcp" />}
            {facts.yards != null && <Readout label="Yds" value={`${facts.approx ? '≈' : ''}${facts.yards}`} hook="yds" />}
            {facts.teeLabel && (
              tees.length > 0 ? (
                <button
                  type="button"
                  onClick={() => setTeesOpen(o => !o)}
                  aria-expanded={teesOpen}
                  aria-label={`Tee: ${facts.teeLabel}. Show every tee for this hole`}
                  data-hole-tee-toggle=""
                  className="ea-mech-btn relative ml-auto flex min-w-0 flex-col items-start rounded-lg text-left before:absolute before:-inset-2 before:content-['']"
                >
                  <span className="ea-mech-micro inline-flex items-center gap-1.5">
                    Tee
                    <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: teeDotColour(teeInPlay ?? facts.teeLabel) ?? 'var(--mech-label)', boxShadow: '0 0 0 1px var(--mech-dot-ring)' }} />
                  </span>
                  <span className="inline-flex max-w-full items-center gap-1 text-sm font-semibold text-[color:var(--mech-text)]">
                    <span className="truncate">{facts.teeLabel}</span>
                    <ChevronDownIcon size={12} className={`shrink-0 text-[color:var(--mech-label)] transition-transform ${teesOpen ? 'rotate-180' : ''}`} />
                  </span>
                </button>
              ) : (
                <div className="ml-auto flex min-w-0 flex-col">
                  <span className="ea-mech-micro">Tee</span>
                  <span className="truncate text-sm font-semibold text-[color:var(--mech-text)]">{facts.teeLabel}</span>
                </div>
              )
            )}
          </div>
          {live.kind !== 'none' && live.toGreen != null && (fromFix || live.playsLike != null) && (
            <p
              className="text-xs leading-4 text-[color:var(--mech-text-soft)]"
              aria-live="polite"
              data-hole-plays-like={live.kind}
              data-green-fcb={fromFix && live.front != null && live.back != null ? '' : undefined}
            >
              {/* A GPS fix says how far the green is; the tee's own yards are in the readouts above. */}
              {fromFix && <span className="text-[color:var(--mech-text)]">{greenLabel(live)}</span>}
              {fromFix && live.playsLike != null && ' · '}
              {live.playsLike != null && (
                <>
                  {fromFix ? COPY.GOLF_HOLE.PLAYS_LIKE_WORD : 'Plays like'}{' '}
                  <span className="ea-mech-readout" data-plays-like-yards="">{live.playsLike}</span>
                  {diff != null && diff !== 0 && (
                    <span className="ea-mech-readout font-medium" style={{ color: 'var(--mech-danger)', fontWeight: 500 }} data-plays-like-delta=""> {diff > 0 ? `+${diff}` : diff}</span>
                  )}
                  {rise && <span className="sr-only"> ({rise})</span>}
                </>
              )}
            </p>
          )}
          {courseName && <p className="ea-mech-micro truncate" data-hole-course="">{courseName}</p>}
        </div>

        {hasMap && (
          <button
            type="button"
            onClick={onOpenMap}
            disabled={!onOpenMap}
            aria-label={COPY.GOLF_HOLE.OPEN_MAP_ON(holeNumber)}
            title="Satellite imagery © Esri · hole lines © OpenStreetMap contributors"
            data-hole-thumb=""
            className="ea-mech-recess ea-mech-btn flex w-[76px] shrink-0 flex-col items-center justify-center gap-1 self-center rounded-xl py-1.5 disabled:opacity-100 max-[359px]:w-[64px]"
          >
            <span className="block h-[58px] w-[64px] overflow-hidden rounded-lg max-[359px]:h-[48px] max-[359px]:w-[52px]">
              <HoleMapPreviewInner line={line} fallback={courseAt} />
            </span>
            <span className="ea-mech-micro !text-[9px]">Map</span>
          </button>
        )}
      </div>

      {teesOpen && tees.length > 0 && (
        <ul className="ea-mech-recess mt-2.5 overflow-hidden rounded-xl text-[13px]" data-hole-tees="">
          {tees.map((t, i) => (
            <li key={t.key} className={`flex items-center justify-between gap-3 px-3 py-2 ${t.inPlay ? 'font-semibold text-[color:var(--mech-text)]' : 'text-[color:var(--mech-text-soft)]'}`} style={i > 0 ? { borderTop: '1px solid var(--mech-divider)' } : undefined}>
              <span className="min-w-0 truncate">{t.label}{t.inPlay ? ` · ${COPY.GOLF_HOLE.TEE_IN_PLAY}` : ''}</span>
              <span className="ea-mech-readout shrink-0 !text-inherit">
                {t.yards} yds
                {t.rating != null && t.slope != null && <span className="font-medium"> · {t.rating} / {t.slope}</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
