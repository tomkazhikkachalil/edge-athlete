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
import { AvatarImage } from '@/components/OptimizedImage';
import { getInitials } from '@/lib/formatters';

const RESULT_STYLES: Record<string, string> = {
  W: 'bg-green-600 text-white',
  L: 'bg-red-600 text-white',
  T: 'bg-gray-600 text-white',
};

/** "1 GOALS" reads like a bug. Only applies to the hero, where the label is a
 *  word ("Goals", "Points"); the support row uses abbreviations (G, PTS) that
 *  are already invariant. Golf's "To Par" and non-numeric heroes ("E", "+3")
 *  fall through untouched. */
/** "2026-08-01" → "Aug 1". Kept dumb: the card wants a glanceable date, not
 *  a locale-complete one. */
function formatCardDate(raw: string): string {
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

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
  /** Post author — the single player on a solo round, which has no roster. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  author?: any;
  /** Opens the full scorecard. Same handler the quick view uses, so this card
   *  can replace it without losing the way through to the detail. */
  onExpand?: () => void;
}

export default function StatHighlightCard({
  sportKey,
  statsData,
  golfRound,
  groupScorecard,
  viewerId,
  author,
  onExpand,
}: StatHighlightCardProps) {
  const highlights = buildStatHighlights({
    sportKey,
    statsData,
    golfRound,
    groupScorecard,
    viewerId,
    author,
  });
  if (!highlights) return null;

  const sportDef = sportKey ? getSportDefinition(sportKey as SportKey) : null;
  const { moment, date, result, resultScore, hero, support, heroToPar, players, meta } = highlights;

  // Golf's to-par keeps the app-wide scoring convention (under par green,
  // over red). Every other sport's hero is plain ink — a bigger number is
  // already the emphasis, and colour would compete with it.
  const heroColor =
    heroToPar !== undefined && heroToPar !== null ? toParColorClass(heroToPar) : 'text-primary';
  const metaLine = (meta ?? []).join(' · ');

  return (
    <div className="mt-2 rounded-lg border border-border bg-surface-muted px-4 py-4">
      {/* Moment: who/where, plus the result if the sport records one */}
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-start gap-2 min-w-0">
          {sportDef && (
            <i
              className={`${sportDef.icon_id} text-brand-fg-strong shrink-0 mt-0.5`}
              aria-hidden="true"
            ></i>
          )}
          <div className="min-w-0">
            <div className="font-semibold text-primary text-sm truncate">{moment}</div>
            {/* Context line: "18 holes · Stroke play · Aug 1" */}
            {(metaLine || date) && (
              <div className="text-xs text-muted truncate">
                {[metaLine, date && formatCardDate(date)].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
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

      {/* Who played. A shared round IS its roster, so the names and faces are
          the content — and their profiles (avatar included) already arrive
          with the feed payload. */}
      {players && players.length > 0 && (
        <div className="mt-4 border-t border-border pt-3 space-y-2">
          {players.map((p, i) => (
            <div key={p.profileId ?? `${p.name}-${i}`} className="flex items-center gap-2.5">
              <AvatarImage
                src={p.avatarUrl}
                alt={p.name}
                size={28}
                fallbackInitials={getInitials(p.name)}
              />
              <span
                className={`flex-1 min-w-0 truncate text-sm ${
                  p.isViewer ? 'font-bold text-primary' : 'font-medium text-secondary'
                }`}
              >
                {p.name}
              </span>
              <span className="text-base font-black text-primary tabular-nums shrink-0">
                {p.score}
              </span>
              {p.toPar !== null && (
                /* SEMANTIC COLOUR — DO NOT NEUTRALISE: under/over par. */
                <span className={`text-xs font-bold shrink-0 w-8 text-right ${toParColorClass(p.toPar)}`}>
                  {p.toPar > 0 ? `+${p.toPar}` : p.toPar === 0 ? 'E' : p.toPar}
                </span>
              )}
            </div>
          ))}
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              className="w-full text-right text-xs font-semibold text-brand-fg hover:text-brand-fg-strong pt-1"
            >
              View full scorecard ›
            </button>
          )}
        </div>
      )}

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
