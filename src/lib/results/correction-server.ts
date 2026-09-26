// ── Support corrects an event's results (results-kept round PR 4, 241) ─────
// Tom: "They might have just tagged the wrong person, but the information
// could be correct. So it's important that the information not be lost. But
// the admin be able to tag the right person and correct any mistakes. Make
// sure individuals know if they've been untagged from an official result."
// Owner-only tools of the event recovery panel, on a ticket (the recovery
// kit's ctx — platform audit, ticket history). Three acts:
//
//   reassignResult   one participant's result → the RIGHT person (an existing
//                    account): the event row, every round's card / stat line,
//                    the mirrors and their dataset rows move WHOLE; the org's
//                    contest drops the wrong person and re-syncs with the
//                    right one. Nothing is recomputed from scratch; nothing is
//                    lost. Both people and the organizers are told.
//   correctCard / correctStatLine   a wrong score or stat: written through
//                    the one writers, then the round re-mirrors and re-syncs.
//                    The audit keeps before and after.
//   removeMistakenResult   the ONLY true removal — a result nobody played (a
//                    test, a duplicate): off the event, the mirrors and the
//                    contest.
//
// If the right person is not on Edge Athlete yet, support leaves the result
// where it is and reassigns once they join — the data is never parked
// somewhere lossy (flagged to Tom).

import type { SupabaseClient } from '@supabase/supabase-js';
import { recordAuthority } from '@/lib/authority/audit-server';
import type { RecoveryContext, Result } from '@/lib/authority/recovery-server';
import { findPerson } from '@/lib/authority/recovery-server';
import { EVENT_COLUMNS, PARTICIPANT_COLUMNS } from '@/lib/sport-events/access-server';
import { readRounds, type MintedRound } from '@/lib/sport-events/lifecycle-server';
import { snapshotAtAccept } from '@/lib/sport-events/handicap-server';
import { mirrorCompletedRound } from '@/lib/golf/round-mirror';
import { mirrorStatRound, unmirrorLine } from '@/lib/sport-events/stat-results-server';
import { removeMirrorFor } from '@/lib/sport-events/opt-out';
import { syncSportEventContest } from '@/lib/sport-events/contest-sync-server';
import { readCountsTowardAll } from '@/lib/sport-events/contest-link-server';
import { writeHoleScores } from '@/lib/golf/hole-scores-server';
import { statSchemaFor } from '@/lib/sport-events/stats';
import { validateStatsAgainstSchema } from '@/lib/sports/stat-line-validate';
import { isStatShape, shapeOf, type SportEventParticipantRow, type SportEventRow } from '@/lib/sport-events/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- schema-agnostic helper (the authz.ts Admin alias)
type Admin = SupabaseClient<any, 'public', any>;

const TAG = '[results correction]';

async function loadEvent(admin: Admin, eventId: string): Promise<SportEventRow | null> {
  const { data } = await admin.from('sport_events').select(EVENT_COLUMNS).eq('id', eventId).maybeSingle();
  return (data as SportEventRow | null) ?? null;
}

async function ticketStep(admin: Admin, ctx: RecoveryContext, action: string, detail: string): Promise<void> {
  const { error } = await admin.from('ticket_events').insert({ ticket_id: ctx.ticketId, actor_profile_id: ctx.actorId, kind: 'action_taken', old_value: null, new_value: action, body: [detail, ctx.note].filter(Boolean).join(' — '), visible_to_user: false });
  if (error) console.error(`${TAG} ticket history failed:`, error.message);
}

async function bell(admin: Admin, ids: Iterable<string>, title: string, message: string, url: string): Promise<void> {
  const rows = [...new Set(ids)].filter(Boolean).map(user_id => ({ user_id, type: 'authority_notice', actor_id: null, title, message, action_url: url, is_read: false, metadata: {} }));
  if (rows.length === 0) return;
  const { error } = await admin.from('notifications').insert(rows);
  if (error) console.error(`${TAG} bell failed:`, error.message);
}

async function organizers(admin: Admin, event: SportEventRow): Promise<string[]> {
  const { data } = await admin.from('sport_event_participants').select('profile_id').eq('sport_event_id', event.id).eq('role', 'co_organizer').eq('status', 'accepted');
  return [event.host_profile_id, ...((data ?? []) as { profile_id: string }[]).map(r => r.profile_id)];
}

/** Re-mirror and re-sync every COMPLETED round (idempotent): the mirrors, the dataset rows and the org's contest follow. */
async function resync(admin: Admin, event: SportEventRow, rounds: MintedRound[], actorId: string): Promise<void> {
  for (const round of rounds) {
    if (round.status !== 'completed') continue;
    if (isStatShape(shapeOf(event))) await mirrorStatRound(admin, event, round);
    else if (round.group_post_id) await mirrorCompletedRound(admin, round.group_post_id);
    await syncSportEventContest(admin, event, round, actorId);
  }
}

/** The org's contest forgets a person on these rounds (their contest row, result and org stat lines) before a re-sync. */
async function dropFromContests(admin: Admin, rounds: MintedRound[], profileId: string): Promise<void> {
  const links = await readCountsTowardAll(admin, rounds.map(r => r.id));
  if (!links) return;
  for (const link of links.values()) {
    const { data: parts } = await admin.from('contest_participants').select('id, competition_entries!inner(profile_id)').eq('contest_id', link.contestId).eq('competition_entries.profile_id', profileId);
    const ids = ((parts ?? []) as { id: string }[]).map(p => p.id);
    if (ids.length > 0) {
      await admin.from('contest_results').delete().in('participant_id', ids);
      await admin.from('contest_participants').delete().in('id', ids);
    }
    await admin.from('contest_stat_lines').delete().eq('contest_id', link.contestId).eq('profile_id', profileId);
  }
}

async function readParticipant(admin: Admin, eventId: string, participantId: string): Promise<SportEventParticipantRow | null> {
  const { data } = await admin.from('sport_event_participants').select(PARTICIPANT_COLUMNS).eq('id', participantId).eq('sport_event_id', eventId).maybeSingle();
  return (data as SportEventParticipantRow | null) ?? null;
}

// ── The panel read ───────────────────────────────────────────────────────────

export interface ResultRowView {
  participantId: string;
  profileId: string;
  role: string;
  status: string;
  rounds: Array<{ roundId: string; sequence: number; cardId: string | null; gross: number | null; holes: number | null; lineId: string | null; stats: Record<string, number> | null }>;
}

export async function readEventResults(admin: Admin, eventId: string): Promise<ResultRowView[]> {
  const event = await loadEvent(admin, eventId);
  if (!event) return [];
  const rounds = await readRounds(admin, eventId, shapeOf(event));
  const { data: parts } = await admin.from('sport_event_participants').select('id, profile_id, role, status').eq('sport_event_id', eventId).neq('role', 'follower');
  const rows = ((parts ?? []) as { id: string; profile_id: string; role: string; status: string }[]).map(p => ({ participantId: p.id, profileId: p.profile_id, role: p.role, status: p.status, rounds: [] as ResultRowView['rounds'] }));
  const byProfile = new Map(rows.map(r => [r.profileId, r]));
  for (const round of rounds) {
    if (isStatShape(shapeOf(event))) {
      const { data: lines } = await admin.from('sport_event_stat_lines').select('id, profile_id, stats').eq('sport_event_round_id', round.id);
      for (const l of (lines ?? []) as { id: string; profile_id: string; stats: Record<string, number> | null }[]) {
        byProfile.get(l.profile_id)?.rounds.push({ roundId: round.id, sequence: round.sequence, cardId: null, gross: null, holes: null, lineId: l.id, stats: l.stats ?? {} });
      }
    } else if (round.group_post_id) {
      const { data: gpp } = await admin.from('group_post_participants').select('id, profile_id, scores:golf_participant_scores(id, total_score, holes_completed)').eq('group_post_id', round.group_post_id);
      for (const p of (gpp ?? []) as { id: string; profile_id: string; scores: { id: string; total_score: number | null; holes_completed: number | null } | { id: string; total_score: number | null; holes_completed: number | null }[] | null }[]) {
        const sc = Array.isArray(p.scores) ? p.scores[0] : p.scores;
        byProfile.get(p.profile_id)?.rounds.push({ roundId: round.id, sequence: round.sequence, cardId: sc?.id ?? null, gross: sc?.total_score ?? null, holes: sc?.holes_completed ?? null, lineId: null, stats: null });
      }
    }
  }
  return rows;
}

// ── Move a result to the right person ───────────────────────────────────────

export async function reassignResult(admin: Admin, ctx: RecoveryContext, eventId: string, participantId: string, personRef: string): Promise<Result> {
  const event = await loadEvent(admin, eventId);
  if (!event) return { ok: false, status: 404, error: 'No such event.' };
  const from = await readParticipant(admin, eventId, participantId);
  if (!from) return { ok: false, status: 404, error: 'No such participant.' };
  if (from.profile_id === event.host_profile_id) return { ok: false, status: 409, error: 'That is the host’s result — hand the event over first, then move it.' };
  const to = await findPerson(admin, personRef);
  if (!to) return { ok: false, status: 404, error: 'No single account matches that id, handle or email. If they are not on Edge Athlete yet, leave the result where it is and move it once they join.' };
  if (to.departed) return { ok: false, status: 409, error: 'That account has been deleted.' };
  if (to.id === from.profile_id) return { ok: false, status: 409, error: 'That is the same person.' };
  const { data: already } = await admin.from('sport_event_participants').select('id').eq('sport_event_id', eventId).eq('profile_id', to.id).maybeSingle();
  if (already) return { ok: false, status: 409, error: 'That person is already in this event — two results can’t be merged here.' };

  const rounds = await readRounds(admin, eventId, shapeOf(event));
  const oldId = from.profile_id;
  // The org's contest forgets the wrong person first (their rows would otherwise stand beside the right one's).
  await dropFromContests(admin, rounds, oldId);

  // The event row moves (the id, the groups, the cards keyed by it all follow); the index is the right person's.
  const index = await snapshotAtAccept(admin as never, { id: from.id, profile_id: to.id, handicap_index: null, handicap_source: 'none' } as never);
  const { error: rowErr } = await admin.from('sport_event_participants').update({ profile_id: to.id, ...index, updated_at: new Date().toISOString() }).eq('id', from.id).eq('profile_id', oldId);
  if (rowErr) return { ok: false, status: 409, error: 'Could not move the event row — reload and try again.' };

  if (isStatShape(shapeOf(event))) {
    const roundIds = rounds.map(r => r.id);
    const { data: lines } = roundIds.length ? await admin.from('sport_event_stat_lines').select('id').in('sport_event_round_id', roundIds).eq('profile_id', oldId) : { data: [] };
    const lineIds = ((lines ?? []) as { id: string }[]).map(l => l.id);
    if (lineIds.length) {
      await admin.from('sport_event_stat_lines').update({ profile_id: to.id }).in('id', lineIds);
      for (const lineId of lineIds) {
        const { data: posts } = await admin.from('posts').select('id').eq('stats_data->>sport_event_stat_line_id', lineId);
        for (const p of (posts ?? []) as { id: string }[]) {
          await admin.from('posts').update({ profile_id: to.id }).eq('id', p.id);
          await admin.from('athlete_performances').update({ profile_id: to.id }).eq('natural_key', `post:${p.id}`);
        }
      }
    }
  } else {
    for (const round of rounds) {
      if (!round.group_post_id) continue;
      await admin.from('group_post_participants').update({ profile_id: to.id }).eq('group_post_id', round.group_post_id).eq('profile_id', oldId);
      const { data: mirrors } = await admin.from('golf_rounds').select('id').eq('group_post_id', round.group_post_id).eq('profile_id', oldId);
      for (const m of (mirrors ?? []) as { id: string }[]) {
        await admin.from('golf_rounds').update({ profile_id: to.id }).eq('id', m.id);
        await admin.from('athlete_performances').update({ profile_id: to.id }).eq('natural_key', `golf_round:${m.id}`);
      }
    }
  }
  await resync(admin, event, rounds, ctx.actorId);

  await recordAuthority(admin, { subject: { type: 'sport_event', id: event.id }, actor: { kind: 'platform', profileId: ctx.actorId }, action: 'result_reassigned', targetProfileId: to.id, ticketId: ctx.ticketId, detail: { from_profile_id: oldId, to_profile_id: to.id, participant_id: from.id, note: ctx.note } });
  await ticketStep(admin, ctx, 'result_reassigned', `A result in ${event.name} moved to ${to.name}`);
  const url = `/events/${event.id}`;
  await bell(admin, [oldId], `A result was moved off your profile`, `Edge Athlete support moved your result in ${event.name} to the person who played it. Reply on your support request if this looks wrong.`, url);
  await bell(admin, [to.id], `A result was added to your profile`, `Edge Athlete support added your result in ${event.name} — it had been recorded under someone else.`, url);
  await bell(admin, (await organizers(admin, event)).filter(id => id !== oldId && id !== to.id), `A result in ${event.name} was corrected`, `Edge Athlete support moved a result to the person who played it.`, url);
  return { ok: true };
}

// ── Correct a score or a stat line ──────────────────────────────────────────

export async function correctCard(admin: Admin, ctx: RecoveryContext, eventId: string, cardId: string, holes: Array<{ hole_number: number; strokes: number }>): Promise<Result> {
  const event = await loadEvent(admin, eventId);
  if (!event) return { ok: false, status: 404, error: 'No such event.' };
  const { data: card } = await admin.from('golf_participant_scores').select('id, participant:participant_id(profile_id, group_post_id)').eq('id', cardId).maybeSingle();
  const part = card ? (Array.isArray((card as { participant: unknown }).participant) ? ((card as { participant: unknown[] }).participant[0]) : (card as { participant: unknown }).participant) as { profile_id: string; group_post_id: string } | null : null;
  const rounds = await readRounds(admin, eventId, shapeOf(event));
  if (!part || !rounds.some(r => r.group_post_id === part.group_post_id)) return { ok: false, status: 404, error: 'That card is not in this event.' };
  if (holes.length === 0 || holes.some(h => h.hole_number < 1 || h.hole_number > 18 || h.strokes < 1 || h.strokes > 20)) return { ok: false, status: 400, error: 'Scores are hole 1–18, strokes 1–20.' };
  const { data: beforeRows } = await admin.from('golf_hole_scores').select('hole_number, strokes').eq('golf_participant_id', cardId).in('hole_number', holes.map(h => h.hole_number));
  const before = Object.fromEntries(((beforeRows ?? []) as { hole_number: number; strokes: number }[]).map(r => [String(r.hole_number), r.strokes]));
  const out = await writeHoleScores(admin, cardId, holes.map(h => ({ hole_number: h.hole_number, strokes: h.strokes })));
  if (out.error) return { ok: false, status: 409, error: out.error };
  await resync(admin, event, rounds, ctx.actorId);
  const after = Object.fromEntries(holes.map(h => [String(h.hole_number), h.strokes]));
  await recordAuthority(admin, { subject: { type: 'sport_event', id: event.id }, actor: { kind: 'platform', profileId: ctx.actorId }, action: 'result_corrected', targetProfileId: part.profile_id, ticketId: ctx.ticketId, detail: { before, after, note: ctx.note } });
  await ticketStep(admin, ctx, 'result_corrected', `Corrected ${holes.length} hole${holes.length === 1 ? '' : 's'} in ${event.name}`);
  const url = `/events/${event.id}`;
  await bell(admin, [part.profile_id], `A score of yours was corrected`, `Edge Athlete support corrected your scorecard in ${event.name}. Reply on your support request if this looks wrong.`, url);
  await bell(admin, (await organizers(admin, event)).filter(id => id !== part.profile_id), `A score in ${event.name} was corrected`, `Edge Athlete support corrected a scorecard.`, url);
  return { ok: true };
}

export async function correctStatLine(admin: Admin, ctx: RecoveryContext, eventId: string, lineId: string, stats: Record<string, number>): Promise<Result> {
  const event = await loadEvent(admin, eventId);
  if (!event) return { ok: false, status: 404, error: 'No such event.' };
  const schema = statSchemaFor(event.sport_key);
  if (!schema) return { ok: false, status: 409, error: 'This event has no stat lines.' };
  const valid = validateStatsAgainstSchema(stats, schema);
  if (!valid.ok) return { ok: false, status: 400, error: valid.error };
  const { data: line } = await admin.from('sport_event_stat_lines').select('id, profile_id, stats, version, sport_event_round_id').eq('id', lineId).maybeSingle();
  const l = line as { id: string; profile_id: string; stats: Record<string, number> | null; version: number; sport_event_round_id: string } | null;
  const rounds = await readRounds(admin, eventId, shapeOf(event));
  if (!l || !rounds.some(r => r.id === l.sport_event_round_id)) return { ok: false, status: 404, error: 'That line is not in this event.' };
  // The org's record keeps its author: entered_by is left as it was (the provenance rung does not change).
  const { data: written } = await admin.from('sport_event_stat_lines').update({ stats, version: l.version + 1 }).eq('id', l.id).eq('version', l.version).select('id');
  if (!written || written.length === 0) return { ok: false, status: 409, error: 'The line changed while you were working — reload and try again.' };
  await resync(admin, event, rounds, ctx.actorId);
  await recordAuthority(admin, { subject: { type: 'sport_event', id: event.id }, actor: { kind: 'platform', profileId: ctx.actorId }, action: 'result_corrected', targetProfileId: l.profile_id, ticketId: ctx.ticketId, detail: { before: l.stats ?? {}, after: stats, note: ctx.note } });
  await ticketStep(admin, ctx, 'result_corrected', `Corrected a stat line in ${event.name}`);
  const url = `/events/${event.id}`;
  await bell(admin, [l.profile_id], `Your stats were corrected`, `Edge Athlete support corrected your stats in ${event.name}. Reply on your support request if this looks wrong.`, url);
  await bell(admin, (await organizers(admin, event)).filter(id => id !== l.profile_id), `Stats in ${event.name} were corrected`, `Edge Athlete support corrected a stat line.`, url);
  return { ok: true };
}

// ── The only true removal: a result nobody played ───────────────────────────

export async function removeMistakenResult(admin: Admin, ctx: RecoveryContext, eventId: string, participantId: string): Promise<Result> {
  const event = await loadEvent(admin, eventId);
  if (!event) return { ok: false, status: 404, error: 'No such event.' };
  const row = await readParticipant(admin, eventId, participantId);
  if (!row) return { ok: false, status: 404, error: 'No such participant.' };
  if (row.profile_id === event.host_profile_id) return { ok: false, status: 409, error: 'That is the host — hand the event over first.' };
  const rounds = await readRounds(admin, eventId, shapeOf(event));
  await dropFromContests(admin, rounds, row.profile_id);
  await admin.from('sport_event_participants').update({ status: 'removed', playing: false, waitlist_position: null, updated_at: new Date().toISOString() }).eq('id', row.id);
  if (isStatShape(shapeOf(event))) {
    const roundIds = rounds.map(r => r.id);
    const { data: lines } = roundIds.length ? await admin.from('sport_event_stat_lines').select('id').in('sport_event_round_id', roundIds).eq('profile_id', row.profile_id) : { data: [] };
    for (const l of (lines ?? []) as { id: string }[]) await unmirrorLine(admin, l.id);
  } else {
    for (const round of rounds) {
      if (!round.group_post_id) continue;
      await admin.from('group_post_participants').update({ status: 'declined' }).eq('group_post_id', round.group_post_id).eq('profile_id', row.profile_id);
      await removeMirrorFor(admin, round.group_post_id, row.profile_id);
    }
  }
  await resync(admin, event, rounds, ctx.actorId);
  await recordAuthority(admin, { subject: { type: 'sport_event', id: event.id }, actor: { kind: 'platform', profileId: ctx.actorId }, action: 'result_corrected', targetProfileId: row.profile_id, ticketId: ctx.ticketId, detail: { via: 'removed', participant_id: row.id, note: ctx.note } });
  await ticketStep(admin, ctx, 'result_removed', `Removed a mistaken result from ${event.name}`);
  const url = `/events/${event.id}`;
  await bell(admin, [row.profile_id], `A result was removed from your profile`, `Edge Athlete support removed a result in ${event.name} that was recorded by mistake. Reply on your support request if this looks wrong.`, url);
  await bell(admin, (await organizers(admin, event)).filter(id => id !== row.profile_id), `A result in ${event.name} was removed`, `Edge Athlete support removed a result recorded by mistake.`, url);
  return { ok: true };
}
