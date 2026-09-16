/**
 * Live Now for events — the I/O half (Events program, phase 4, PR 2): the
 * live events a viewer may open (public ones for anyone; the viewer's own
 * accepted rows admit their private ones), their rounds, the field's
 * counts; then the pure projection (`live-now.ts`). Lean on purpose — the
 * header's dot polls the count on every page.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { liveEventCards, type LiveEventCard, type LiveEventRow } from './live-now';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

const LIMIT = 40;

export async function readLiveEvents(admin: Admin, viewerId: string | null): Promise<LiveEventCard[]> {
  const base = () => admin.from('sport_events').select('id, name, sport_key, format, visibility, status, shape').eq('status', 'live');
  const own = viewerId
    ? admin.from('sport_event_participants').select('sport_event_id, status').eq('profile_id', viewerId).eq('status', 'accepted').limit(200)
    : Promise.resolve({ data: [] as Array<{ sport_event_id: string; status: string }>, error: null });
  const [{ data: publicRows }, ownRes] = await Promise.all([base().eq('visibility', 'public').limit(LIMIT), own]);
  const ownIds = [...new Set(((ownRes.data ?? []) as Array<{ sport_event_id: string }>).map(r => r.sport_event_id))];
  const { data: ownRows } = ownIds.length > 0 ? await base().in('id', ownIds).limit(LIMIT) : { data: [] as unknown[] };
  const byId = new Map<string, { id: string; name: string; sport_key: string; format: string; visibility: string; status: string; shape?: string | null }>();
  for (const r of [...((publicRows ?? []) as Array<{ id: string; name: string; sport_key: string; format: string; visibility: string; status: string; shape?: string | null }>), ...((ownRows ?? []) as Array<{ id: string; name: string; sport_key: string; format: string; visibility: string; status: string; shape?: string | null }>)]) if (!byId.has(r.id)) byId.set(r.id, r);
  const ids = [...byId.keys()];
  if (ids.length === 0) return [];
  const [{ data: rounds }, { data: parts }] = await Promise.all([
    admin.from('sport_event_rounds').select('id, sport_event_id, sequence, name, status, course_name, scheduled_on').in('sport_event_id', ids),
    admin.from('sport_event_participants').select('sport_event_id, role, playing, status').in('sport_event_id', ids).eq('status', 'accepted'),
  ]);
  const roundIds = ((rounds ?? []) as Array<{ id: string }>).map(r => r.id);
  const { data: gps } = roundIds.length > 0 ? await admin.from('group_posts').select('id, sport_event_round_id').in('sport_event_round_id', roundIds) : { data: [] as unknown[] };
  const gpByRound = new Map(((gps ?? []) as Array<{ id: string; sport_event_round_id: string }>).map(g => [g.sport_event_round_id, g.id]));
  const ownSet = new Set(ownIds);
  const rows: LiveEventRow[] = ids.map(id => {
    const e = byId.get(id)!;
    const evRounds = ((rounds ?? []) as Array<{ id: string; sport_event_id: string; sequence: number; name: string | null; status: string; course_name: string; scheduled_on: string }>).filter(r => r.sport_event_id === id).map(r => ({ id: r.id, sequence: r.sequence, name: r.name, status: r.status, course_name: r.course_name, scheduled_on: r.scheduled_on, group_post_id: gpByRound.get(r.id) ?? null }));
    const evParts = ((parts ?? []) as Array<{ sport_event_id: string; role: string; playing: boolean }>).filter(p => p.sport_event_id === id);
    return { ...e, rounds: evRounds, playing: evParts.filter(p => p.playing).length, followers: evParts.filter(p => p.role === 'follower').length, viewer_status: ownSet.has(id) ? 'accepted' : null };
  });
  return liveEventCards(rows);
}
