/**
 * The game form's draft (game film round 2, Nov 13 2026) — pure. ONE field
 * set serves the video page's card and the Details step of the Full game
 * flow: what the form holds, how a stored game becomes it, and the PUT body
 * it sends. A side is a typed name and, for a club's or league's own video,
 * optionally one of its teams (the link the roster-first picker reads).
 */
import { GAME_SIDE_NAME_MAX, gameHasSides, type GameCoverage, type GameView } from './game-rules';
import { gameSheetFor } from './game-sheets';

export interface GameDraft {
  sport_key: string;
  played_on: string;
  side1: string;
  side2: string;
  side1_team_id: string | null;
  side2_team_id: string | null;
  coverage: GameCoverage;
  stats_hidden: boolean;
}

export interface TeamOption { id: string; name: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A stored game as the form holds it; none yet = the video's sport when that sport has a sheet, spoiler-free, highlights only. */
export function gameDraftOf(game: GameView | null, sportKey: string | null): GameDraft {
  return {
    sport_key: game?.sport_key ?? (gameSheetFor(sportKey) ? (sportKey as string) : ''),
    played_on: game?.played_on ?? '',
    side1: game?.side1.name ?? '',
    side2: game?.side2.name ?? '',
    side1_team_id: game?.side1.team_id ?? null,
    side2_team_id: game?.side2.team_id ?? null,
    coverage: game?.coverage ?? 'highlights',
    stats_hidden: game?.stats_hidden ?? true,
  };
}

/** A name typed over a side. Clearing the name clears the side — its team link with it. */
export function typeSideName(d: GameDraft, side: 1 | 2, text: string): GameDraft {
  const cleared = text.trim() === '';
  return side === 1
    ? { ...d, side1: text, side1_team_id: cleared ? null : d.side1_team_id }
    : { ...d, side2: text, side2_team_id: cleared ? null : d.side2_team_id };
}

/** One of the organization's teams picked for a side (its name fills the side), or the link dropped (the typed name stays). The other side never keeps the same team. */
export function pickSideTeam(d: GameDraft, side: 1 | 2, team: TeamOption | null): GameDraft {
  if (!team) return side === 1 ? { ...d, side1_team_id: null } : { ...d, side2_team_id: null };
  const name = team.name.slice(0, GAME_SIDE_NAME_MAX);
  return side === 1
    ? { ...d, side1: name, side1_team_id: team.id, ...(d.side2_team_id === team.id ? { side2: '', side2_team_id: null } : {}) }
    : { ...d, side2: name, side2_team_id: team.id, ...(d.side1_team_id === team.id ? { side1: '', side1_team_id: null } : {}) };
}

/** The team links go (the owner is not an organization, or not the one the teams were read for); the names stay. */
export function withoutTeams(d: GameDraft): GameDraft {
  return { ...d, side1_team_id: null, side2_team_id: null };
}

/** PUT /api/videos/[id]/game — the whole game. A sport without sides sends none. */
export function gameBodyOf(d: GameDraft): Record<string, unknown> {
  const sides = d.sport_key ? gameHasSides(d.sport_key) : false;
  const side = (name: string, teamId: string | null) => (sides ? { name: name.trim() || null, team_id: name.trim() ? teamId : null } : null);
  return {
    sport_key: d.sport_key,
    played_on: d.played_on || null,
    side1: side(d.side1, d.side1_team_id),
    side2: side(d.side2, d.side2_team_id),
    coverage: d.coverage,
    stats_hidden: d.stats_hidden,
  };
}

/** A draft kept on the device while the person is at Google: anything not exactly a draft is no draft. */
export function parseGameDraft(raw: unknown): GameDraft | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const v = raw as Record<string, unknown>;
  const text = (x: unknown, max: number): string | null => (typeof x === 'string' && x.length <= max ? x : null);
  const team = (x: unknown): string | null | undefined => (x === null || x === undefined ? null : typeof x === 'string' && UUID.test(x) ? x : undefined);
  const sport = text(v.sport_key, 64);
  const day = text(v.played_on, 10);
  const side1 = text(v.side1, GAME_SIDE_NAME_MAX);
  const side2 = text(v.side2, GAME_SIDE_NAME_MAX);
  const t1 = team(v.side1_team_id);
  const t2 = team(v.side2_team_id);
  if (sport === null || day === null || side1 === null || side2 === null || t1 === undefined || t2 === undefined) return null;
  if (sport && !gameSheetFor(sport)) return null;
  if (v.coverage !== 'highlights' && v.coverage !== 'full') return null;
  if (typeof v.stats_hidden !== 'boolean') return null;
  return { sport_key: sport, played_on: day, side1, side2, side1_team_id: t1, side2_team_id: t2, coverage: v.coverage, stats_hidden: v.stats_hidden };
}
