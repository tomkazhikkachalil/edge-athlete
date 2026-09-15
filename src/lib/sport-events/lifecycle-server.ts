/**
 * The lifecycle — the I/O half (Events program, PR 5). `applyTransition`
 * reads the facts, asks `validateTransition` (pure), does the transition's
 * work, and compare-and-sets the status so two organizers racing cannot
 * both win.
 *
 *   open      → mint the round's POST (announced)
 *   live      → (phase 2: sugar for the next startable ROUND's start)
 *               mintRound: the group_posts row (the shared-round creation
 *               sequence of api/group-posts/route.ts on the admin client,
 *               attaching the EXISTING post instead of creating one; no
 *               group_invite bells — the event's own bells did that);
 *               that round → live; the event → live
 *   completed → (phase 2: sugar for the LIVE round's completion; refused
 *               while another round is scheduled) override finalizes that
 *               round's cards as they stand; its group_post is forced to
 *               completed (guarded), mirrored (golf_rounds + media), its
 *               post re-timestamped (the End Round path); the round →
 *               completed; the event follows when no round is left; the
 *               results bell. The mirror skips players who hid the result.
 *   cancelled → every round → cancelled (the one round-wide write left),
 *               the announce posts deleted (nothing else was minted: live
 *               is never cancelled).
 * `applyRoundTransition` is the round-level machine itself (phase 2).
 *
 * Every mint is idempotent on the 203 UNIQUE: a round already minted is
 * reused, so a retry after a half-failure completes instead of doubling.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { mirrorCompletedRound, mirrorRoundMedia } from '@/lib/golf/round-mirror';
import { EVENT_COLUMNS, PARTICIPANT_COLUMNS } from './access-server';
import { canTransition, eventStatusAfterRound, nextStartableRound, ROUND_REFUSAL_COPY, transitionStamp, TRANSITION_REFUSAL_COPY, validateRoundTransition, validateTransition, type RoundTransitionFacts, type RoundTransitionRefusal, type TransitionFacts, type TransitionRefusal } from './lifecycle';
import { announcePostRow, groupPostRow, participantRows, scorecardRow } from './mint';
import { activeRounds, buildMintPlan, type MintGroup, type MintPlayer } from './rounds';
import { notifyResults } from './notify';
import { syncContestStatus, syncSportEventContest } from './contest-sync-server';
import { ROUND_COLUMNS } from './rounds-server';
import { cutDecided } from './cut';
import { readFormatConfig, readMatchConfig } from './format-config';
import { groupsIncomplete } from './match';
import { closeMatchesOnCompletion, fetchRoundMatches, mintMatches, readRoundGroups, type RoundGroup, type RoundMatch } from './match-server';
import { fetchOverallLeaderboard } from './leaderboard-server';
import { writeStartsOn } from './rounds-server';
import { isMatchFormat, type SportEventParticipantRow, type SportEventRoundRow, type SportEventRoundStatus, type SportEventRow, type SportEventStatus } from './types';

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

/**
 * The participants a round does NOT field (phase 3, the ONE helper the mint
 * and the completion gate share — two copies would drift): past a decided
 * cut, the missed-cut set from the overall board (never stored). The host's
 * creator row is minted regardless (they run the round), so the completion
 * field must drop them here too — the host who missed their own cut used to
 * block round 2 with an empty card. On a MATCH format the round fields ONLY
 * its draw: an accepted player in no group of this round is not minted (a
 * late acceptor is drawn into a later round by hand).
 */
export async function roundFieldExclusions(admin: Admin, event: SportEventRow, rounds: MintedRound[], round: Pick<MintedRound, 'id' | 'sequence'>, opts: { groups?: RoundGroup[] } = {}): Promise<ReadonlySet<string>> {
  const config = readFormatConfig(event.format_config, activeRounds(rounds).length, event.format);
  if (readMatchConfig(config, event.format)) {
    const groups = opts.groups ?? await readRoundGroups(admin, round.id);
    const grouped = new Set(groups.flatMap(g => g.members.map(m => m.participant_id)));
    const players = await acceptedPlaying(admin, event.id);
    return new Set(players.filter(p => !grouped.has(p.id)).map(p => p.id));
  }
  const cut = config.cut ?? null;
  if (!cut || round.sequence <= cut.after_round || !cutDecided(cut, rounds)) return new Set();
  const board = await fetchOverallLeaderboard(admin, event, rounds, { cut });
  return new Set(board.board.rows.filter(r => r.madeCut === false).map(r => r.participantId));
}

/** The round's FIELD: the cards of the accepted, playing participants minted into the rounds, minus the excluded (one entry per player; no card = in_progress). */
async function readCards(admin: Admin, rounds: MintedRound[], players: SportEventParticipantRow[], excluded: ReadonlySet<string> = new Set()): Promise<Array<{ participant_row_id: string; profile_id: string; status: 'in_progress' | 'submitted' | 'final'; has_card: boolean }>> {
  const gpIds = rounds.map(r => r.group_post_id).filter((v): v is string => !!v);
  const fielded = players.filter(p => !excluded.has(p.id));
  if (gpIds.length === 0 || fielded.length === 0) return [];
  const profileIds = new Set(fielded.map(p => p.profile_id));
  const { data: rows } = await admin.from('group_post_participants').select('id, profile_id, status').in('group_post_id', gpIds);
  const playing = ((rows ?? []) as Array<{ id: string; profile_id: string; status: string }>).filter(r => profileIds.has(r.profile_id) && r.status !== 'declined');
  if (playing.length === 0) return [];
  const { data: cards } = await admin.from('golf_participant_scores').select('participant_id, status').in('participant_id', playing.map(r => r.id));
  const statusByRow = new Map<string, string>();
  for (const c of (cards ?? []) as Array<{ participant_id: string; status: string }>) statusByRow.set(c.participant_id, c.status);
  return playing.map(r => ({ participant_row_id: r.id, profile_id: r.profile_id, status: (statusByRow.get(r.id) ?? 'in_progress') as 'in_progress' | 'submitted' | 'final', has_card: statusByRow.has(r.id) }));
}

export type TransitionOutcome =
  | { ok: true; event: SportEventRow; rounds: MintedRound[] }
  | { ok: false; status: 404 | 409 | 500; reason: TransitionRefusal | RoundTransitionRefusal | 'mint_failed' | 'conflict' | 'not_found'; error: string };

export interface TransitionRequest {
  eventId: string;
  to: SportEventStatus;
  actorProfileId: string;
  override?: boolean;
  /** The organizer's local date for the round's group_post (date-only); defaults to the round's scheduled_on. */
  today?: string | null;
}

/**
 * The EVENT-level transition. Phase 2: `live` and `completed` are sugar
 * over the round lifecycle — live starts the next startable round,
 * completed completes the live round and refuses while another round is
 * still scheduled (`rounds_remaining`) — so a single-round event behaves
 * exactly as in phase 1. `open` and `cancelled` stay event-wide.
 */
export async function applyTransition(admin: Admin, req: TransitionRequest): Promise<TransitionOutcome> {
  const { data: eventRow } = await admin.from('sport_events').select(EVENT_COLUMNS).eq('id', req.eventId).maybeSingle();
  if (!eventRow) return { ok: false, status: 404, reason: 'not_found', error: 'Event not found' };
  const event = eventRow as SportEventRow;
  const from = event.status;
  const rounds = await readRounds(admin, req.eventId);

  if (req.to === 'live' || req.to === 'completed') {
    if (!canTransition(from, req.to)) return { ok: false, status: 409, reason: 'invalid_transition', error: TRANSITION_REFUSAL_COPY.invalid_transition };
    if (req.to === 'live') {
      const next = nextStartableRound(rounds);
      if (!next) return { ok: false, status: 409, reason: 'round_required', error: TRANSITION_REFUSAL_COPY.round_required };
      return applyRoundTransition(admin, { eventId: req.eventId, roundId: next.id, to: 'live', actorProfileId: req.actorProfileId, override: req.override, today: req.today });
    }
    if (rounds.some(r => r.status === 'scheduled')) return { ok: false, status: 409, reason: 'rounds_remaining', error: TRANSITION_REFUSAL_COPY.rounds_remaining };
    const live = rounds.find(r => r.status === 'live');
    if (live) return applyRoundTransition(admin, { eventId: req.eventId, roundId: live.id, to: 'completed', actorProfileId: req.actorProfileId, override: req.override, today: req.today });
    // Nothing live, nothing scheduled: every round is already done — close the header.
    return closeEvent(admin, event, req.actorProfileId);
  }

  const players = await acceptedPlaying(admin, req.eventId);
  const facts: TransitionFacts = {
    name: event.name,
    rounds: rounds.map(r => ({ scheduledOn: r.scheduled_on, groupPostMinted: r.group_post_id !== null, status: r.status })),
    acceptedPlaying: players.length,
    cards: [],
    override: req.override === true,
  };
  const verdict = validateTransition(from, req.to, facts);
  if (!verdict.ok) return { ok: false, status: 409, reason: verdict.reason, error: TRANSITION_REFUSAL_COPY[verdict.reason] };

  const now = new Date().toISOString();

  if (req.to === 'open') {
    for (const round of rounds) {
      if (round.announce_post_id || round.status === 'cancelled') continue;
      const postId = await mintAnnouncePost(admin, event, round);
      if (!postId) return { ok: false, status: 500, reason: 'mint_failed', error: 'Could not publish the event. Nothing was changed — please try again.' };
      round.announce_post_id = postId;
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

  // Cancelling the event is the one round-wide status write that survives phase 2: every round goes with it.
  if (req.to === 'cancelled') {
    const { error } = await admin.from('sport_event_rounds').update({ status: 'cancelled' }).eq('sport_event_id', req.eventId).neq('status', 'cancelled');
    if (error) console.error('[sport-events] round status write failed:', error);
  }

  return { ok: true, event: updated as SportEventRow, rounds: await readRounds(admin, req.eventId) };
}

export interface RoundTransitionRequest {
  eventId: string;
  roundId: string;
  to: SportEventRoundStatus;
  actorProfileId: string;
  override?: boolean;
  today?: string | null;
}

/**
 * The ROUND-level transition (phase 2 — the unit of organizer intent):
 *   live      → mint THIS round (the missed-cut set excluded once a cut is
 *               decided), the round → live, an open event → live;
 *   completed → override finalizes THIS round's cards as they stand; its
 *               group_post is forced complete (guarded), mirrored, its post
 *               re-timestamped; the round → completed; a live event with no
 *               round left scheduled or live → completed + the results bell;
 *   cancelled → the announce post deleted, the round → cancelled,
 *               starts_on rewritten; the event follows (a live event whose
 *               last remaining round was cancelled completes).
 * Every status write is a compare-and-set on the row's prior status.
 */
export async function applyRoundTransition(admin: Admin, req: RoundTransitionRequest): Promise<TransitionOutcome> {
  const { data: eventRow } = await admin.from('sport_events').select(EVENT_COLUMNS).eq('id', req.eventId).maybeSingle();
  if (!eventRow) return { ok: false, status: 404, reason: 'not_found', error: 'Event not found' };
  const event = eventRow as SportEventRow;
  const rounds = await readRounds(admin, req.eventId);
  const round = rounds.find(r => r.id === req.roundId);
  if (!round) return { ok: false, status: 404, reason: 'not_found', error: 'Round not found' };
  const players = await acceptedPlaying(admin, req.eventId);
  // Phase 3: a match round's draw and its matches — the gate is theirs (groups_incomplete at start, matches_undecided at completion), never the cards'.
  const match = readMatchConfig(readFormatConfig(event.format_config, activeRounds(rounds).length, event.format), event.format);
  const groups = match && (req.to === 'live' || req.to === 'completed') ? await readRoundGroups(admin, round.id) : [];
  const incomplete = match && req.to === 'live' ? groupsIncomplete(groups, match.sides, match.bracket) : [];
  const matches: RoundMatch[] = match && req.to === 'completed' ? await fetchRoundMatches(admin, event, round, { groups }) : [];
  const undecided = matches.filter(m => m.state.status !== 'completed');
  const groupName = (sequence: number) => groups.find(g => g.sequence === sequence)?.name?.trim() || `Match ${sequence}`;
  // The round's field (the cut's missed set, or the players outside a match round's draw — never stored) — the same set the mint below excludes.
  const excluded = req.to === 'live' || req.to === 'completed' ? await roundFieldExclusions(admin, event, rounds, round, { groups }) : new Set<string>();
  const cards = req.to === 'completed' ? await readCards(admin, [round], players, excluded) : [];

  const factsFor = (minted: boolean): RoundTransitionFacts => ({
    eventStatus: event.status,
    round: { sequence: round.sequence, status: round.status, groupPostMinted: minted },
    rounds: rounds.map(r => ({ sequence: r.sequence, status: r.status })),
    acceptedPlaying: players.length,
    cards: cards.map(c => ({ status: c.status })),
    override: req.override === true,
    match: match ? { groupsIncomplete: incomplete.length + (req.to === 'live' && groups.length === 0 ? 1 : 0), undecided: undecided.length } : null,
  });
  const refusalError = (reason: RoundTransitionRefusal): string => {
    if (reason === 'groups_incomplete') return groups.length === 0 ? 'Set the draw before the round starts — every match needs its two sides.' : `${ROUND_REFUSAL_COPY.groups_incomplete} Check: ${incomplete.map(i => groupName(i.sequence)).join(', ')}.`;
    if (reason === 'matches_undecided') return `${ROUND_REFUSAL_COPY.matches_undecided} Still open: ${undecided.map(m => m.group.name?.trim() || `Match ${m.group.sequence}`).join(', ')}.`;
    return ROUND_REFUSAL_COPY[reason];
  };

  // The mint runs BEFORE the live verdict so `round_not_minted` is a real refusal, never a scheduling gap.
  if (req.to === 'live') {
    const pre = validateRoundTransition('live', factsFor(true));
    if (!pre.ok) return { ok: false, status: 409, reason: pre.reason, error: refusalError(pre.reason) };
    if (!round.group_post_id) {
      // Phase 2: past a decided cut, the missed-cut set is not minted into this round (the overall board decides — never stored; `roundFieldExclusions` is the one rule). Phase 3: a match round mints its draw only.
      const gpId = await mintRound(admin, event, round, activeRounds(rounds).length, req.today ?? null, { excludeParticipantIds: excluded.size > 0 ? excluded : undefined, gameFormat: match ? 'match' : 'stroke' });
      if (!gpId) return { ok: false, status: 500, reason: 'mint_failed', error: ROUND_REFUSAL_COPY.round_not_minted };
      round.group_post_id = gpId;
    }
    // Phase 3: one match row per group (idempotent; a bracket bye decided at mint).
    if (match && !(await mintMatches(admin, round.id, groups, match, new Date().toISOString()))) return { ok: false, status: 500, reason: 'mint_failed', error: ROUND_REFUSAL_COPY.round_not_minted };
  }

  const verdict = validateRoundTransition(req.to, factsFor(round.group_post_id !== null));
  if (!verdict.ok) return { ok: false, status: 409, reason: verdict.reason, error: refusalError(verdict.reason) };

  const now = new Date().toISOString();

  if (req.to === 'completed') {
    // A match round finalizes every card as it stands (a conceded hole has no strokes — card status is irrelevant to a match; the matches were the gate).
    if (req.override === true || match) {
      // "Finalized as they stand": existing cards are closed; a player who
      // never scored gets a final, empty card (the finalize route's rule),
      // so the round reads final for everyone.
      const open = cards.filter(c => c.status !== 'final');
      const existing = open.filter(c => c.has_card).map(c => c.participant_row_id);
      if (existing.length > 0) {
        const { error } = await admin.from('golf_participant_scores').update({ status: 'final', finalized_by: req.actorProfileId, submitted_at: now }).in('participant_id', existing);
        if (error) console.error('[sport-events] override finalize failed:', error);
      }
      const missing = open.filter(c => !c.has_card);
      if (missing.length > 0) {
        const { error } = await admin.from('golf_participant_scores').insert(missing.map(c => ({ participant_id: c.participant_row_id, entered_by: req.actorProfileId, scores_confirmed: false, status: 'final', finalized_by: req.actorProfileId, submitted_at: now })));
        if (error) console.error('[sport-events] override finalize (empty cards) failed:', error);
      }
    }
    if (round.group_post_id) {
      const { data: prior } = await admin.from('group_posts').select('status').eq('id', round.group_post_id).maybeSingle();
      if (prior?.status !== 'completed') {
        const { error } = await admin.from('group_posts').update({ status: 'completed' }).eq('id', round.group_post_id).neq('status', 'completed');
        if (error) console.error('[sport-events] round completion failed:', error);
        await mirrorCompletedRound(admin, round.group_post_id);
        await mirrorRoundMedia(admin, round.group_post_id);
        const { error: bumpError } = await admin.from('posts').update({ created_at: now }).eq('group_post_id', round.group_post_id);
        if (bumpError) console.error('[sport-events] results post bump failed:', bumpError);
      }
      // Phase 2b (211): an org-hosted event's round writes the org's contest
      // results from ITS leaderboard — after the mirror, never inside it, and
      // on EVERY completion: when every card was already full, the score
      // route's auto-advance completed the group post before this transition
      // (the guard above then skips the second mirror), and the results must
      // still be written. Idempotent (an upsert on the participant). Phase 3:
      // a match round writes its matches' outcomes instead — a match event
      // never counts toward a competition (`not_stroke_play`).
      if (match) await closeMatchesOnCompletion(admin, matches, now);
      else await syncSportEventContest(admin, event, round, req.actorProfileId);
    }
  }

  if (req.to === 'cancelled') {
    const { error } = await admin.from('posts').delete().eq('sport_event_round_id', round.id).is('group_post_id', null);
    if (error) console.error('[sport-events] announce post delete on round cancel failed:', error);
    await syncContestStatus(admin, round.id, 'cancelled');
  }
  if (req.to === 'live') await syncContestStatus(admin, round.id, 'live');

  // Compare-and-set THIS round's status; a lost race answers 409 without undoing the idempotent mint.
  const { data: updatedRound, error: roundError } = await admin
    .from('sport_event_rounds')
    .update({ status: req.to })
    .eq('id', round.id)
    .eq('status', round.status)
    .select('id')
    .maybeSingle();
  if (roundError || !updatedRound) {
    if (roundError) console.error('[sport-events] round status write failed:', roundError);
    return { ok: false, status: 409, reason: 'conflict', error: 'The round changed while you were working. Reload and try again.' };
  }
  if (req.to === 'cancelled') await writeStartsOn(admin, req.eventId);

  // The event follows its rounds.
  const after = rounds.map(r => ({ status: r.id === round.id ? req.to : r.status }));
  const eventNext = eventStatusAfterRound(event.status, after);
  let updatedEvent: SportEventRow = event;
  if (eventNext) {
    const stamp = transitionStamp(eventNext);
    const { data: updated, error: casError } = await admin
      .from('sport_events')
      .update({ status: eventNext, ...(stamp ? { [stamp]: now } : {}) })
      .eq('id', req.eventId)
      .eq('status', event.status)
      .select(EVENT_COLUMNS)
      .maybeSingle();
    if (casError || !updated) {
      if (casError) console.error('[sport-events] event follow-up write failed:', casError);
    } else {
      updatedEvent = updated as SportEventRow;
      if (eventNext === 'completed') await notifyResults(admin, updatedEvent, req.actorProfileId);
    }
  }

  return { ok: true, event: updatedEvent, rounds: await readRounds(admin, req.eventId) };
}

/** Close a live event whose rounds are all done (nothing live, nothing scheduled) — the repair path of the event-level `completed`. */
async function closeEvent(admin: Admin, event: SportEventRow, actorProfileId: string): Promise<TransitionOutcome> {
  const now = new Date().toISOString();
  const { data: updated, error } = await admin
    .from('sport_events')
    .update({ status: 'completed', completed_at: now })
    .eq('id', event.id)
    .eq('status', event.status)
    .select(EVENT_COLUMNS)
    .maybeSingle();
  if (error || !updated) {
    if (error) console.error('[sport-events] close write failed:', error);
    return { ok: false, status: 409, reason: 'conflict', error: 'The event changed while you were working. Reload and try again.' };
  }
  await notifyResults(admin, updated as SportEventRow, actorProfileId);
  return { ok: true, event: updated as SportEventRow, rounds: await readRounds(admin, event.id) };
}

/**
 * Mint a round's announce post (the announced card — one post per round).
 * Idempotent on the 203 partial UNIQUE: a round that already has its post
 * answers that id. Called by the open transition for every round and by
 * the add-round route when the event is already open or live.
 */
export async function mintAnnouncePost(admin: Admin, event: SportEventRow, round: Pick<SportEventRoundRow, 'id' | 'course_name' | 'scheduled_on'>): Promise<string | null> {
  const { data: existing } = await admin.from('posts').select('id').eq('sport_event_round_id', round.id).maybeSingle();
  if (existing?.id) return existing.id as string;
  const { data: post, error } = await admin.from('posts').insert(announcePostRow(event, round)).select('id').single();
  if (error || !post) {
    console.error('[sport-events] announce post mint failed:', error);
    return null;
  }
  return post.id as string;
}

/**
 * Mint a round's group_posts row: the row, the participant rows in mint
 * order, the scorecard WITH the stroke index, then attach the existing
 * announce post (posts.group_post_id ← the round; group_posts.post_id ←
 * the post). Any failure deletes the group_post (FK cascades take the
 * children) and answers null — the abortCreation semantics.
 */
export async function mintRound(admin: Admin, event: SportEventRow, round: MintedRound, roundCount: number, today: string | null, opts: { excludeParticipantIds?: ReadonlySet<string>; gameFormat?: 'stroke' | 'match' } = {}): Promise<string | null> {
  const { data: existing } = await admin.from('group_posts').select('id').eq('sport_event_round_id', round.id).maybeSingle();
  if (existing?.id) return existing.id as string;

  const { data: allRows } = await admin.from('sport_event_participants').select(PARTICIPANT_COLUMNS).eq('sport_event_id', event.id).eq('status', 'accepted');
  const accepted = (allRows ?? []) as SportEventParticipantRow[];
  const mintPlayers: MintPlayer[] = accepted
    .filter(r => r.role !== 'follower' && !opts.excludeParticipantIds?.has(r.id))
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
  const { error: cardError } = await admin.from('golf_scorecard_data').insert(scorecardRow(round, gpId, opts.gameFormat ?? 'stroke'));
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
 * Keep the LIVE round's roster in step with the event after go-live: a
 * late accept joins the live round (at the end of the order); a withdraw /
 * remove marks its row declined so the round machine ignores them. A
 * completed round's roster is history (phase 2 — adding a late joiner
 * there would mirror an empty round later), and a scheduled round is not
 * minted yet (the mint reads the roster). Phase 3: on a MATCH format a late
 * acceptor never joins a live round (they are drawn into a later round by
 * hand); a drop still marks their row. Best-effort.
 */
export async function syncRoundRoster(admin: Admin, eventId: string, profileId: string, change: 'add' | 'drop'): Promise<void> {
  try {
    const [{ data: ev }, rounds] = await Promise.all([admin.from('sport_events').select('format').eq('id', eventId).maybeSingle(), readRounds(admin, eventId)]);
    const matchPlay = isMatchFormat((ev as { format?: string } | null)?.format);
    for (const round of rounds) {
      if (!round.group_post_id || round.status !== 'live') continue;
      if (change === 'add' && matchPlay) continue;
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
