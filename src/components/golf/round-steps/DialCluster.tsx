'use client';

import {
  DIAL_SCALES,
  DIAL_SWEEP_START,
  dialAngle,
  dialPoint,
  dialReadout,
  type DialKind,
} from '@/lib/golf/dial';

/**
 * The dial cluster (the mechanical dialect, Nov 23 2026): the picked
 * course's three numbers as instruments — Yards, Rating, Slope — under a
 * strip that names the holes and the par. The needles follow the tee in
 * play (dial.ts: linear, clamped); with no value a needle rests at the
 * start and its readout is a dash. Decorative as a drawing: the readouts
 * under the dials are the text a reader gets.
 */
interface DialClusterProps {
  holes: number | null;
  par: number | null;
  /** Some pars are estimated from the hole's length: the strip says "est.". */
  parEstimated?: boolean;
  yards: number | null;
  rating: number | null;
  slope: number | null;
  /** The yardage is the map's (a course with no card): "≈" before the number. */
  yardsApprox?: boolean;
  /** The strip names the holes. Off for an indoor round (Nov 27 2026): the
   *  count is worked out from the holes played, so the strip says only Par. */
  showHoles?: boolean;
}

const CX = 54;
const CY = 50;
const TICKS = Array.from({ length: 19 }, (_, i) => DIAL_SWEEP_START + i * 15);
const END_FROM = dialPoint(CX, CY, 47, 90);
const END_TO = dialPoint(CX, CY, 47, 135);

const UNIT: Record<DialKind, string> = { yards: 'Yards', rating: 'Rating', slope: 'Slope' };

function Dial({ kind, value, approx = false }: { kind: DialKind; value: number | null; approx?: boolean }) {
  const angle = dialAngle(value, DIAL_SCALES[kind]);
  return (
    <div className="flex flex-col items-center min-w-0" data-dial={kind} data-dial-angle={Math.round(angle)}>
      <svg viewBox="0 0 108 84" className="w-full max-w-[108px] h-auto" aria-hidden="true" focusable="false">
        {TICKS.map(deg => {
          const major = (deg - DIAL_SWEEP_START) % 45 === 0;
          const a = dialPoint(CX, CY, major ? 35 : 40, deg);
          const b = dialPoint(CX, CY, 44, deg);
          return (
            <line
              key={deg}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={major ? 'var(--mech-text-soft)' : 'var(--mech-tick)'}
              strokeWidth={major ? 1.5 : 1}
              strokeLinecap="round"
            />
          );
        })}
        {/* The end zone: the last eighth of the sweep. */}
        <path
          d={`M ${END_FROM.x} ${END_FROM.y} A 47 47 0 0 1 ${END_TO.x} ${END_TO.y}`}
          fill="none"
          stroke="var(--mech-progress-current)"
          strokeWidth={2}
          strokeLinecap="round"
        />
        <line
          x1={CX}
          y1={CY + 8}
          x2={CX}
          y2={CY - 36}
          stroke="var(--mech-accent-light)"
          strokeWidth={2}
          strokeLinecap="round"
          style={{
            transform: `rotate(${angle}deg)`,
            transformOrigin: `${CX}px ${CY}px`,
            transition: 'transform 560ms var(--mech-spring)',
          }}
          data-dial-needle=""
        />
        <circle cx={CX} cy={CY} r={5} fill="var(--mech-progress-empty)" stroke="var(--mech-chevron)" strokeWidth={1} />
      </svg>
      <span className="ea-mech-readout text-base leading-5" data-dial-readout="">
        {approx && value !== null ? '≈' : ''}{dialReadout(kind, value)}
      </span>
      <span className="ea-mech-micro">{UNIT[kind]}</span>
    </div>
  );
}

function Bolt() {
  return (
    <span
      aria-hidden="true"
      className="inline-block w-[7px] h-[7px] rounded-full shrink-0"
      style={{ backgroundColor: 'var(--mech-progress-empty)', border: '1px solid var(--mech-tick)' }}
    />
  );
}

export default function DialCluster({ holes, par, parEstimated = false, yards, rating, slope, yardsApprox = false, showHoles = true }: DialClusterProps) {
  return (
    <div className="ea-mech-panel rounded-2xl pt-2.5 px-2 pb-3" data-dial-cluster="">
      <div className="flex items-center gap-2 px-1 mb-1.5">
        <Bolt />
        {showHoles && (
          <span className="ea-mech-micro whitespace-nowrap" data-dial-holes="">{holes != null ? `${holes} holes` : 'Holes —'}</span>
        )}
        <span aria-hidden="true" className="flex-1 h-px" style={{ backgroundColor: 'var(--mech-hairline)' }} />
        <span className="ea-mech-micro whitespace-nowrap" data-dial-par="">
          {par != null ? `Par ${par}${parEstimated ? ' est.' : ''}` : 'Par —'}
        </span>
        <Bolt />
      </div>
      <div className="grid grid-cols-3 gap-1">
        <Dial kind="yards" value={yards} approx={yardsApprox} />
        <Dial kind="rating" value={rating} />
        <Dial kind="slope" value={slope} />
      </div>
    </div>
  );
}
