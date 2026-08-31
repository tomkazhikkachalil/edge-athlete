// Series persistence + the daily-cron horizon extension. Server-only
// (service-role client). The compensating-delete rule: any failure while
// materializing a NEW series deletes the series row — the CASCADE wipes
// every occurrence and guest row, so there is never partial state.

import type { SupabaseClient } from '@supabase/supabase-js';
import { chunk } from '@/lib/chunk';
import {
  generateOccurrences,
  wallClockInZone,
  wallDurationMinutes,
  NEVER_HORIZON_MS,
  MAX_OCCURRENCES,
  type GeneratedOccurrence,
  type SeriesRule,
} from './recurrence';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

const EVENT_CHUNK = 500;
const GUEST_CHUNK = 1000;

export interface OccurrenceEventFields {
  organizer_id: string;
  title: string;
  description: string | null;
  location: string | null;
  all_day: boolean;
  timezone: string;
  category: string;
  routine_id: string | null;
  routine_snapshot: unknown;
  league_id?: string | null;
  club_id?: string | null;
  venue_id?: string | null;
  facility_id?: string | null;
}

export interface GuestIdentity {
  profile_id?: string | null;
  invited_email?: string | null;
  role: string;
  status: string;
  responded_at?: string | null;
}

/**
 * Bulk-insert occurrence events + fan the guest identities across every
 * occurrence. Returns inserted event ids ordered by starts_at. Throws on
 * failure — the CALLER decides whether to compensating-delete the series.
 */
export async function insertSeriesOccurrences(
  admin: Admin,
  seriesId: string,
  occurrences: GeneratedOccurrence[],
  eventFields: OccurrenceEventFields,
  guestIdentities: GuestIdentity[]
): Promise<{ id: string; starts_at: string }[]> {
  const inserted: { id: string; starts_at: string }[] = [];
  for (const batch of chunk(occurrences, EVENT_CHUNK)) {
    const { data, error } = await admin
      .from('events')
      .insert(batch.map(occ => ({
        ...eventFields,
        starts_at: occ.starts_at,
        ends_at: occ.ends_at,
        series_id: seriesId,
      })))
      .select('id, starts_at');
    if (error) throw new Error(`series occurrence insert failed: ${error.message}`);
    inserted.push(...(data ?? []));
  }
  inserted.sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));

  const guestRows = inserted.flatMap(ev =>
    guestIdentities.map(g => ({
      event_id: ev.id,
      profile_id: g.profile_id ?? null,
      invited_email: g.invited_email ?? null,
      role: g.role,
      status: g.status,
      responded_at: g.responded_at ?? null,
    }))
  );
  for (const batch of chunk(guestRows, GUEST_CHUNK)) {
    const { error } = await admin.from('event_guests').insert(batch);
    if (error) throw new Error(`series guest fan-out failed: ${error.message}`);
  }
  return inserted;
}

/**
 * Daily-cron phase: extend never-ending series whose materialized window
 * has fallen inside the horizon. Field template = the latest non-overridden
 * active occurrence (series-wide edits carry forward); parity template =
 * the FIRST occurrence (biweekly stepping stays aligned). Guest rows are
 * copied VERBATIM (identity + status) from the latest occurrence — series
 * accepts and declines persist into new occurrences. Documented wart: a
 * this-occurrence-only decline on the final materialized occurrence
 * carries forward (rare; the guest can simply re-respond). No
 * notifications — guests already hold series membership.
 */
export async function extendRecurringSeries(
  admin: Admin
): Promise<{ series: number; occurrences: number }> {
  const summary = { series: 0, occurrences: 0 };
  const horizonCutoff = new Date(Date.now() + NEVER_HORIZON_MS).toISOString();

  const { data: dueSeries, error } = await admin
    .from('event_series')
    .select('id, organizer_id, freq, interval_n, byweekday, ends, until_at, count_n, generated_until')
    .eq('ends', 'never')
    .lt('generated_until', horizonCutoff)
    .limit(20); // bounded per run; converges over consecutive nights
  if (error) throw error;

  for (const series of dueSeries ?? []) {
    try {
      const { data: first } = await admin
        .from('events')
        .select('starts_at, ends_at, timezone')
        .eq('series_id', series.id)
        .order('starts_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!first) continue; // fully deleted series — nothing to extend

      // Field template: latest non-overridden active occurrence, falling
      // back to the latest occurrence of any kind.
      const { data: templateRow } = await admin
        .from('events')
        .select('id, organizer_id, title, description, location, all_day, timezone, category, routine_id, routine_snapshot, league_id, club_id, venue_id, facility_id')
        .eq('series_id', series.id)
        .eq('series_override', false)
        .eq('status', 'active')
        .order('starts_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const { data: latestAny } = await admin
        .from('events')
        .select('id, organizer_id, title, description, location, all_day, timezone, category, routine_id, routine_snapshot, league_id, club_id, venue_id, facility_id')
        .eq('series_id', series.id)
        .order('starts_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const template = templateRow ?? latestAny;
      if (!template || !latestAny) continue;

      const rule: SeriesRule = {
        freq: series.freq,
        interval_n: series.interval_n,
        byweekday: series.byweekday,
        ends: series.ends,
        until_at: series.until_at,
        count_n: series.count_n,
      };
      const startWall = wallClockInZone(Date.parse(first.starts_at), first.timezone);
      const occurrences = generateOccurrences(rule, {
        startWall,
        durationMin: wallDurationMinutes(first.starts_at, first.ends_at, first.timezone),
        timeZone: first.timezone,
      }, {
        afterInstant: Date.parse(series.generated_until),
        horizonInstant: Date.now() + NEVER_HORIZON_MS,
        maxTotal: MAX_OCCURRENCES,
      });
      if (occurrences.length === 0) continue;

      const { data: guestRows } = await admin
        .from('event_guests')
        .select('profile_id, invited_email, role, status, responded_at')
        .eq('event_id', latestAny.id);

      await insertSeriesOccurrences(
        admin,
        series.id,
        occurrences,
        {
          organizer_id: template.organizer_id,
          title: template.title,
          description: template.description,
          location: template.location,
          all_day: template.all_day,
          timezone: template.timezone,
          category: template.category,
          routine_id: template.routine_id,
          routine_snapshot: template.routine_snapshot,
          league_id: template.league_id,
          club_id: template.club_id,
          venue_id: template.venue_id,
          facility_id: template.facility_id,
        },
        (guestRows ?? []) as GuestIdentity[]
      );
      await admin
        .from('event_series')
        .update({ generated_until: occurrences[occurrences.length - 1].starts_at })
        .eq('id', series.id);
      summary.series++;
      summary.occurrences += occurrences.length;
    } catch (e) {
      // One broken series must never block the others.
      console.error(`[CALENDAR CRON] series ${series.id} extension failed:`, e);
    }
  }
  return summary;
}
