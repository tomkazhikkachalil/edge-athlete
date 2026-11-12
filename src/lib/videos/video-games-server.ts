/**
 * The game on a linked video — the ONE writer of `video_games` (Sprint 3
 * PR 2, migration 307). Server only. The rights are the video's own
 * (readVideoForViewer: a manager writes, a viewer of the video reads); this
 * file only reads and writes the row. A deployment where 307 has not run
 * answers "no game" on a read and a plain refusal on a write — never a 500.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '@/lib/orgs/validate';
import type { GameInput, GameView } from './game-rules';

type Admin = SupabaseClient;
const TAG = '[videos/game]';
export const GAME_COLUMNS = 'video_id, sport_key, played_on, side1_name, side1_team_id, side2_name, side2_team_id, coverage, stats_hidden, updated_at';

export type GameOutcome<T> = { ok: true; value: T } | { ok: false; status: 400 | 404 | 500 | 503; error: string };

interface GameRow {
  video_id: string;
  sport_key: string;
  played_on: string | null;
  side1_name: string | null;
  side1_team_id: string | null;
  side2_name: string | null;
  side2_team_id: string | null;
  coverage: 'highlights' | 'full';
  stats_hidden: boolean;
  updated_at: string;
}

export function projectGame(row: GameRow): GameView {
  return {
    video_id: row.video_id,
    sport_key: row.sport_key,
    played_on: row.played_on,
    side1: { name: row.side1_name, team_id: row.side1_team_id },
    side2: { name: row.side2_name, team_id: row.side2_team_id },
    coverage: row.coverage,
    stats_hidden: row.stats_hidden,
    updated_at: row.updated_at,
  };
}

/** The video's game, or null (none yet, or the table is not here yet). */
export async function readGame(admin: Admin, videoId: string): Promise<GameView | null> {
  const { data, error } = await admin.from('video_games').select(GAME_COLUMNS).eq('video_id', videoId).maybeSingle();
  if (error) {
    if (!isMissingTableError(error.code)) console.error(`${TAG} read failed:`, error.message);
    return null;
  }
  return data ? projectGame(data as unknown as GameRow) : null;
}

/** A side that names a team takes the team's name when none was typed; a team that does not exist is refused. */
async function resolveSides(admin: Admin, input: GameInput): Promise<GameOutcome<GameInput>> {
  const ids = [input.side1.team_id, input.side2.team_id].filter((v): v is string => !!v);
  if (ids.length === 0) return { ok: true, value: input };
  const { data, error } = await admin.from('teams').select('id, name, display_name').in('id', ids);
  if (error) {
    console.error(`${TAG} team read failed:`, error.message);
    return { ok: false, status: 500, error: 'Could not read the team' };
  }
  const byId = new Map((data ?? []).map(t => [(t as { id: string }).id, t as { id: string; name: string; display_name: string | null }]));
  const fill = (side: GameInput['side1']): GameInput['side1'] | null => {
    if (!side.team_id) return side;
    const team = byId.get(side.team_id);
    if (!team) return null;
    return { team_id: side.team_id, name: side.name ?? (team.display_name || team.name).slice(0, 80) };
  };
  const side1 = fill(input.side1);
  const side2 = fill(input.side2);
  if (!side1 || !side2) return { ok: false, status: 400, error: 'That team does not exist' };
  return { ok: true, value: { ...input, side1, side2 } };
}

export async function saveGame(admin: Admin, videoId: string, input: GameInput, userId: string): Promise<GameOutcome<GameView>> {
  const resolved = await resolveSides(admin, input);
  if (!resolved.ok) return resolved;
  const g = resolved.value;
  const { data, error } = await admin
    .from('video_games')
    .upsert(
      {
        video_id: videoId,
        sport_key: g.sport_key,
        played_on: g.played_on,
        side1_name: g.side1.name,
        side1_team_id: g.side1.team_id,
        side2_name: g.side2.name,
        side2_team_id: g.side2.team_id,
        coverage: g.coverage,
        stats_hidden: g.stats_hidden,
        created_by_user_id: userId,
      },
      { onConflict: 'video_id' },
    )
    .select(GAME_COLUMNS)
    .single();
  if (error || !data) {
    if (error && isMissingTableError(error.code)) return { ok: false, status: 503, error: 'Game details are not available here yet' };
    console.error(`${TAG} save failed:`, error?.message);
    return { ok: false, status: 500, error: 'Could not save the game' };
  }
  return { ok: true, value: projectGame(data as unknown as GameRow) };
}

/** The video stops being a game. Its highlights stay (their event tags simply stop being read as a game). */
export async function deleteGame(admin: Admin, videoId: string): Promise<GameOutcome<null>> {
  const { error } = await admin.from('video_games').delete().eq('video_id', videoId);
  if (error && !isMissingTableError(error.code)) {
    console.error(`${TAG} delete failed:`, error.message);
    return { ok: false, status: 500, error: 'Could not remove the game' };
  }
  return { ok: true, value: null };
}
