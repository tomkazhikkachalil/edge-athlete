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
import { asGameFormat, GAME_FORMAT_LABELS } from '../golf/formats';
import { holePar } from '../golf/scoring';
import { formatDisplayName, formatShortName } from '../formatters';

export interface StatTile {
  value: string;
  label: string;
}

/** One hole in a player's preview strip. Par rides along so the card can
 *  colour the cell with classifyScore without re-deriving it. */
export interface StatPlayerHole {
  hole: number;
  strokes: number;
  par: number | null;
}

/** One athlete's line in a round, in CREATION ORDER (the payload arrives
 *  pre-sorted by participantOrder — never re-sort by score here; Tom's rule
 *  is that the input order holds on every surface). Avatars come free with
 *  the feed payload — GROUP_SCORECARD_SELECT already joins the profile. */
export interface StatPlayer {
  profileId: string | null;
  name: string;
  /** "Tom K." — fits the card's fixed name column; full name is for details. */
  shortName: string;
  avatarUrl: string | null;
  score: number;
  toPar: number | null;
  /** The viewer's own row, so the card can mark it. */
  isViewer: boolean;
  /** Hole-by-hole preview, sorted by hole. Empty when nothing per-hole was
   *  recorded (quick-entry rounds, score-only shared participants). */
  holes: StatPlayerHole[];
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
  /** Everyone who scored, in creation order. Empty without a roster. */
  players?: StatPlayer[];
  /** "18 holes", "Stroke play" — the round's context line. */
  meta?: string[];
}

interface GolfRoundLike {
  course?: string | null;
  date?: string | null;
  gross_score?: number | null;
  /** Course par as a COLUMN (golf_rounds.par). Preferred over summing holes,
   *  which are only present when the round detail was joined. */
  par?: number | null;
  golf_holes?: Array<{
    hole_number?: number | null;
    par?: number | null;
    strokes?: number | null;
  }> | null;
  gir_percentage?: number | null;
  fir_percentage?: number | null;
  total_putts?: number | null;
  /** golf_rounds.holes — NOT `holes_played`, which is the shared-round field.
   *  Using the wrong name here meant the Holes tile never fired for a solo
   *  round. */
  holes?: number | null;
}

/** The post author, used as the single "player" on a solo round. */
interface AuthorLike {
  id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  full_name?: string | null;
  avatar_url?: string | null;
}

interface BuildInput {
  sportKey?: string | null;
  statsData?: Record<string, unknown> | null;
  golfRound?: GolfRoundLike | null;
  groupScorecard?: Record<string, unknown> | null;
  viewerId?: string | null;
  /** Solo rounds have no participant rows — the player IS the post author. */
  author?: AuthorLike | null;
}

/** Golf's supporting stats, in the priority the app already uses elsewhere
 *  (see getQuickStat in stats-summary.ts): GIR, then fairways, then putts. */
function golfSupport(round: GolfRoundLike | null | undefined): StatTile[] {
  if (!round) return [];
  const tiles: StatTile[] = [];
  // ZERO IS TREATED AS "not recorded" here. A round genuinely played with 0%
  // greens in regulation is vanishingly rare, whereas an unrecorded 0 is the
  // norm — and "0% GIR · 0% FWY" on every card reads as broken, not honest.
  if (typeof round.gir_percentage === 'number' && round.gir_percentage > 0) {
    tiles.push({ value: `${Math.round(round.gir_percentage)}%`, label: 'GIR' });
  }
  if (typeof round.fir_percentage === 'number' && round.fir_percentage > 0) {
    tiles.push({ value: `${Math.round(round.fir_percentage)}%`, label: 'Fairways' });
  }
  if (typeof round.total_putts === 'number' && round.total_putts > 0) {
    tiles.push({ value: String(round.total_putts), label: 'Putts' });
  }
  return tiles.slice(0, 3);
}

interface SharedScores {
  course: string;
  total: number;
  toPar: number | null;
  holes?: number | null;
  /** Already run through GAME_FORMAT_LABELS — the raw column value is
   *  "stroke", which must never reach the card. */
  formatLabel?: string | null;
  date?: string | null;
  players: StatPlayer[];
}

/**
 * Pull the score to lead with out of a SHARED round: the viewer's own row if
 * they played, else the leader — the same rule buildPostHeadline uses, so the
 * hero and the media strip never disagree about whose round it is.
 */
function sharedRoundScores(
  groupScorecard: Record<string, unknown> | null | undefined,
  viewerId: string | null | undefined
): SharedScores | null {
  if (!groupScorecard) return null;
  const golfData = groupScorecard.golf_data as
    | {
        course_name?: string | null;
        holes_played?: number | null;
        game_format?: string | null;
        /** Real per-hole pars (migration 039); null for older rounds, where
         *  holePar's par-4 fallback applies — same rule as the full card. */
        hole_data?: { hole: number; par: number }[] | null;
      }
    | undefined;
  if (!golfData) return null;

  const participants = (groupScorecard.participants ?? []) as Array<{
    participant?: {
      profile_id?: string | null;
      profile?: {
        first_name?: string | null;
        last_name?: string | null;
        full_name?: string | null;
        avatar_url?: string | null;
      } | null;
    } | null;
    scores?: {
      total_score?: number | null;
      to_par?: number | null;
      hole_scores?: Array<{ hole_number?: number | null; strokes?: number | null }> | null;
    } | null;
  }>;
  const scored = participants.filter(p => typeof p.scores?.total_score === 'number');
  if (scored.length === 0) return null;

  const mine = viewerId ? scored.find(p => p.participant?.profile_id === viewerId) : undefined;
  const best = scored.reduce((a, b) =>
    (b.scores!.total_score ?? Infinity) < (a.scores!.total_score ?? Infinity) ? b : a
  );
  const chosen = mine ?? best;

  // Everyone who scored, in CREATION ORDER — the payload arrives pre-sorted
  // by participantOrder (scorecard-transform), and the roster must match the
  // detail card and score entry exactly. The hero still picks viewer-else-
  // leader independently of this order.
  const holeData = golfData.hole_data ?? null;
  const players: StatPlayer[] = scored
    .map(p => {
      const prof = p.participant?.profile ?? null;
      return {
        profileId: p.participant?.profile_id ?? null,
        name: formatDisplayName(prof?.first_name, null, prof?.last_name, prof?.full_name),
        shortName: formatShortName(prof?.first_name, prof?.last_name, prof?.full_name, 12),
        avatarUrl: prof?.avatar_url ?? null,
        score: p.scores!.total_score as number,
        toPar: typeof p.scores?.to_par === 'number' ? p.scores.to_par : null,
        isViewer: !!viewerId && p.participant?.profile_id === viewerId,
        holes: (p.scores?.hole_scores ?? [])
          .filter(hs => typeof hs?.hole_number === 'number' && typeof hs?.strokes === 'number')
          .map(hs => ({
            hole: hs.hole_number as number,
            strokes: hs.strokes as number,
            par: holePar(hs.hole_number as number, holeData),
          }))
          .sort((a, b) => a.hole - b.hole),
      };
    });

  const groupPost = groupScorecard.group_post as { date?: string | null } | undefined;

  return {
    course: golfData.course_name?.trim() || 'Round',
    total: chosen.scores!.total_score as number,
    toPar: typeof chosen.scores?.to_par === 'number' ? chosen.scores.to_par : null,
    holes: golfData.holes_played,
    formatLabel: GAME_FORMAT_LABELS[asGameFormat(golfData.game_format)],
    date: groupPost?.date ?? null,
    players,
  };
}

/** Course par. The COLUMN (golf_rounds.par) is authoritative and always
 *  present; summing golf_holes is the fallback for payloads that joined the
 *  hole detail but predate the column being populated. Relying on the sum
 *  alone meant to-par silently vanished whenever holes weren't joined.
 *
 *  EXCEPT for a partially recorded round — fewer golf_holes rows than the
 *  round's configured holes. There the gross score is itself a partial sum,
 *  so to-par must come from the pars of the holes actually played; the column
 *  would compare 12 holes of strokes against 18 holes of par. Exported so
 *  GolfRoundCard's score badge derives to-par by the same rule as the hero. */
export function coursePar(round: GolfRoundLike | null | undefined): number | null {
  const holes = round?.golf_holes;
  const holesJoined = Array.isArray(holes) && holes.length > 0;
  const partiallyRecorded =
    holesJoined && typeof round?.holes === 'number' && holes.length < round.holes;
  if (!partiallyRecorded && typeof round?.par === 'number' && round.par > 0) return round.par;
  if (!holesJoined) return null;
  let total = 0;
  for (const h of holes) {
    if (typeof h?.par !== 'number') return null;
    total += h.par;
  }
  return total > 0 ? total : null;
}

/** Hole-by-hole preview rows for a SOLO round: only holes actually scored,
 *  sorted. Quick-entry rounds (gross only, no hole rows) yield []. */
function soloPlayerHoles(round: GolfRoundLike | null | undefined): StatPlayerHole[] {
  const rows = round?.golf_holes;
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(h => typeof h?.hole_number === 'number' && typeof h?.strokes === 'number')
    .map(h => ({
      hole: h.hole_number as number,
      strokes: h.strokes as number,
      par: typeof h.par === 'number' ? h.par : null,
    }))
    .sort((a, b) => a.hole - b.hole);
}

export function buildStatHighlights(input: BuildInput): StatHighlights | null {
  const { sportKey, statsData, golfRound, groupScorecard, viewerId, author } = input;

  // ── Golf: deep tables, no stat schema ──────────────────────────────────
  if (sportKey === 'golf') {
    // A SHARED round carries to_par and total_score on the participant rows,
    // so read them directly rather than through buildPostHeadline — that
    // flattens to-par into a LABEL string ("+3"), which would render the raw
    // score as the hero with "+3" underneath it. Golf leads with to-par.
    const shared = sharedRoundScores(groupScorecard, viewerId);
    if (shared) {
      // The roster replaces the support tiles: with player rows showing each
      // score, a "Score / Holes / Format" strip would just say it again.
      const meta: string[] = [];
      if (typeof shared.holes === 'number') meta.push(`${shared.holes} holes`);
      if (shared.formatLabel) meta.push(shared.formatLabel);
      return {
        moment: shared.course,
        date: shared.date ?? undefined,
        hero:
          shared.toPar === null
            ? { value: String(shared.total), label: 'Score' }
            : {
                value: shared.toPar === 0 ? 'E' : shared.toPar > 0 ? `+${shared.toPar}` : String(shared.toPar),
                label: 'To Par',
              },
        support: [],
        heroToPar: shared.toPar,
        players: shared.players,
        meta,
      };
    }

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

    const meta: string[] = [];
    if (typeof golfRound?.holes === 'number') meta.push(`${golfRound.holes} holes`);

    // A solo round has no participant rows — the player is the post author.
    const players: StatPlayer[] =
      author && gross !== null
        ? [
            {
              profileId: author.id ?? null,
              name: formatDisplayName(author.first_name, null, author.last_name, author.full_name),
              shortName: formatShortName(author.first_name, author.last_name, author.full_name, 12),
              avatarUrl: author.avatar_url ?? null,
              score: gross,
              toPar,
              isViewer: !!viewerId && author.id === viewerId,
              holes: soloPlayerHoles(golfRound),
            },
          ]
        : [];

    return {
      moment: headline.moment,
      date: golfRound?.date ?? undefined,
      hero:
        toPar !== null
          ? { value: toPar === 0 ? 'E' : toPar > 0 ? `+${toPar}` : String(toPar), label: 'To Par' }
          : { value: headline.value, label: headline.label },
      support: support.slice(0, 3),
      heroToPar: toPar,
      players,
      meta,
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
