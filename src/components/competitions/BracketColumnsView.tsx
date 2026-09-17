/**
 * The bracket as columns (Competition formats, track 2, PR 4) — extracted
 * from the events BracketView (phase 3), which now wraps it. Server-safe
 * on purpose: no hooks, no Font Awesome, no `dark:` (it renders inside
 * the (public) segment's standings module too). Pure props: the columns
 * and the winner line; every host-dependent link arrives as an href.
 * Columns side by side from `sm:` (scrolling sideways when wide), stacked
 * per round on a phone. The data attributes are the phase 3 specs'.
 */
export interface BracketViewSide {
  key: string;
  label: string;
  won: boolean;
  /** An empty side — "TBD" / "Winner of match n" / "Bye". */
  empty: boolean;
}

export interface BracketViewSlot {
  key: string;
  title: string;
  result?: string | null;
  sides: BracketViewSide[];
  href?: string | null;
  /** Leftovers PR 11: "Played as event" (+ the draw note) on a slot linked to an event's match. */
  badge?: string | null;
}

export interface BracketViewColumn {
  key: string;
  name: string;
  /** "live" · "final" · "scheduled" — printed after the name when set. */
  status?: string | null;
  slots: BracketViewSlot[];
}

export default function BracketColumnsView({ columns, winner }: { columns: BracketViewColumn[]; winner?: string | null }) {
  return (
    <div className="space-y-3" data-bracket-view="">
      {winner && (
        <p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800" data-bracket-winner="">
          {winner} wins the bracket
        </p>
      )}
      <div className="flex flex-col gap-4 sm:flex-row sm:overflow-x-auto sm:items-start">
        {columns.map(col => (
          <section key={col.key} className="sm:min-w-[16rem] sm:shrink-0 space-y-2" data-bracket-column={col.key}>
            <h3 className="text-sm font-bold text-primary">
              {col.name}
              {col.status && <span className="ml-2 text-xs font-normal text-muted">{col.status}</span>}
            </h3>
            {col.slots.length === 0 && <p className="text-xs text-muted">No draw yet.</p>}
            <ol className="space-y-2">
              {col.slots.map(slot => {
                const body = (
                  <>
                    <p className="text-[10px] uppercase tracking-wide text-muted">{slot.title}{slot.result ? ` · ${slot.result}` : ''}</p>
                    {slot.badge && <p className="text-[11px] text-emerald-800" data-bracket-slot-badge="">{slot.badge}</p>}
                    {slot.sides.map((side, i) => (
                      <p key={side.key} className={side.won ? 'font-bold text-primary' : side.empty ? 'text-muted italic' : 'text-primary'} data-bracket-side={i + 1}>
                        {side.label}
                      </p>
                    ))}
                  </>
                );
                return (
                  <li key={slot.key} className="rounded-lg border border-border bg-surface px-3 py-2 text-sm" data-bracket-slot={slot.key}>
                    {slot.href ? <a href={slot.href} className="block hover:underline">{body}</a> : body}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
