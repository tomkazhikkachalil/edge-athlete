// ── Shortlist — the server half (Recruiting skeleton R3) ──────────────────
// Every read and write is service-role behind requireScout (the routes);
// the POST re-checks the athlete with isRecruitable, THE one predicate.
// Pre-183 (missing table) every reader answers "unsupported" and every
// writer 409s naming the migration — never a 500.

import type { SupabaseClient } from '@supabase/supabase-js';
import { isMissingTableError } from '@/lib/leagues/validate';
import { isRecruitable, parseRecruitingStatus } from './profile';
import { normalizeShortlistNote, type ShortlistAthlete } from './shortlist';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the authz.ts Admin alias; schema-agnostic
type Admin = SupabaseClient<any, 'public', any>;

export type ShortlistOutcome<T> =
  | { ok: true; value: T }
  | { ok: false; status: 404 | 403 | 409 | 500; error: string };

const MIGRATION_409 = { ok: false as const, status: 409 as const, error: 'Shortlists need a database migration first (183)' };

const unsupported = (code: string | undefined | null) => isMissingTableError(code) || code === '42703' || code === '42P01';

const ATHLETE_FIELDS = 'id, first_name, last_name, full_name, handle, avatar_url, sport, school, class_year, email, visibility, recruiting_status';

interface AthleteRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  handle: string | null;
  avatar_url: string | null;
  sport: string | null;
  school: string | null;
  class_year: number | null;
  email: string | null;
  visibility: string | null;
  recruiting_status: string | null;
}

const displayName = (a: AthleteRow) =>
  [a.first_name, a.last_name].filter(Boolean).join(' ') || a.full_name || 'Athlete';

export async function listShortlist(admin: Admin, scoutId: string): Promise<{ supported: boolean; items: ShortlistAthlete[] }> {
  const { data, error } = await admin
    .from('scout_shortlists')
    .select('athlete_id, note, created_at')
    .eq('scout_id', scoutId)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    if (unsupported(error.code)) return { supported: false, items: [] };
    console.error('[shortlist] list error:', error);
    return { supported: true, items: [] };
  }
  const rows = (data ?? []) as { athlete_id: string; note: string | null; created_at: string }[];
  if (rows.length === 0) return { supported: true, items: [] };
  const { data: athletes } = await admin.from('profiles').select(ATHLETE_FIELDS).in('id', rows.map(r => r.athlete_id));
  const byId = new Map(((athletes ?? []) as AthleteRow[]).map(a => [a.id, a]));
  const items: ShortlistAthlete[] = [];
  for (const r of rows) {
    const a = byId.get(r.athlete_id);
    if (!a) continue;
    items.push({
      athleteId: a.id,
      name: displayName(a),
      handle: a.handle,
      avatarUrl: a.avatar_url,
      sport: a.sport,
      school: a.school,
      gradYear: a.class_year,
      recruitingStatus: parseRecruitingStatus(a.recruiting_status),
      note: r.note,
      addedAt: r.created_at,
    });
  }
  return { supported: true, items };
}

/** The scout's row for one athlete (the button's state). */
export async function readShortlistEntry(
  admin: Admin,
  scoutId: string,
  athleteId: string
): Promise<{ supported: boolean; shortlisted: boolean; note: string | null }> {
  const { data, error } = await admin
    .from('scout_shortlists')
    .select('note')
    .eq('scout_id', scoutId)
    .eq('athlete_id', athleteId)
    .maybeSingle();
  if (error) {
    if (unsupported(error.code)) return { supported: false, shortlisted: false, note: null };
    return { supported: true, shortlisted: false, note: null };
  }
  return { supported: true, shortlisted: !!data, note: (data?.note as string | null) ?? null };
}

/** Add: the athlete must be recruitable NOW (claimed, public, open). */
export async function addToShortlist(admin: Admin, scoutId: string, athleteId: string): Promise<ShortlistOutcome<{ shortlisted: true }>> {
  if (scoutId === athleteId) return { ok: false, status: 403, error: 'You cannot shortlist yourself' };
  const { data: athlete, error: readErr } = await admin.from('profiles').select(ATHLETE_FIELDS).eq('id', athleteId).maybeSingle();
  if (readErr?.code === '42703') return MIGRATION_409;
  if (readErr || !athlete) return { ok: false, status: 404, error: 'Athlete not found' };
  const a = athlete as AthleteRow;
  if (!isRecruitable({ email: a.email, visibility: a.visibility, recruiting_status: a.recruiting_status })) {
    return { ok: false, status: 403, error: 'This athlete is not open to recruiting' };
  }
  const { error } = await admin
    .from('scout_shortlists')
    .upsert({ scout_id: scoutId, athlete_id: athleteId }, { onConflict: 'scout_id,athlete_id', ignoreDuplicates: true });
  if (error) {
    if (unsupported(error.code)) return MIGRATION_409;
    console.error('[shortlist] add error:', error);
    return { ok: false, status: 500, error: 'Could not shortlist this athlete' };
  }
  return { ok: true, value: { shortlisted: true } };
}

export async function updateShortlistNote(admin: Admin, scoutId: string, athleteId: string, rawNote: unknown): Promise<ShortlistOutcome<{ note: string | null }>> {
  const note = normalizeShortlistNote(rawNote);
  const { data, error } = await admin
    .from('scout_shortlists')
    .update({ note, updated_at: new Date().toISOString() })
    .eq('scout_id', scoutId)
    .eq('athlete_id', athleteId)
    .select('athlete_id')
    .maybeSingle();
  if (error) {
    if (unsupported(error.code)) return MIGRATION_409;
    console.error('[shortlist] note error:', error);
    return { ok: false, status: 500, error: 'Could not save the note' };
  }
  if (!data) return { ok: false, status: 404, error: 'Not on your shortlist' };
  return { ok: true, value: { note } };
}

export async function removeFromShortlist(admin: Admin, scoutId: string, athleteId: string): Promise<ShortlistOutcome<{ removed: true }>> {
  const { error } = await admin.from('scout_shortlists').delete().eq('scout_id', scoutId).eq('athlete_id', athleteId);
  if (error) {
    if (unsupported(error.code)) return MIGRATION_409;
    console.error('[shortlist] remove error:', error);
    return { ok: false, status: 500, error: 'Could not remove from your shortlist' };
  }
  return { ok: true, value: { removed: true } };
}

/** The athlete side: how many scouts shortlisted them (never who). 0 pre-183. */
export async function shortlistedByCount(admin: Admin, athleteId: string): Promise<number> {
  const { count, error } = await admin
    .from('scout_shortlists')
    .select('scout_id', { count: 'exact', head: true })
    .eq('athlete_id', athleteId);
  if (error || typeof count !== 'number') return 0;
  return count;
}
