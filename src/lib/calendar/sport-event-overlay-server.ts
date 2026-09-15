/**
 * Sport events on the calendar — the I/O half (Events program, phase 2b,
 * B2). The viewer's ACTIVE participations (invited · requested · accepted ·
 * waitlisted — followers included; a `private` event is roster-scoped by
 * construction) → their events while `open | live` → the rounds
 * `scheduled | live` whose DATE falls in the range → the viewer's group
 * tee time on each. Capped; failures degrade to an empty list (the
 * calendar's events are never held hostage by a source table). Read as
 * `readAs` for the guardian parity the calendar GET already has.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { ACTIVE_PARTICIPANT_STATUSES, type SportEventParticipantStatus, type SportEventRole } from '@/lib/sport-events/types';
import { utcDay } from './day';
import { sportEventRoundToItem, type SportEventItem } from './sport-event-overlay';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

export const SPORT_EVENT_OVERLAY_CAP = 200;

export async function fetchSportEventOverlay(admin: Admin, viewerId: string, fromMs: number, toMs: number): Promise<SportEventItem[]> {
  const { data: parts } = await admin
    .from('sport_event_participants')
    .select('id, sport_event_id, role, status')
    .eq('profile_id', viewerId)
    .in('status', [...ACTIVE_PARTICIPANT_STATUSES]);
  const participations = (parts ?? []) as Array<{ id: string; sport_event_id: string; role: SportEventRole; status: SportEventParticipantStatus }>;
  if (participations.length === 0) return [];
  const byEvent = new Map(participations.map(p => [p.sport_event_id, p]));

  const { data: eventRows } = await admin
    .from('sport_events')
    .select('id, name, status')
    .in('id', [...byEvent.keys()])
    .in('status', ['open', 'live']);
  const events = (eventRows ?? []) as Array<{ id: string; name: string; status: string }>;
  if (events.length === 0) return [];
  const eventIds = events.map(e => e.id);

  const [{ data: roundRows }, { data: countRows }] = await Promise.all([
    admin
      .from('sport_event_rounds')
      .select('id, sport_event_id, sequence, scheduled_on, status, holes, course_name, name')
      .in('sport_event_id', eventIds)
      .in('status', ['scheduled', 'live'])
      .gte('scheduled_on', utcDay(fromMs))
      .lte('scheduled_on', utcDay(toMs))
      .order('scheduled_on', { ascending: true })
      .limit(SPORT_EVENT_OVERLAY_CAP),
    admin.from('sport_event_rounds').select('sport_event_id').in('sport_event_id', eventIds).neq('status', 'cancelled'),
  ]);
  const rounds = (roundRows ?? []) as Array<{ id: string; sport_event_id: string; sequence: number; scheduled_on: string; status: 'scheduled' | 'live'; holes: number; course_name: string; name: string | null }>;
  if (rounds.length === 0) return [];
  const roundCount = new Map<string, number>();
  for (const r of (countRows ?? []) as Array<{ sport_event_id: string }>) roundCount.set(r.sport_event_id, (roundCount.get(r.sport_event_id) ?? 0) + 1);

  // The viewer's tee time per round (one query over their participant rows).
  const teeByRound = new Map<string, string | null>();
  const { data: memberRows } = await admin
    .from('sport_event_group_members')
    .select('sport_event_round_id, group:group_id (tee_time)')
    .in('participant_id', participations.map(p => p.id))
    .in('sport_event_round_id', rounds.map(r => r.id));
  for (const m of (memberRows ?? []) as Array<{ sport_event_round_id: string; group: { tee_time: string | null } | Array<{ tee_time: string | null }> | null }>) {
    const g = Array.isArray(m.group) ? m.group[0] : m.group;
    teeByRound.set(m.sport_event_round_id, g?.tee_time ?? null);
  }

  const eventById = new Map(events.map(e => [e.id, e]));
  const out: SportEventItem[] = [];
  for (const round of rounds) {
    const event = eventById.get(round.sport_event_id);
    const p = byEvent.get(round.sport_event_id);
    if (!event || !p) continue;
    const item = sportEventRoundToItem({
      viewerId,
      event: { id: event.id, name: event.name },
      round,
      roundCount: roundCount.get(event.id) ?? 1,
      teeTime: teeByRound.get(round.id) ?? null,
      role: p.role,
      participantStatus: p.status,
    });
    if (item) out.push(item);
  }
  return out;
}
