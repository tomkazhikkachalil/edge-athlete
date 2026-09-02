// NO 'use client' on purpose (phase 6b A2): this table has no hooks or
// handlers, so it renders as a server component inside the (public) org
// segment (the courses module) and as plain markup inside client cards.

// The official scorecard: the tee-sheet table golfers know — holes across,
// Par / handicap (stroke index) rows, then one yardage row per tee in
// hardest-first order (courseTeeOptions — the conventional tee-sheet
// ordering). Renders nothing without real hole data (thin rows carry none
// until hydration; callers decide whether to fetch).
//
// Data caveats this component owns (see course-catalog normalizers):
// - yardage maps are keyed by free-text tee name and can be SPARSE
//   (GolfCourseAPI only fills tees matching the reference tee's hole count)
//   → "—" cells, never 0.
// - handicap === 0 means UNKNOWN, not stroke index 0 — same `> 0` guard the
//   trends route uses → "—".

import type { GolfCourse } from '@/types/golf';
import { courseTeeOptions, teeLabel } from '@/lib/golf/tees';

export default function CourseScorecardTable({ course }: { course: GolfCourse }) {
  const holes = [...(course.holes ?? [])].sort((a, b) => a.number - b.number);
  if (holes.length === 0) return null;
  const tees = courseTeeOptions(course).filter(tee =>
    holes.some(h => typeof h.yardage?.[tee] === 'number')
  );
  const eighteen = holes.length > 9;
  const front = eighteen ? holes.slice(0, 9) : holes;
  const back = eighteen ? holes.slice(9) : [];

  const sum = (hs: typeof holes, get: (h: (typeof holes)[number]) => number | undefined) => {
    let total = 0;
    for (const h of hs) {
      const v = get(h);
      if (typeof v !== 'number') return null; // a sparse row gets no total
      total += v;
    }
    return total;
  };

  const headCell = 'px-2 py-1.5 text-center font-bold text-secondary whitespace-nowrap';
  const cell = 'px-2 py-1.5 text-center whitespace-nowrap';

  const numberRow = (
    <tr className="border-b border-border bg-surface-sunken">
      <th scope="col" className={`${headCell} text-left sticky left-0 bg-surface-sunken`}>Hole</th>
      {front.map(h => (
        <th key={h.number} scope="col" className={headCell}>{h.number}</th>
      ))}
      <th scope="col" className={headCell}>{eighteen ? 'Out' : 'Total'}</th>
      {eighteen && (
        <>
          {back.map(h => (
            <th key={h.number} scope="col" className={headCell}>{h.number}</th>
          ))}
          <th scope="col" className={headCell}>In</th>
          <th scope="col" className={headCell}>Tot</th>
        </>
      )}
    </tr>
  );

  const statRow = (
    label: string,
    get: (h: (typeof holes)[number]) => number | undefined,
    bold = false
  ) => (
    <tr className={`border-b border-border ${bold ? 'font-bold text-primary' : 'text-secondary'}`}>
      <th scope="row" className={`${cell} text-left font-semibold sticky left-0 bg-surface`}>{label}</th>
      {front.map(h => (
        <td key={h.number} className={cell}>{get(h) ?? '—'}</td>
      ))}
      <td className={`${cell} font-bold`}>{sum(front, get) ?? '—'}</td>
      {eighteen && (
        <>
          {back.map(h => (
            <td key={h.number} className={cell}>{get(h) ?? '—'}</td>
          ))}
          <td className={`${cell} font-bold`}>{sum(back, get) ?? '—'}</td>
          <td className={`${cell} font-bold`}>{sum(holes, get) ?? '—'}</td>
        </>
      )}
    </tr>
  );

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-xs bg-surface">
        <thead>{numberRow}</thead>
        <tbody>
          {statRow('Par', h => h.par, true)}
          {statRow('HCP', h => (typeof h.handicap === 'number' && h.handicap > 0 ? h.handicap : undefined))}
          {tees.map(tee => {
            const rating = course.courseRating?.[tee];
            const slope = course.slopeRating?.[tee];
            const suffix =
              rating !== undefined || slope !== undefined
                ? ` (${[rating, slope].filter(v => v !== undefined).join(' / ')})`
                : '';
            return (
              <tr key={tee} className="border-b border-border last:border-b-0 text-secondary">
                <th scope="row" className={`${cell} text-left font-semibold sticky left-0 bg-surface whitespace-nowrap`}>
                  {teeLabel(tee)}
                  <span className="font-normal text-muted">{suffix}</span>
                </th>
                {front.map(h => (
                  <td key={h.number} className={cell}>{h.yardage?.[tee] ?? '—'}</td>
                ))}
                <td className={`${cell} font-bold`}>{sum(front, h => h.yardage?.[tee]) ?? '—'}</td>
                {eighteen && (
                  <>
                    {back.map(h => (
                      <td key={h.number} className={cell}>{h.yardage?.[tee] ?? '—'}</td>
                    ))}
                    <td className={`${cell} font-bold`}>{sum(back, h => h.yardage?.[tee]) ?? '—'}</td>
                    <td className={`${cell} font-bold`}>{sum(holes, h => h.yardage?.[tee]) ?? '—'}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
