// NO 'use client' on purpose (phase 6b A2): this table has no hooks or
// handlers, so it renders as a server component inside the (public) org
// segment (the courses module) and as plain markup inside client cards.

// The official scorecard: the tee-sheet table golfers know — holes across,
// Par / handicap (stroke index) rows, then one yardage row per tee in
// hardest-first order (courseTeeOptions — the conventional tee-sheet
// ordering). Renders nothing without real hole data (thin rows carry none
// until hydration; callers decide whether to fetch).
//
// Two nines, stacked (Oct 30 2026, Tom's desktop report): an 18-hole sheet
// in ONE row of 22 columns ran to ~950 px inside an ~800 px card — holes 17
// and 18, In and Total cut off, and a Mac shows no scrollbar to say so (a
// phone swiped, so it looked fine there). The card golfers hold is two
// blocks: the front nine with Out, the back nine with In and Total. Each
// block is its own table and fits the card; a nine is one block.
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

  type Block = { key: 'front' | 'back' | 'all'; holes: typeof holes; sumLabel: string; withTotal: boolean };
  const blocks: Block[] = eighteen
    ? [
        { key: 'front', holes: front, sumLabel: 'Out', withTotal: false },
        { key: 'back', holes: back, sumLabel: 'In', withTotal: true },
      ]
    : [{ key: 'all', holes, sumLabel: 'Total', withTotal: false }];

  const numberRow = (b: Block) => (
    <tr className="border-b border-border bg-surface-sunken">
      <th scope="col" className={`${headCell} text-left sticky left-0 bg-surface-sunken`}>Hole</th>
      {b.holes.map(h => (
        <th key={h.number} scope="col" className={headCell}>{h.number}</th>
      ))}
      <th scope="col" className={headCell}>{b.sumLabel}</th>
      {b.withTotal && <th scope="col" className={headCell}>Tot</th>}
    </tr>
  );

  // Par and HCP (Oct 29 2026, Tom's refinement spec): each row bordered so
  // the two read apart, the handicap row on a light purple — the sticky
  // label cell paints the row's own background so it never covers it.
  const statRow = (
    b: Block,
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
      {b.holes.map(h => (
        <td key={h.number} className={cell}>{get(h) ?? '—'}</td>
      ))}
      <td className={`${cell} font-bold`}>{sum(b.holes, get) ?? '—'}</td>
      {b.withTotal && <td className={`${cell} font-bold`}>{sum(holes, get) ?? '—'}</td>}
    </tr>
  );

  const teeRow = (b: Block, tee: string) => {
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
          <span className="font-normal text-muted">{suffix}</span>
        </th>
        {b.holes.map(h => (
          <td key={h.number} className={cell}>{get(h) ?? '—'}</td>
        ))}
        <td className={`${cell} font-bold`}>{sum(b.holes, get) ?? '—'}</td>
        {b.withTotal && <td className={`${cell} font-bold`}>{sum(holes, get) ?? '—'}</td>}
      </tr>
    );
  };

  return (
    <div className="space-y-2" data-course-scorecard-blocks={blocks.length}>
      {blocks.map(b => (
        <div key={b.key} className="overflow-x-auto rounded-lg border border-border" data-course-scorecard-block={b.key}>
          <table className="w-full text-xs bg-surface">
            <thead>{numberRow(b)}</thead>
            <tbody>
              {statRow(b, 'Par', h => h.par, true, 'par')}
              {statRow(b, 'HCP', h => (typeof h.handicap === 'number' && h.handicap > 0 ? h.handicap : undefined), false, 'hcp')}
              {tees.map(tee => teeRow(b, tee))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
