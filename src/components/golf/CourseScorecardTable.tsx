// NO 'use client' on purpose (phase 6b A2): this table has no hooks or
// handlers, so it renders as a server component inside the (public) org
// segment (the courses module) and as plain markup inside client cards.

// The official scorecard: the tee-sheet table golfers know — holes across,
// Par / handicap (stroke index) rows, then one yardage row per tee in
// hardest-first order (courseTeeOptions — the conventional tee-sheet
// ordering). Renders nothing without real hole data (thin rows carry none
// until hydration; callers decide whether to fetch).
//
// One row that FITS (Oct 30 2026, Tom's follow-up): the front nine on the
// left, the back nine on the right — Hole · 1–9 · Out · 10–18 · In · Tot —
// in compact cells (`px-1`) so an eighteen fits the composer's card at
// desktop width (the earlier `px-2` row ran to ~950 px in an ~800 px card
// and was cut off; the stacked nines that replaced it are gone again). Out,
// In and Tot are EMPHASISED: a left border off the last hole, bold values,
// the column boxed — the end of each nine and of the round read at a glance.
// A phone still swipes sideways with the sticky label column.
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

  const headCell = 'px-1 py-1.5 text-center font-bold text-secondary whitespace-nowrap';
  const cell = 'px-1 py-1.5 text-center whitespace-nowrap';
  // Out / In / Tot: boxed and bold — the left border separates the column
  // from the last hole; left + right with the row borders box it.
  const sumCell = 'border-l-2 border-r-2 border-border-strong font-bold bg-surface-sunken/60 text-primary';
  type SumKind = 'out' | 'in' | 'total';
  const sumTh = (kind: SumKind, label: string) => (
    <th scope="col" className={`${headCell} ${sumCell}`} data-course-scorecard-sum={kind}>{label}</th>
  );
  const sumTd = (kind: SumKind, value: number | null) => (
    <td className={`${cell} ${sumCell}`} data-course-scorecard-sum={kind}>{value ?? '—'}</td>
  );

  const numberRow = (
    <tr className="border-b border-border bg-surface-sunken">
      <th scope="col" className={`${headCell} text-left sticky left-0 bg-surface-sunken`}>Hole</th>
      {front.map(h => (
        <th key={h.number} scope="col" className={headCell}>{h.number}</th>
      ))}
      {sumTh(eighteen ? 'out' : 'total', eighteen ? 'Out' : 'Total')}
      {eighteen && (
        <>
          {back.map(h => (
            <th key={h.number} scope="col" className={headCell}>{h.number}</th>
          ))}
          {sumTh('in', 'In')}
          {sumTh('total', 'Tot')}
        </>
      )}
    </tr>
  );

  // Par and HCP (Oct 29 2026, Tom's refinement spec): each row bordered so
  // the two read apart, the handicap row on a light purple — the sticky
  // label cell paints the row's own background so it never covers it.
  const statRow = (
    label: string,
    get: (h: (typeof holes)[number]) => number | undefined,
    bold = false,
    tone: 'par' | 'hcp' | 'tee' = 'tee'
  ) => (
    <tr
      data-course-scorecard-row={tone === 'tee' ? undefined : tone}
      className={`${tone === 'tee' ? 'border-b border-border' : 'border-y-2 border-border-strong'} ${tone === 'hcp' ? 'bg-brand-soft' : ''} ${bold ? 'font-bold text-primary' : 'text-secondary'}`}
    >
      <th scope="row" className={`${cell} text-left font-semibold sticky left-0 ${tone === 'hcp' ? 'bg-brand-soft' : 'bg-surface'}`}>{label}</th>
      {front.map(h => (
        <td key={h.number} className={cell}>{get(h) ?? '—'}</td>
      ))}
      {sumTd(eighteen ? 'out' : 'total', sum(front, get))}
      {eighteen && (
        <>
          {back.map(h => (
            <td key={h.number} className={cell}>{get(h) ?? '—'}</td>
          ))}
          {sumTd('in', sum(back, get))}
          {sumTd('total', sum(holes, get))}
        </>
      )}
    </tr>
  );

  return (
    <>
    {course.sheetSource === 'map' && (
      <p className="mb-2 text-xs text-tertiary" data-course-scorecard-map="">
        Pars and yardage from the course map, not the official card.
      </p>
    )}
    <div className="overflow-x-auto rounded-lg border border-border" data-course-scorecard-table="">
      <table className="w-full text-xs bg-surface">
        <thead>{numberRow}</thead>
        <tbody>
          {statRow('Par', h => h.par, true, 'par')}
          {statRow('HCP', h => (typeof h.handicap === 'number' && h.handicap > 0 ? h.handicap : undefined), false, 'hcp')}
          {tees.map(tee => {
            const rating = course.courseRating?.[tee];
            const slope = course.slopeRating?.[tee];
            const suffix =
              rating !== undefined || slope !== undefined
                ? ` (${[rating, slope].filter(v => v !== undefined).join(' / ')})`
                : '';
            const get = (h: (typeof holes)[number]) => h.yardage?.[tee];
            return (
              <tr key={tee} className="border-b border-border last:border-b-0 text-secondary">
                <th scope="row" className={`${cell} text-left font-semibold sticky left-0 bg-surface whitespace-nowrap`}>
                  {teeLabel(tee)}
                  {/* The rating / slope rides the label from `sm`; a phone keeps the column narrow. */}
                  <span className="hidden font-normal text-muted sm:inline">{suffix}</span>
                </th>
                {front.map(h => (
                  <td key={h.number} className={cell}>{get(h) ?? '—'}</td>
                ))}
                {sumTd(eighteen ? 'out' : 'total', sum(front, get))}
                {eighteen && (
                  <>
                    {back.map(h => (
                      <td key={h.number} className={cell}>{get(h) ?? '—'}</td>
                    ))}
                    {sumTd('in', sum(back, get))}
                    {sumTd('total', sum(holes, get))}
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}
