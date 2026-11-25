'use client';

import { useRef, useState } from 'react';
import { CARD_STROKES_MAX, CARD_STROKES_MIN, scoreName, toneVar } from '@/lib/golf/score-card';
import { dialArcPath, dialPolar, SCORE_DIAL_CENTRE as C, SCORE_DIAL_SIZE as SIZE, SCORE_DIAL_START, scoreDialAngle, scoreDialTicks, strokesForPointer } from '@/lib/golf/score-dial';
import { MinusIcon, PlusIcon } from './icons';

/**
 * The strokes dial (Tom's live-round spec, Nov 25 2026 — C4). Three ways to
 * set the strokes: drag the hand around the dial, tap plus or minus, tap the
 * number to confirm what is shown.
 *
 *  - The scale follows the hole (score-dial.ts): 0 at −135°, DOUBLE PAR at
 *    +135°, par always at the top under the fixed white par hand; one tick
 *    per stroke. Above double par the arc stays full and the number counts on
 *    (the plus key goes to 15, what the scores API accepts).
 *  - The whole circle is the drag area: pointer events with capture and
 *    `touch-action: none`, so the page never scrolls under a drag. The
 *    pointer's angle from the centre is the value, in whole strokes.
 *  - It is a slider to assistive tech (`aria-valuemin 1`, `aria-valuemax`
 *    double par, the score's name in the value text); the arrow keys step
 *    it and a typed digit sets it.
 *  - Everything is drawn in one 190 × 190 SVG, so the dial scales with its
 *    block on a narrow phone and the numbers scale with it.
 */
interface StrokesDialProps {
  strokes: number;
  par: number;
  onChange: (strokes: number) => void;
  /** A tap on the number: the shown value is the hole's score. */
  onConfirm: () => void;
  disabled?: boolean;
}

const HAND_STROKE = { stroke: 'var(--mech-dial-hand)', strokeLinecap: 'round' } as const;

export default function StrokesDial({ strokes, par, onChange, onConfirm, disabled = false }: StrokesDialProps) {
  const dialRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const [isDragging, setIsDragging] = useState(false);
  const { name, tone } = scoreName(strokes, par);
  const colour = toneVar(tone);
  const angle = scoreDialAngle(strokes, par);
  const set = (next: number) => {
    const n = Math.min(CARD_STROKES_MAX, Math.max(CARD_STROKES_MIN, Math.round(next)));
    if (n !== strokes) onChange(n);
  };
  const fromPointer = (clientX: number, clientY: number) => {
    const el = dialRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    set(strokesForPointer(clientX - (r.left + r.width / 2), clientY - (r.top + r.height / 2), par));
  };

  return (
    <div className="relative w-full" style={{ aspectRatio: '190 / 224' }} data-strokes-dial="" {...(isDragging ? { 'data-dial-dragging': '' } : {})}>
      <span className="ea-mech-micro absolute left-0 top-0">Strokes</span>
      <svg
        ref={dialRef}
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="absolute left-0 top-0 block w-full select-none"
        style={{ touchAction: 'none', aspectRatio: '1 / 1' }}
        role="slider"
        tabIndex={disabled ? -1 : 0}
        aria-label="Strokes"
        aria-valuemin={CARD_STROKES_MIN}
        aria-valuemax={2 * par}
        aria-valuenow={strokes}
        aria-valuetext={`${strokes}, ${name}`}
        aria-disabled={disabled || undefined}
        data-dial-value={strokes}
        onPointerDown={e => {
          if (disabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragging.current = true;
          setIsDragging(true);
          fromPointer(e.clientX, e.clientY);
        }}
        onPointerMove={e => {
          if (dragging.current) fromPointer(e.clientX, e.clientY);
        }}
        onPointerUp={() => {
          dragging.current = false;
          setIsDragging(false);
        }}
        onPointerCancel={() => {
          dragging.current = false;
          setIsDragging(false);
        }}
        onKeyDown={e => {
          if (disabled) return;
          const step = e.key === 'ArrowUp' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowDown' || e.key === 'ArrowLeft' ? -1 : 0;
          if (step !== 0) {
            e.preventDefault();
            set(strokes + step);
          } else if (e.key === 'Home') {
            e.preventDefault();
            set(CARD_STROKES_MIN);
          } else if (e.key === 'End') {
            e.preventDefault();
            set(2 * par);
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onConfirm();
          } else if (/^[1-9]$/.test(e.key)) {
            // A typed digit is the score (the wheel's old contract, kept).
            e.preventDefault();
            set(Number(e.key));
          }
        }}
      >
        {/* Track, then the value arc in the score's colour. */}
        <path d={dialArcPath(C, C, 78, SCORE_DIAL_START, 135)} fill="none" stroke="var(--mech-recess)" strokeWidth={14} strokeLinecap="round" />
        {angle > SCORE_DIAL_START && (
          <path className="ea-mech-dial-arc" d={dialArcPath(C, C, 78, SCORE_DIAL_START, angle)} fill="none" stroke={colour} strokeWidth={10} strokeLinecap="round" data-dial-arc="" />
        )}
        {/* One tick per stroke, redrawn with the hole's par. */}
        {scoreDialTicks(par).map(t => {
          const a = dialPolar(C, C, 87, t.angle);
          const b = dialPolar(C, C, 93, t.angle);
          return <line key={t.value} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--mech-dial-tick)" strokeWidth={2} strokeLinecap="round" data-dial-tick={t.value} />;
        })}
        {/* The par hand: fixed at the top. */}
        <line x1={C} y1={C - 81} x2={C} y2={C - 95} strokeWidth={3} {...HAND_STROKE} data-dial-par="" />
        {/* The stroke hand: rotates about the centre. */}
        <g className="ea-mech-dial-hand" style={{ transform: `rotate(${angle}deg)` }} data-dial-hand="">
          <line x1={C} y1={C - 43} x2={C} y2={C - 78} stroke="var(--mech-surface)" strokeWidth={7} strokeLinecap="round" />
          <line x1={C} y1={C - 43} x2={C} y2={C - 78} strokeWidth={4} {...HAND_STROKE} />
          <circle cx={C} cy={C - 78} r={9} fill="var(--mech-dial-hand)" stroke="var(--mech-surface)" strokeWidth={2} />
          <circle cx={C} cy={C - 78} r={3.5} fill={colour} />
        </g>
        {/* The number and the score's name. A tap here confirms the value. */}
        <g
          onPointerDown={e => e.stopPropagation()}
          onClick={() => { if (!disabled) onConfirm(); }}
          style={{ cursor: disabled ? 'default' : 'pointer' }}
          data-dial-confirm=""
        >
          <circle cx={C} cy={C + 2} r={40} fill="transparent" />
          <text x={C} y={C + 8} textAnchor="middle" className="ea-mech-readout" style={{ fontSize: 56, fill: 'var(--mech-text)', letterSpacing: '-0.03em' }} data-dial-number="">
            {strokes}
          </text>
          <rect x={C - nameWidth(name) / 2} y={C + 18} width={nameWidth(name)} height={20} rx={10} fill={colour} opacity={0.18} />
          <text x={C} y={C + 32} textAnchor="middle" className="ea-mech-readout" style={{ fontSize: 10, fill: colour, letterSpacing: '0.12em', textTransform: 'uppercase' }} data-dial-name="">
            {name}
          </text>
        </g>
        <text x={C} y={SIZE - 8} textAnchor="middle" className="ea-mech-micro" style={{ fontSize: 10, fill: 'var(--mech-label)' }}>
          {`PAR ${par}`}
        </text>
      </svg>
      {/* The keys sit above the dial, at the block's bottom corners. */}
      <button
        type="button"
        onClick={() => set(strokes - 1)}
        disabled={disabled || strokes <= CARD_STROKES_MIN}
        aria-label="One stroke fewer"
        data-strokes-minus=""
        className="ea-mech-round absolute bottom-0 left-0 inline-flex h-[56px] w-[56px] items-center justify-center max-[359px]:h-[48px] max-[359px]:w-[48px]"
      >
        <MinusIcon size={22} />
      </button>
      <button
        type="button"
        onClick={() => set(strokes + 1)}
        disabled={disabled || strokes >= CARD_STROKES_MAX}
        aria-label="One stroke more"
        data-strokes-plus=""
        className="ea-mech-round absolute bottom-0 right-0 inline-flex h-[56px] w-[56px] items-center justify-center max-[359px]:h-[48px] max-[359px]:w-[48px]"
      >
        <PlusIcon size={22} />
      </button>
    </div>
  );
}

/** The pill's width for a name in the 10 px mono face (0.12em tracking), 10 px padding each side. */
function nameWidth(name: string): number {
  return Math.round(name.length * 7.3 + 20);
}
