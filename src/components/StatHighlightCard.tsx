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

import { buildStatHighlights, type StatPlayerHole } from '@/lib/sports/post-stat-highlights';
import { classifyScore, SCORE_CELL_RING, toParColorClass } from '@/lib/golf/scoring';
import { getSportDefinition, type SportKey } from '@/lib/sports/SportRegistry';
import { AvatarImage } from '@/components/OptimizedImage';
import { getInitials, parseDateLocal } from '@/lib/formatters';

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
 *  a locale-complete one.
 *
 *  parseDateLocal, NOT `new Date(raw)`: group_posts.date and golf_rounds.date
 *  are DATE columns, and a bare `new Date("2026-08-30")` parses as UTC
 *  midnight, so every US timezone renders the PREVIOUS day. That made this
 *  card say "Aug 29" while the detail modal — which already used the helper —
 *  said "August 30" for the same round. */
export function formatCardDate(raw: string): string {
  const d = parseDateLocal(raw);
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function unitLabel(value: string, label: string): string {
  return value === '1' && label.endsWith('s') ? label.slice(0, -1) : label;
}

/** Glimpseable hole-by-hole strip inside a player row: the quick scan Tom
 *  asked for without opening the full scorecard. Cells reuse the SEMANTIC
 *  scorecard colours (classifyScore + SCORE_CELL_RING — never reinvent);
 *  scrolls sideways past what fits. Cells are non-interactive, so the
 *  overflow container's pseudo-element clipping rule doesn't apply. */
function HoleStrip({ holes }: { holes: StatPlayerHole[] }) {
  return (
    <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide" aria-label="Hole by hole scores">
      <div className="flex w-max items-center gap-0.5">
        {holes.map(h => {
          const cls = h.par !== null ? classifyScore(h.strokes, h.par) : null;
          const style = cls ? SCORE_CELL_RING[cls] : SCORE_CELL_RING.par;
          return (
            <span
              key={h.hole}
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded bg-surface text-xs tabular-nums ${style.ring} ${style.text}`}
            >
              {h.strokes}
            </span>
          );
        })}
      </div>
    </div>
  );
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
  /** Solo rounds toggle an inline disclosure, so the button reflects state.
   *  Shared rounds open a modal instead and never pass this — aria-expanded
   *  stays absent there, where it would be wrong. */
  expanded?: boolean;
}

export default function StatHighlightCard({
  sportKey,
  statsData,
  golfRound,
  groupScorecard,
  viewerId,
  author,
  onExpand,
  expanded,
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
        <div className="flex items-center gap-2 shrink-0">
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
          {/* The SECOND way into the detail, at the top of the card. The one
              under the roster is a long scroll away on a round with four
              players, so someone scanning the header had no way through
              (Tom, Aug 2026). Deliberately NOT behind the roster gate that
              wraps the bottom button: `onExpand` is the real capability
              signal, and the header always renders.

              Distinct label from the bottom button on purpose — two intents,
              two names, and never two same-named controls on one card.
              `-my-2` buys the 44px target without inflating the header, and
              active: because hover: does nothing on touch. */}
          {onExpand && (
            <button
              type="button"
              onClick={onExpand}
              /* Solo posts toggle an inline disclosure, so aria-expanded is
                 the truth; shared posts open a modal, where it would be a lie
                 — undefined is omitted by React, and haspopup takes over. */
              aria-expanded={expanded}
              aria-haspopup={expanded === undefined ? 'dialog' : undefined}
              className="-my-2 flex min-h-[44px] shrink-0 items-center text-xs font-semibold text-brand-fg hover:text-brand-fg-strong active:text-brand-fg-strong"
            >
              {expanded ? 'Hide details ‹' : 'View details ›'}
            </button>
          )}
        </div>
      </div>

      {/* Hero: the one number worth reading from a scrolling feed — but ONLY
          when no roster renders below. Player rows restate the exact same
          numbers (gross + coloured to-par per athlete), so on golf posts the
          big +/- was saying twice what the detail right under it already
          says (Tom's call, Aug 9). The course carries those cards instead.
          Stat-line sports have no roster and keep their hero. The grid
          tiles' score band still consumes highlights.hero — builders are
          untouched on purpose. */}
      {!(players && players.length > 0) && (
        <div className="text-center py-1">
          <div className={`text-4xl font-black leading-none tabular-nums ${heroColor}`}>
            {hero.value}
          </div>
          <div className="mt-1.5 text-xs font-bold uppercase tracking-wide text-muted">
            {unitLabel(hero.value, hero.label)}
          </div>
        </div>
      )}

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
              {/* FIXED name column when a strip renders (Tom: rows must stack
                  aligned — variable name widths made every strip and score
                  start at a different x). shortName ("Tom K.") fits the
                  budget; the full name lives in the detail card. title=
                  carries the full name for hover/long-press. */}
              <span
                title={p.name}
                className={`${p.holes.length > 0 ? 'w-[84px] sm:w-24 shrink-0' : 'flex-1 min-w-0'} truncate text-sm ${
                  p.isViewer ? 'font-bold text-primary' : 'font-medium text-secondary'
                }`}
              >
                {p.shortName}
              </span>
              {p.holes.length > 0 && <HoleStrip holes={p.holes} />}
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
            /* min-h-[44px] + flex, not bare text: at text-xs + pt-1 this was a
               20px-tall target sitting 8px under the last player row, so a
               thumb aimed here landed on the player instead. active: because
               hover: does nothing on touch. */
            <button
              type="button"
              onClick={onExpand}
              aria-expanded={expanded}
              className="flex min-h-[44px] w-full items-center justify-end text-xs font-semibold text-brand-fg hover:text-brand-fg-strong active:text-brand-fg-strong"
            >
              {expanded ? 'Hide scorecard ‹' : 'View full scorecard ›'}
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
