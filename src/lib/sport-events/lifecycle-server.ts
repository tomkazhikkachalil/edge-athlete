/**
 * The lifecycle — the I/O half (Events program, PR 5). `applyTransition`
 * reads the facts, asks `validateTransition` (pure), does the transition's
 * work, and compare-and-sets the status so two organizers racing cannot
 * both win.
 *
 *   open      → mint the round's POST (announced)
 *   live      → mintRound: the group_posts row (the shared-round creation
 *               sequence of api/group-posts/route.ts on the admin client,
 *               attaching the EXISTING post instead of creating one; no
 *               group_invite bells — the event's own bells did that);
 *               rounds → live
 *   completed → override finalizes the cards as they stand; the round's
 *               group_post is forced to completed (guarded), mirrored
 *               (golf_rounds + media), its post re-timestamped (the End
 *               Round path); rounds → completed; the results bell. The
 *               mirror itself skips players who hid the result (opt-out.ts).
 *   cancelled → rounds → cancelled, the announce post deleted (nothing
 *               else was minted: live is never cancelled).
 *
 * Every mint is idempotent on the 203 UNIQUE: a round already minted is
 * reused, so a retry after a half-failure completes instead of doubling.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { mirrorCompletedRound, mirrorRoundMedia } from '@/lib/golf/round-mirror';
import { EVENT_COLUMNS, PARTICIPANT_COLUMNS } from './access-server';
import { transitionStamp, TRANSITION_REFUSAL_COPY, validateTransition, type TransitionFacts, type TransitionRefusal } from './lifecycle';
import { announcePostRow, groupPostRow, participantRows, scorecardRow } from './mint';
import { buildMintPlan, type MintGroup, type MintPlayer } from './rounds';
import { notifyResults } from './notify';
import { ROUND_COLUMNS } from './rounds-server';
import type { SportEventParticipantRow, SportEventRoundRow, SportEventRow, SportEventStatus } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export interface MintedRound extends SportEventRoundRow {
  group_post_id: string | null;
  announce_post_id: string | null;
}

export async function readRounds(admin: Admin, eventId: string): Promise<MintedRound[]> {
  const { data: rounds } = await admin.from('sport_event_rounds').select(ROUND_COLUMNS).eq('sport_event_id', eventId).order('sequence', { ascending: true });
  const rows = (rounds ?? []) as SportEventRoundRow[];
  if (rows.length === 0) return [];
  const ids = rows.map(r => r.id);
  const [{ data: gps }, { data: posts }] = await Promise.all([
    admin.from('group_posts').select('id, sport_event_round_id').in('sport_event_round_id', ids),
    admin.from('posts').select('id, sport_event_round_id').in('sport_event_round_id', ids),
  ]);
  const gpByRound = new Map<string, string>();
  for (const g of (gps ?? []) as Array<{ id: string; sport_event_round_id: string }>) gpByRound.set(g.sport_event_round_id, g.id);
  const postByRound = new Map<string, string>();
  for (const p of (posts ?? []) as Array<{ id: string; sport_event_round_id: string }>) postByRound.set(p.sport_event_round_id, p.id);
  return rows.map(r => ({ ...r, group_post_id: gpByRound.get(r.id) ?? null, announce_post_id: postByRound.get(r.id) ?? null }));
}

async function acceptedPlaying(admin: Admin, eventId: string): Promise<SportEventParticipantRow[]> {
  const { data } = await admin.from('sport_event_participants').select(PARTICIPANT_COLUMNS).eq('sport_event_id', eventId).eq('status', 'accepted').eq('playing', true);
  return (data ?? []) as SportEventParticipantRow[];
}

/** The cards of the accepted, playing participants on the minted rounds. */
async function readCards(admin: Admin, rounds: MintedRound[], players: SportEventParticipantRow[]): Promise<Array<{ participant_row_id: string; profile_id: string; status: 'in_progress' | 'submitted' | 'final' }>> {
  const gpIds = rounds.map(r => r.group_post_id).filter((v): v is string => !!v);
  if (gpIds.length === 0 || players.length === 0) return [];
  const profileIds = new Set(players.map(p => p.profile_id));
  const { data: rows } = await admin.from('group_post_participants').select('id, profile_id, status').in('group_post_id', gpIds);
  const playing = ((rows ?? []) as Array<{ id: string; profile_id: string; status: string }>).filter(r => profileIds.has(r.profile_id) && r.status !== 'declined');
  if (playing.length === 0) return [];
  const { data: cards } = await admin.from('golf_participant_scores').select('participant_id, status').in('participant_id', playing.map(r => r.id));
  const statusByRow = new Map<string, string>();
  for (const c of (cards ?? []) as Array<{ participant_id: string; status: string }>) statusByRow.set(c.participant_id, c.status);
  return playing.map(r => ({ participant_row_id: r.id, profile_id: r.profile_id, status: (statusByRow.get(r.id) ?? 'in_progress') as 'in_progress' | 'submitted' | 'final' }));
}

export type TransitionOutcome =
  | { ok: true; event: SportEventRow; rounds: MintedRound[] }
  | { ok: false; status: 404 | 409 | 500; reason: TransitionRefusal | 'mint_failed' | 'conflict' | 'not_found'; error: string };

export interface TransitionRequest {
  eventId: string;
  to: SportEventStatus;
  actorProfileId: string;
  override?: boolean;
  /** The organizer's local date for the round's group_post (date-only); defaults to the round's scheduled_on. */
  today?: string | null;
}

export async function applyTransition(admin: Admin, req: TransitionRequest): Promise<TransitionOutcome> {
  const { data: eventRow } = await admin.from('sport_events').select(EVENT_COLUMNS).eq('id', req.eventId).maybeSingle();
  if (!eventRow) return { ok: false, status: 404, reason: 'not_found', error: 'Event not found' };
  const event = eventRow as SportEventRow;
  const from = event.status;
  const rounds = await readRounds(admin, req.eventId);
  const players = await acceptedPlaying(admin, req.eventId);
  const cards = req.to === 'completed' ? await readCards(admin, rounds, players) : [];

  const facts: TransitionFacts = {
    name: event.name,
    rounds: rounds.map(r => ({ scheduledOn: r.scheduled_on, groupPostMinted: r.group_post_id !== null })),
    acceptedPlaying: players.length,
    cards: cards.map(c => ({ status: c.status })),
    override: req.override === true,
  };

  // The mint runs BEFORE the live verdict so `round_not_minted` is a real refusal, never a scheduling gap.
  if (req.to === 'live') {
    const pre = validateTransition(from, 'live', { ...facts, rounds: facts.rounds.map(r => ({ ...r, groupPostMinted: true })) });
    if (!pre.ok) return { ok: false, status: 409, reason: pre.reason, error: TRANSITION_REFUSAL_COPY[pre.reason] };
    for (const round of rounds) {
      if (round.group_post_id || round.status === 'cancelled') continue;
      const gpId = await mintRound(admin, event, round, rounds.length, req.today ?? null);
      if (!gpId) return { ok: false, status: 500, reason: 'mint_failed', error: TRANSITION_REFUSAL_COPY.round_not_minted };
      round.group_post_id = gpId;
      facts.rounds = rounds.map(r => ({ scheduledOn: r.scheduled_on, groupPostMinted: r.group_post_id !== null }));
    }
  }

  const verdict = validateTransition(from, req.to, facts);
  if (!verdict.ok) return { ok: false, status: 409, reason: verdict.reason, error: TRANSITION_REFUSAL_COPY[verdict.reason] };

  const now = new Date().toISOString();

  if (req.to === 'open') {
    for (const round of rounds) {
      if (round.announce_post_id || round.status === 'cancelled') continue;
      const { data: post, error } = await admin.from('posts').insert(announcePostRow(event, round)).select('id').single();
      if (error || !post) {
        console.error('[sport-events] announce post mint failed:', error);
        return { ok: false, status: 500, reason: 'mint_failed', error: 'Could not publish the event. Nothing was changed — please try again.' };
      }
      round.announce_post_id = post.id as string;
    }
  }

  if (req.to === 'completed') {
    if (req.override === true) {
      const open = cards.filter(c => c.status !== 'final').map(c => c.participant_row_id);
      if (open.length > 0) {
        const { error } = await admin.from('golf_participant_scores').update({ status: 'final', finalized_by: req.actorProfileId, submitted_at: now }).in('participant_id', open);
        if (error) console.error('[sport-events] override finalize failed:', error);
      }
    }
    for (const round of rounds) {
      if (!round.group_post_id) continue;
      const { data: prior } = await admin.from('group_posts').select('status').eq('id', round.group_post_id).maybeSingle();
      if (prior?.status !== 'completed') {
        const { error } = await admin.from('group_posts').update({ status: 'completed' }).eq('id', round.group_post_id).neq('status', 'completed');
        if (error) console.error('[sport-events] round completion failed:', error);
        await mirrorCompletedRound(admin, round.group_post_id);
        await mirrorRoundMedia(admin, round.group_post_id);
        const { error: bumpError } = await admin.from('posts').update({ created_at: now }).eq('group_post_id', round.group_post_id);
        if (bumpError) console.error('[sport-events] results post bump failed:', bumpError);
      }
    }
  }

  if (req.to === 'cancelled') {
    const roundIds = rounds.map(r => r.id);
    if (roundIds.length > 0) {
      const { error } = await admin.from('posts').delete().in('sport_event_round_id', roundIds).is('group_post_id', null);
      if (error) console.error('[sport-events] announce post delete on cancel failed:', error);
    }
  }

  // Compare-and-set the status; a lost race answers 409 without undoing the idempotent mints.
  const stamp = transitionStamp(req.to);
  const { data: updated, error: casError } = await admin
    .from('sport_events')
    .update({ status: req.to, ...(stamp ? { [stamp]: now } : {}) })
    .eq('id', req.eventId)
    .eq('status', from)
    .select(EVENT_COLUMNS)
    .maybeSingle();
  if (casError || !updated) {
    if (casError) console.error('[sport-events] transition write failed:', casError);
    return { ok: false, status: 409, reason: 'conflict', error: 'The event changed while you were working. Reload and try again.' };
  }

  const roundStatus = req.to === 'live' ? 'live' : req.to === 'completed' ? 'completed' : req.to === 'cancelled' ? 'cancelled' : null;
  if (roundStatus) {
    const { error } = await admin.from('sport_event_rounds').update({ status: roundStatus }).eq('sport_event_id', req.eventId).neq('status', 'cancelled');
    if (error) console.error('[sport-events] round status write failed:', error);
  }
  if (req.to === 'completed') await notifyResults(admin, event, req.actorProfileId);

  return { ok: true, event: updated as SportEventRow, rounds: await readRounds(admin, req.eventId) };
}

/**
 * Mint a round's group_posts row: the row, the participant rows in mint
 * order, the scorecard WITH the stroke index, then attach the existing
 * announce post (posts.group_post_id ← the round; group_posts.post_id ←
 * the post). Any failure deletes the group_post (FK cascades take the
 * children) and answers null — the abortCreation semantics.
 */
export async function mintRound(admin: Admin, event: SportEventRow, round: MintedRound, roundCount: number, today: string | null): Promise<string | null> {
  const { data: existing } = await admin.from('group_posts').select('id').eq('sport_event_round_id', round.id).maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: allRows } = await admin.from('sport_event_participants').select(PARTICIPANT_COLUMNS).eq('sport_event_id', event.id).eq('status', 'accepted');
  const accepted = (allRows ?? []) as SportEventParticipantRow[];
  const mintPlayers: MintPlayer[] = accepted
    .filter(r => r.role !== 'follower')
    .map(r => ({ participantId: r.id, profileId: r.profile_id, role: r.role as MintPlayer['role'], playing: r.playing }));
  const { data: groups } = await admin.from('sport_event_groups').select('id, sequence').eq('sport_event_round_id', round.id);
  const { data: members } = await admin.from('sport_event_group_members').select('group_id, participant_id, position').eq('sport_event_round_id', round.id);
  const mintGroups: MintGroup[] = ((groups ?? []) as Array<{ id: string; sequence: number }>).map(g => ({
    id: g.id,
    sequence: g.sequence,
    members: ((members ?? []) as Array<{ group_id: string; participant_id: string; position: number }>).filter(m => m.group_id === g.id).map(m => ({ participantId: m.participant_id, position: m.position })),
  }));
  const plan = buildMintPlan({ hostProfileId: event.host_profile_id, visibility: event.visibility, format: event.format, players: mintPlayers, groups: mintGroups });

  const { data: gp, error: gpError } = await admin.from('group_posts').insert(groupPostRow(event, round, { roundCount, date: today ?? round.scheduled_on })).select('id').single();
  if (gpError || !gp) {
    console.error('[sport-events] mintRound: group_post insert failed:', gpError);
    return null;
  }
  const gpId = gp.id as string;
  const abort = async (step: string, err: unknown): Promise<null> => {
    console.error(`[sport-events] mintRound failed at ${step}:`, err);
    await admin.from('posts').update({ group_post_id: null }).eq('group_post_id', gpId);
    const { error } = await admin.from('group_posts').delete().eq('id', gpId);
    if (error) console.error('[sport-events] mintRound cleanup failed:', error);
    return null;
  };

  const now = new Date().toISOString();
  const { error: partError } = await admin.from('group_post_participants').insert(participantRows(plan, gpId, now));
  if (partError) return abort('participants', partError);
  const { error: cardError } = await admin.from('golf_scorecard_data').insert(scorecardRow(round, gpId));
  if (cardError) return abort('scorecard', cardError);

  let postId = round.announce_post_id;
  if (!postId) {
    const { data: post, error } = await admin.from('posts').insert(announcePostRow(event, round)).select('id').single();
    if (error || !post) return abort('post', error);
    postId = post.id as string;
  }
  const { error: attachError } = await admin.from('posts').update({ group_post_id: gpId }).eq('id', postId);
  if (attachError) return abort('attach', attachError);
  const { error: linkError } = await admin.from('group_posts').update({ post_id: postId }).eq('id', gpId);
  if (linkError) console.error('[sport-events] mintRound: group_posts.post_id backfill failed:', linkError);
  return gpId;
}

/**
 * Keep the minted rounds' rosters in step with the event after go-live: a
 * late accept joins every minted round (at the end of the order); a
 * withdraw / remove marks the round row declined so the round machine
 * ignores them. Best-effort.
 */
export async function syncRoundRoster(admin: Admin, eventId: string, profileId: string, change: 'add' | 'drop'): Promise<void> {
  try {
    const rounds = await readRounds(admin, eventId);
    for (const round of rounds) {
      if (!round.group_post_id) continue;
      const { data: existing } = await admin.from('group_post_participants').select('id, status, position').eq('group_post_id', round.group_post_id).eq('profile_id', profileId).maybeSingle();
      if (change === 'drop') {
        if (existing?.id) await admin.from('group_post_participants').update({ status: 'declined' }).eq('id', existing.id);
        continue;
      }
      if (existing?.id) {
        if (existing.status === 'declined') await admin.from('group_post_participants').update({ status: 'confirmed' }).eq('id', existing.id);
        continue;
      }
      const { data: last } = await admin.from('group_post_participants').select('position').eq('group_post_id', round.group_post_id).order('position', { ascending: false, nullsFirst: false }).limit(1).maybeSingle();
      const position = typeof last?.position === 'number' ? last.position + 1 : 1;
      const { error } = await admin.from('group_post_participants').insert({ group_post_id: round.group_post_id, profile_id: profileId, role: 'participant', status: 'confirmed', attested_at: new Date().toISOString(), position });
      if (error) console.error('[sport-events] late joiner insert failed:', error);
    }
  } catch (e) {
    console.error('[sport-events] round roster sync failed:', e);
  }
}
