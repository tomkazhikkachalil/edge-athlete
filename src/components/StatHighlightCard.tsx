/**
 * StatHighlightCard — the body for a stats post that has NO media.
 *
 * Those posts have nothing else to carry them, so they lead with one big
 * number instead of a row of identically-sized chips: a five-goal night
 * should not look like two penalty minutes. Which number, and which three
 * support it, is decided per sport by buildStatHighlights — this component
 * only lays out what it is handed.
 *
 * Posts WITH media keep MediaStatStrip over the image; SportPostBody chooses
 * between them.
 */

import { buildStatHighlights } from '@/lib/sports/post-stat-highlights';
import { toParColorClass } from '@/lib/golf/scoring';
import { getSportDefinition, type SportKey } from '@/lib/sports/SportRegistry';

const RESULT_STYLES: Record<string, string> = {
  W: 'bg-green-600 text-white',
  L: 'bg-red-600 text-white',
  T: 'bg-gray-600 text-white',
};

/** "1 GOALS" reads like a bug. Only applies to the hero, where the label is a
 *  word ("Goals", "Points"); the support row uses abbreviations (G, PTS) that
 *  are already invariant. Golf's "To Par" and non-numeric heroes ("E", "+3")
 *  fall through untouched. */
function unitLabel(value: string, label: string): string {
  return value === '1' && label.endsWith('s') ? label.slice(0, -1) : label;
}

interface StatHighlightCardProps {
  sportKey?: string | null;
  statsData?: Record<string, unknown> | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  golfRound?: any;
  groupScorecard?: Record<string, unknown> | null;
  viewerId?: string | null;
}

export default function StatHighlightCard({
  sportKey,
  statsData,
  golfRound,
  groupScorecard,
  viewerId,
}: StatHighlightCardProps) {
  const highlights = buildStatHighlights({
    sportKey,
    statsData,
    golfRound,
    groupScorecard,
    viewerId,
  });
  if (!highlights) return null;

  const sportDef = sportKey ? getSportDefinition(sportKey as SportKey) : null;
  const { moment, date, result, resultScore, hero, support, heroToPar } = highlights;

  // Golf's to-par keeps the app-wide scoring convention (under par green,
  // over red). Every other sport's hero is plain ink — a bigger number is
  // already the emphasis, and colour would compete with it.
  const heroColor =
    heroToPar !== undefined && heroToPar !== null ? toParColorClass(heroToPar) : 'text-primary';

  return (
    <div className="mt-2 rounded-lg border border-border bg-surface-muted px-4 py-4">
      {/* Moment: who/where, plus the result if the sport records one */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          {sportDef && (
            <i className={`${sportDef.icon_id} text-brand-fg-strong shrink-0`} aria-hidden="true"></i>
          )}
          <span className="font-semibold text-primary text-sm truncate">{moment}</span>
          {date && <span className="text-xs text-muted shrink-0">{date}</span>}
        </div>
        {result && (
          <span
            className={`shrink-0 px-2.5 py-1 rounded-full text-xs font-black tracking-wide ${
              RESULT_STYLES[result] ?? RESULT_STYLES.T
            }`}
          >
            {result}
            {resultScore ? ` ${resultScore}` : ''}
          </span>
        )}
      </div>

      {/* Hero: the one number worth reading from a scrolling feed */}
      <div className="text-center py-1">
        <div className={`text-4xl font-black leading-none tabular-nums ${heroColor}`}>
          {hero.value}
        </div>
        <div className="mt-1.5 text-xs font-bold uppercase tracking-wide text-muted">
          {unitLabel(hero.value, hero.label)}
        </div>
      </div>

      {/* Supporting stats — omitted entirely rather than padded with blanks */}
      {support.length > 0 && (
        <div
          className="mt-4 grid gap-2 border-t border-border pt-3"
          style={{ gridTemplateColumns: `repeat(${support.length}, minmax(0, 1fr))` }}
        >
          {support.map(tile => (
            <div key={tile.label} className="text-center min-w-0">
              <div className="text-lg font-bold text-primary tabular-nums leading-none">
                {tile.value}
              </div>
              <div className="mt-1 text-[10px] font-semibold uppercase tracking-wide text-muted truncate">
                {tile.label}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
