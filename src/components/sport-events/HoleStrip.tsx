'use client';

import { classifyScore, SCORE_CELL_RING } from '@/lib/golf/scoring';
import type { BreakdownHole } from '@/lib/sport-events/breakdown';

/**
 * One card as a strip (Events program, phase 2): the holes across, par
 * under, the score in the house ring classes (a birdie violet, a bogey
 * red), OUT / IN / TOTAL where the round covers a nine. Scrolls sideways
 * on a phone; the read-only scorecard idiom (GolfRoundCard), one row.
 */
interface Props {
  holes: ReadonlyArray<BreakdownHole>;
  pars: ReadonlyArray<{ hole: number; par: number }>;
  label?: string;
}

export default function HoleStrip({ holes, pars, label }: Props) {
  const byHole = new Map<number, number | null>();
  for (const h of holes) byHole.set(h.hole_number, typeof h.strokes === 'number' && h.strokes > 0 ? h.strokes : null);
  const front = pars.filter(p => p.hole <= 9);
  const back = pars.filter(p => p.hole > 9);
  const sum = (list: ReadonlyArray<{ hole: number; par: number }>, of: 'par' | 'score') => list.reduce((acc, p) => acc + (of === 'par' ? p.par : byHole.get(p.hole) ?? 0), 0);
  const scoredIn = (list: ReadonlyArray<{ hole: number }>) => list.some(p => (byHole.get(p.hole) ?? null) !== null);
  const cell = (p: { hole: number; par: number }) => {
    const s = byHole.get(p.hole) ?? null;
    const cls = s === null ? null : classifyScore(s, p.par);
    const ring = cls ? SCORE_CELL_RING[cls] : null;
    return (
      <td key={p.hole} className="text-center py-1 px-0.5">
        <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs ${ring ? `${ring.ring} ${ring.text}` : 'text-muted'}`} data-hole-score={p.hole}>{s ?? '·'}</span>
      </td>
    );
  };
  const totalCell = (list: ReadonlyArray<{ hole: number; par: number }>, of: 'par' | 'score', title: string) => (
    <td key={title} className="text-center py-1 px-1 font-bold text-primary bg-surface-sunken tabular-nums text-xs" title={title}>{of === 'score' && !scoredIn(list) ? '—' : sum(list, of)}</td>
  );
  return (
    <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0" data-hole-strip="">
      {label && <p className="text-xs font-semibold text-secondary mb-1">{label}</p>}
      <table className="text-xs min-w-max">
        <thead>
          <tr className="text-muted">
            <th scope="row" className="text-left pr-2 font-semibold">Hole</th>
            {front.map(p => <th key={p.hole} className="px-0.5 font-semibold w-8">{p.hole}</th>)}
            {front.length > 0 && <th className="px-1 font-bold bg-surface-sunken">OUT</th>}
            {back.map(p => <th key={p.hole} className="px-0.5 font-semibold w-8">{p.hole}</th>)}
            {back.length > 0 && <th className="px-1 font-bold bg-surface-sunken">IN</th>}
            {front.length > 0 && back.length > 0 && <th className="px-1 font-bold bg-surface-sunken">TOT</th>}
          </tr>
        </thead>
        <tbody>
          <tr className="text-secondary">
            <th scope="row" className="text-left pr-2 font-semibold">Par</th>
            {front.map(p => <td key={p.hole} className="text-center tabular-nums">{p.par}</td>)}
            {front.length > 0 && totalCell(front, 'par', 'Front nine par')}
            {back.map(p => <td key={p.hole} className="text-center tabular-nums">{p.par}</td>)}
            {back.length > 0 && totalCell(back, 'par', 'Back nine par')}
            {front.length > 0 && back.length > 0 && totalCell(pars, 'par', 'Par')}
          </tr>
          <tr>
            <th scope="row" className="text-left pr-2 font-semibold text-primary">Score</th>
            {front.map(cell)}
            {front.length > 0 && totalCell(front, 'score', 'Front nine')}
            {back.map(cell)}
            {back.length > 0 && totalCell(back, 'score', 'Back nine')}
            {front.length > 0 && back.length > 0 && totalCell(pars, 'score', 'Total')}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
