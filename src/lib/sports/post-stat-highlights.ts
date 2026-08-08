/**
 * What a stats post SHOWS when it has no photo to lead with.
 *
 * A post with media gets MediaStatStrip — one big number over the image. A
 * post without media used to get whatever fell out of SportPostBody: either
 * every non-zero stat as an identical 16px chip (so a five-goal night looked
 * exactly like two penalty minutes), or, for golf, 12px `label: value` pairs
 * with no edge at all. The no-media path was strictly QUIETER than the media
 * one, which is backwards — those posts have nothing else to carry them.
 *
 * This picks the one number worth showing big plus up to three supporting
 * stats, per sport. Pure and dispatched here rather than in the component,
 * matching post-headline.ts's reasoning: there is no jsdom in this repo, so
 * logic that lives in a component cannot be tested at all.
 *
 * Sources of truth, not reinvented:
 *  - stat-line sports → `heroStat` / `supportKeys` on the sport's schema
 *  - golf → buildPostHeadline (already resolves solo rounds AND shared
 *    scorecards, and picks the viewer's score out of a group) plus golf's
 *    established GIR > Fairways > Putts priority
 */

import { getStatSchema, isStatLineData } from './stat-schemas';
import { buildPostHeadline } from './post-headline';

export interface StatTile {
  value: string;
  label: string;
}

export interface StatHighlights {
  /** "vs Rivals HC", "Ottawa Hunt" — where/against whom. */
  moment: string;
  /** Optional date, already formatted for display. */
  date?: string;
  /** W / L / T, when the sport records one. */
  result?: 'W' | 'L' | 'T';
  /** "4-2" */
  resultScore?: string;
  /** The number that carries the card. */
  hero: StatTile;
  /** Up to three, rendered smaller beneath the hero. */
  support: StatTile[];
  /** Golf to-par drives semantic colour (under par green, over par red). */
  heroToPar?: number | null;
}

interface GolfRoundLike {
  course?: string | null;
  gross_score?: number | null;
  golf_holes?: Array<{ par?: number | null }> | null;
  gir_percentage?: number | null;
  fir_percentage?: number | null;
  total_putts?: number | null;
  holes_played?: number | null;
}

interface BuildInput {
  sportKey?: string | null;
  statsData?: Record<string, unknown> | null;
  golfRound?: GolfRoundLike | null;
  groupScorecard?: Record<string, unknown> | null;
  viewerId?: string | null;
}

/** Golf's supporting stats, in the priority the app already uses elsewhere
 *  (see getQuickStat in stats-summary.ts): GIR, then fairways, then putts. */
function golfSupport(round: GolfRoundLike | null | undefined): StatTile[] {
  if (!round) return [];
  const tiles: StatTile[] = [];
  if (typeof round.gir_percentage === 'number') {
    tiles.push({ value: `${Math.round(round.gir_percentage)}%`, label: 'GIR' });
  }
  if (typeof round.fir_percentage === 'number') {
    tiles.push({ value: `${Math.round(round.fir_percentage)}%`, label: 'Fairways' });
  }
  if (typeof round.total_putts === 'number') {
    tiles.push({ value: String(round.total_putts), label: 'Putts' });
  }
  if (typeof round.holes_played === 'number' && tiles.length < 3) {
    tiles.push({ value: String(round.holes_played), label: 'Holes' });
  }
  return tiles.slice(0, 3);
}

/** Sum of pars, when the hole detail came back with the round. */
function coursePar(round: GolfRoundLike | null | undefined): number | null {
  const holes = round?.golf_holes;
  if (!Array.isArray(holes) || holes.length === 0) return null;
  let total = 0;
  for (const h of holes) {
    if (typeof h?.par !== 'number') return null;
    total += h.par;
  }
  return total > 0 ? total : null;
}

export function buildStatHighlights(input: BuildInput): StatHighlights | null {
  const { sportKey, statsData, golfRound, groupScorecard, viewerId } = input;

  // ── Golf: deep tables, no stat schema ──────────────────────────────────
  if (sportKey === 'golf') {
    const headline = buildPostHeadline(sportKey, {
      golfRound,
      statsData,
      groupScorecard: groupScorecard as never,
      viewerId,
    });
    if (!headline) return null;

    const par = coursePar(golfRound);
    const gross = typeof golfRound?.gross_score === 'number' ? golfRound.gross_score : null;
    const toPar = par !== null && gross !== null ? gross - par : null;

    const support = golfSupport(golfRound);
    // The score itself becomes a supporting tile when the hero is to-par, so
    // the actual number a golfer cares about never disappears.
    if (toPar !== null && gross !== null) {
      support.unshift({ value: String(gross), label: 'Score' });
    }

    return {
      moment: headline.moment,
      hero:
        toPar !== null
          ? { value: toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : String(toPar), label: 'To Par' }
          : { value: headline.value, label: headline.label },
      support: support.slice(0, 3),
      heroToPar: toPar,
    };
  }

  // ── Stat-line sports ───────────────────────────────────────────────────
  if (!isStatLineData(statsData)) return null;
  const schema = getStatSchema(statsData.sport_key);
  if (!schema) return null;

  const stats = statsData.stats ?? {};
  const heroValue = schema.heroStat.compute(stats);

  const support: StatTile[] = [];
  for (const key of schema.supportKeys) {
    const v = stats[key];
    if (typeof v !== 'number' || v <= 0) continue;
    const field = schema.fields.find(f => f.key === key);
    support.push({ value: String(v), label: field?.shortLabel ?? key });
    if (support.length === 3) break;
  }

  // Nothing recorded at all: no hero, no support. A card showing "0" over an
  // empty row is worse than the caption alone — but the post may still be
  // worth rendering for its opponent/result, so fall back to the first
  // recorded stat before giving up entirely.
  let hero: StatTile;
  if (heroValue !== null) {
    hero = { value: String(heroValue), label: schema.heroStat.label };
  } else if (support.length > 0) {
    const [first, ...rest] = support;
    hero = first;
    support.length = 0;
    support.push(...rest);
  } else {
    const firstRecorded = schema.fields.find(
      f => typeof stats[f.key] === 'number' && stats[f.key] > 0
    );
    if (!firstRecorded) return null;
    hero = { value: String(stats[firstRecorded.key]), label: firstRecorded.label };
  }

  const moment = statsData.opponent
    ? `vs ${statsData.opponent}`
    : schema.activityNoun;

  return {
    moment,
    date: statsData.date,
    result: statsData.result,
    resultScore: statsData.result_score,
    hero,
    support,
  };
}
