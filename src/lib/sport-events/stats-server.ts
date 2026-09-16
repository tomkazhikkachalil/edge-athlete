/**
 * The stat lines' server half (Events program, phase 4 — 215
 * `sport_event_stat_lines`): the mint at go-live (one line per fielded
 * player, idempotent on the UNIQUE), the late-joiner sync, the round's
 * board (polled), the WHOLE-OBJECT compare-and-set write (the `writeMatch`
 * shape: UPDATE … WHERE id AND version = seen; 0 rows = 409 with the
 * current row) and the game score's CAS on the round. Every read is on
 * the admin client behind the ONE event gate; names through
 * publicDisplayName (the contest rule).
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { publicDisplayName, publicHandle, type MaskableProfile } from '@/lib/orgs/public-names';
import { PARTICIPANT_COLUMNS } from './access-server';
import { readFormatConfig, readGameConfig } from './format-config';
import { sideNamesOf, type GameScore } from './game';
import { lineHeadline, statSchemaFor, type StatValues } from './stats';
import { shapeOf, type SportEventParticipantRow, type SportEventRoundRow, type SportEventRow } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export const STAT_LINE_COLUMNS = 'id, sport_event_round_id, participant_id, profile_id, stats, version, entered_by, created_at, updated_at';

export interface StatLineRow {
  id: string;
  sport_event_round_id: string;
  participant_id: string;
  profile_id: string;
  stats: StatValues;
  version: number;
  entered_by: string | null;
  created_at: string;
  updated_at: string;
}

/** The mint: one line per accepted, playing, non-follower participant not excluded — idempotent (the UNIQUE; duplicates ignored). */
export async function mintStatRound(admin: Admin, event: Pick<SportEventRow, 'id'>, round: Pick<SportEventRoundRow, 'id'>, excluded: ReadonlySet<string> = new Set()): Promise<boolean> {
  const { data: rows, error: readError } = await admin.from('sport_event_participants').select('id, profile_id, role, playing').eq('sport_event_id', event.id).eq('status', 'accepted').eq('playing', true);
  if (readError) {
    console.error('[sport-events stats] mint roster read failed:', readError);
    return false;
  }
  const players = ((rows ?? []) as Array<{ id: string; profile_id: string; role: string; playing: boolean }>).filter(r => r.role !== 'follower' && !excluded.has(r.id));
  if (players.length === 0) {
    // A round with nobody fielded still counts as minted once its status flips; nothing to insert.
    return true;
  }
  const { error } = await admin
    .from('sport_event_stat_lines')
    .upsert(players.map(p => ({ sport_event_round_id: round.id, participant_id: p.id, profile_id: p.profile_id })), { onConflict: 'sport_event_round_id,participant_id', ignoreDuplicates: true });
  if (error) {
    console.error('[sport-events stats] mint failed:', error);
    return false;
  }
  return true;
}

/** A late joiner on a LIVE stat round gets a line; a drop removes an untouched line (a line with stats stays — the mirror excludes non-accepted rows). */
export async function syncStatLineForPlayer(admin: Admin, roundId: string, eventId: string, profileId: string, change: 'add' | 'drop'): Promise<void> {
  const { data: row } = await admin.from('sport_event_participants').select('id').eq('sport_event_id', eventId).eq('profile_id', profileId).maybeSingle();
  if (!row) return;
  const participantId = row.id as string;
  if (change === 'add') {
    const { error } = await admin.from('sport_event_stat_lines').upsert({ sport_event_round_id: roundId, participant_id: participantId, profile_id: profileId }, { onConflict: 'sport_event_round_id,participant_id', ignoreDuplicates: true });
    if (error) console.error('[sport-events stats] late line insert failed:', error);
    return;
  }
  const { data: line } = await admin.from('sport_event_stat_lines').select('id, stats').eq('sport_event_round_id', roundId).eq('participant_id', participantId).maybeSingle();
  if (line && Object.keys((line.stats as StatValues) ?? {}).length === 0) {
    const { error } = await admin.from('sport_event_stat_lines').delete().eq('id', line.id);
    if (error) console.error('[sport-events stats] line delete on drop failed:', error);
  }
}

export async function readStatLine(admin: Admin, lineId: string): Promise<StatLineRow | null> {
  const { data } = await admin.from('sport_event_stat_lines').select(STAT_LINE_COLUMNS).eq('id', lineId).maybeSingle();
  return (data as StatLineRow | null) ?? null;
}

/** The whole-object CAS: `UPDATE … SET stats, version = v + 1, entered_by WHERE id AND version = v`. */
export async function writeStatLine(admin: Admin, lineId: string, expectedVersion: number, stats: StatValues, enteredBy: string): Promise<{ outcome: 'ok'; line: StatLineRow } | { outcome: 'conflict' | 'error' }> {
  const { data, error } = await admin.from('sport_event_stat_lines').update({ stats, version: expectedVersion + 1, entered_by: enteredBy }).eq('id', lineId).eq('version', expectedVersion).select(STAT_LINE_COLUMNS).maybeSingle();
  if (error) {
    console.error('[sport-events stats] line write failed:', error);
    return { outcome: 'error' };
  }
  return data ? { outcome: 'ok', line: data as StatLineRow } : { outcome: 'conflict' };
}

/** The game score's CAS on the round (`score_version`, a different predicate from the lifecycle's status CAS). */
export async function writeGameScore(admin: Admin, roundId: string, expectedVersion: number, score: { side1_score: number; side2_score: number; period: number }): Promise<'ok' | 'conflict' | 'error'> {
  const { data, error } = await admin.from('sport_event_rounds').update({ ...score, score_version: expectedVersion + 1 }).eq('id', roundId).eq('score_version', expectedVersion).select('id').maybeSingle();
  if (error) {
    console.error('[sport-events stats] score write failed:', error);
    return 'error';
  }
  return data ? 'ok' : 'conflict';
}

export const scoreOf = (round: Pick<SportEventRoundRow, 'side1_score' | 'side2_score' | 'period' | 'score_version'>): GameScore & { version: number } => ({
  side1_score: round.side1_score ?? null,
  side2_score: round.side2_score ?? null,
  period: round.period ?? null,
  version: round.score_version ?? 0,
});

export interface StatLineView {
  id: string;
  participant_id: string;
  profile_id: string;
  name: string;
  handle: string | null;
  avatar_url: string | null;
  side: 1 | 2 | null;
  position: number | null;
  stats: StatValues;
  version: number;
  headline: string | null;
}

export interface RoundStatsPayload {
  round: { id: string; sequence: number; status: string; course_name: string; scheduled_on: string; starts_at: string | null; score: GameScore & { version: number } };
  shape: 'game' | 'session';
  sport_key: string;
  /** A game's side names; null on a session. */
  sides: [string, string] | null;
  fields: Array<{ key: string; label: string; shortLabel: string; min?: number; max?: number }>;
  lines: StatLineView[];
  viewer: {
    /** 'all' for an organizer / recorder; the viewer's own line ids under self entry; [] otherwise. */
    can_enter: 'all' | string[];
    /** The game score (a recorder's / organizer's, on a game). */
    can_score: boolean;
  };
}

/** The round's board: every line with its player (masked), side and headline — side 1 first, then position, then name. */
export async function readRoundStats(admin: Admin, event: SportEventRow, round: SportEventRoundRow, viewer: { profileId: string | null; canManage: boolean }): Promise<RoundStatsPayload | null> {
  const schema = statSchemaFor(event.sport_key);
  const shape = shapeOf(event);
  if (!schema || shape === 'round') return null;
  const [{ data: lineRows }, { data: partRows }, { data: memberRows }] = await Promise.all([
    admin.from('sport_event_stat_lines').select(STAT_LINE_COLUMNS).eq('sport_event_round_id', round.id),
    admin.from('sport_event_participants').select(PARTICIPANT_COLUMNS).eq('sport_event_id', event.id),
    admin.from('sport_event_group_members').select('participant_id, position, side').eq('sport_event_round_id', round.id),
  ]);
  const lines = (lineRows ?? []) as StatLineRow[];
  const parts = (partRows ?? []) as SportEventParticipantRow[];
  const memberByParticipant = new Map(((memberRows ?? []) as Array<{ participant_id: string; position: number; side: number | null }>).map(m => [m.participant_id, m]));
  const profileIds = [...new Set(lines.map(l => l.profile_id))];
  const { data: profRows } = profileIds.length > 0 ? await admin.from('profiles').select('id, first_name, last_name, full_name, visibility, email, supervision_state, handle, avatar_url').in('id', profileIds) : { data: [] };
  const profById = new Map(((profRows ?? []) as Array<MaskableProfile & { id: string; avatar_url: string | null }>).map(p => [p.id, p]));

  const views: StatLineView[] = lines.map(l => {
    const prof = profById.get(l.profile_id) ?? null;
    const m = memberByParticipant.get(l.participant_id) ?? null;
    return {
      id: l.id,
      participant_id: l.participant_id,
      profile_id: l.profile_id,
      name: prof ? publicDisplayName(prof) : 'Athlete',
      handle: prof ? publicHandle(prof) : null,
      avatar_url: prof?.avatar_url ?? null,
      side: m?.side === 1 || m?.side === 2 ? m.side : null,
      position: m?.position ?? null,
      stats: (l.stats ?? {}) as StatValues,
      version: l.version,
      headline: lineHeadline((l.stats ?? {}) as StatValues, schema),
    };
  });
  views.sort((a, b) => (a.side ?? 3) - (b.side ?? 3) || (a.position ?? 9999) - (b.position ?? 9999) || a.name.localeCompare(b.name));

  const own = viewer.profileId ? parts.find(p => p.profile_id === viewer.profileId && p.status === 'accepted') ?? null : null;
  const recorder = viewer.canManage || own?.recorder === true;
  const selfEntry = event.self_entry !== false;
  const can_enter: 'all' | string[] = recorder ? 'all' : own && selfEntry ? views.filter(v => v.participant_id === own.id).map(v => v.id) : [];
  const game = readGameConfig(readFormatConfig(event.format_config, 8, event.format, shape), shape);
  return {
    round: { id: round.id, sequence: round.sequence, status: round.status, course_name: round.course_name, scheduled_on: round.scheduled_on, starts_at: round.starts_at ?? null, score: scoreOf(round) },
    shape,
    sport_key: event.sport_key,
    sides: shape === 'game' ? sideNamesOf(game) : null,
    fields: schema.fields.map(f => ({ key: f.key, label: f.label, shortLabel: f.shortLabel, ...(f.min !== undefined ? { min: f.min } : {}), ...(f.max !== undefined ? { max: f.max } : {}) })),
    lines: views,
    viewer: { can_enter, can_score: shape === 'game' && recorder },
  };
}
