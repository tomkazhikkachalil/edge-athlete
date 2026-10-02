// ── The readers of activities (245): the gate, the stream, the list ────────
// ONE gate for every reader (the page, the profile tab, the feed card's
// share): resolveActivityAccess decides WHETHER a viewer may see a profile's
// activities and as WHICH audience; visibility.ts then decides WHAT they
// receive. The rules:
//   * self, or a guardian of the athlete → owner (everything, "Only me" too);
//   * a departed athlete → nobody (a refusal, the same 404 as not-found);
//   * a block / mute either way → nobody (hiddenAuthorsFor);
//   * signed in → canViewProfile (public, an accepted follower, an access
//     row); signed out → a public profile only;
//   * everyone but the owner → the athlete's supervision picks the audience
//     (a supervised athlete's other viewers never receive a position).
// Every response built from these is viewer-dependent: `private, no-store`.

import { sourceName } from './connections';
import { gunzipSync } from 'node:zlib';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getProfileRole } from '@/lib/auth-server';
import { hiddenAuthorsFor } from '@/lib/mutes';
import { canViewProfile } from '@/lib/privacy';
import type { ActivitySession } from '@/lib/vitals/sessions';
import { isActivityType } from './catalog';
import { mondayOf, weeklyTotals, type WeekTotal } from './totals';
import type { ActivityStream } from './types';
import { ACTIVITY_COLUMNS, audienceFor, projectActivity, type ActivityAudience, type ActivityRow, type ActivityView } from './visibility';
import { STREAM_BUCKET } from './write-server';

type Admin = SupabaseClient;

export type ActivityAccess = { ok: true; audience: ActivityAudience } | { ok: false };

export async function resolveActivityAccess(admin: Admin, viewerId: string | null, profileId: string): Promise<ActivityAccess> {
  const [profileRes, role, hidden] = await Promise.all([
    admin.from('profiles').select('id, visibility, supervision_state, departed_at').eq('id', profileId).maybeSingle(),
    viewerId && viewerId !== profileId ? getProfileRole(viewerId, profileId) : Promise.resolve(null),
    viewerId && viewerId !== profileId ? hiddenAuthorsFor(admin, viewerId) : Promise.resolve(new Set<string>()),
  ]);
  const profile = profileRes.data as { visibility: string | null; supervision_state: string | null; departed_at: string | null } | null;
  if (!profile || profile.departed_at) return { ok: false };
  if (viewerId === profileId || role === 'guardian') return { ok: true, audience: 'owner' };
  if (hidden.has(profileId)) return { ok: false };
  const canView = viewerId ? (await canViewProfile(profileId, viewerId)).canView : profile.visibility === 'public';
  if (!canView) return { ok: false };
  return { ok: true, audience: audienceFor({ isSelfOrGuardian: false, profileSupervised: profile.supervision_state === 'supervised' }) };
}

/** Read one activity row the viewer may see ("Only me" is the owner's). */
export async function readActivityForViewer(
  admin: Admin,
  viewerId: string | null,
  activityId: string
): Promise<{ ok: true; row: ActivityRow; audience: ActivityAudience } | { ok: false }> {
  const { data, error } = await admin.from('activities').select(ACTIVITY_COLUMNS).eq('id', activityId).maybeSingle();
  if (error || !data) return { ok: false };
  const row = data as unknown as ActivityRow;
  const access = await resolveActivityAccess(admin, viewerId, row.profile_id);
  if (!access.ok) return { ok: false };
  if (row.only_me && access.audience !== 'owner') return { ok: false };
  return { ok: true, row, audience: access.audience };
}

function isStream(v: unknown): v is ActivityStream {
  if (!v || typeof v !== 'object') return false;
  const s = v as Partial<ActivityStream>;
  return s.v === 1 && Array.isArray(s.s) && Array.isArray(s.d) && s.s.length === s.d.length;
}

/** The stored stream, or null (missing, unreadable — the page still renders the numbers). */
export async function readStream(admin: Admin, path: string | null): Promise<ActivityStream | null> {
  if (!path) return null;
  try {
    const { data, error } = await admin.storage.from(STREAM_BUCKET).download(path);
    if (error || !data) {
      console.error('[activities] stream read failed:', path, error?.message);
      return null;
    }
    const parsed: unknown = JSON.parse(gunzipSync(Buffer.from(await data.arrayBuffer())).toString('utf8'));
    return isStream(parsed) ? parsed : null;
  } catch (e) {
    console.error('[activities] stream unreadable:', path, e instanceof Error ? e.message : e);
    return null;
  }
}

export const LIST_PAGE = 20;

const ISO_TS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A keyset cursor: the last row's started_at and id. */
export function encodeCursor(row: { started_at: string; id: string }): string {
  return Buffer.from(`${row.started_at}|${row.id}`).toString('base64url');
}

export function decodeCursor(c: string | null): { startedAt: string; id: string } | null {
  if (!c) return null;
  try {
    const [startedAt, id] = Buffer.from(c, 'base64url').toString('utf8').split('|');
    // Strict shapes only: V8's Date.parse accepts "(comments)", so a
    // parseable string is not proof of a safe one.
    if (!ISO_TS.test(startedAt ?? '') || !UUID.test(id ?? '')) return null;
    return { startedAt, id };
  } catch {
    return null;
  }
}

/** How far back Vitals reads activity sessions (its weekly overlay shows 12
 *  weeks; the streak walks back until a gap). */
export const SESSIONS_WEEKS = 52;
const SESSIONS_MAX = 500;

/**
 * The profile's recent activities as VITALS SESSIONS — id, type, name, start
 * and the three numbers the week maths needs, nothing else (no route, no
 * heart rate). Newest first. "Only me" is the owner's, as everywhere.
 */
export async function listActivitySessions(
  admin: Admin,
  profileId: string,
  audience: ActivityAudience,
  now: number = Date.now()
): Promise<{ ok: true; sessions: ActivitySession[] } | { ok: false }> {
  const since = new Date(now - SESSIONS_WEEKS * 7 * 86_400_000).toISOString();
  let q = admin
    .from('activities')
    .select('id, activity_type, source, name, started_at, elapsed_s, moving_s, distance_m')
    .eq('profile_id', profileId)
    .gte('started_at', since)
    .order('started_at', { ascending: false })
    .limit(SESSIONS_MAX);
  if (audience !== 'owner') q = q.eq('only_me', false);
  const { data, error } = await q;
  if (error) {
    console.error('[activities] sessions read failed:', error.message);
    return { ok: false };
  }
  const num = (v: unknown): number | null => {
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    return Number.isFinite(n) ? n : null;
  };
  return {
    ok: true,
    sessions: ((data ?? []) as Array<Record<string, unknown>>).map(r => ({
      id: r.id as string,
      type: isActivityType(r.activity_type) ? r.activity_type : 'other',
      name: (r.name as string) ?? '',
      startedAt: r.started_at as string,
      elapsedS: num(r.elapsed_s) ?? 0,
      movingS: num(r.moving_s),
      distanceM: num(r.distance_m),
      sourceName: sourceName(r.source as string | null),
    })),
  };
}

export async function listActivities(
  admin: Admin,
  profileId: string,
  audience: ActivityAudience,
  cursor: { startedAt: string; id: string } | null
): Promise<{ ok: true; items: ActivityView[]; next: string | null } | { ok: false }> {
  let q = admin
    .from('activities')
    .select(ACTIVITY_COLUMNS)
    .eq('profile_id', profileId)
    .order('started_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(LIST_PAGE + 1);
  if (audience !== 'owner') q = q.eq('only_me', false);
  if (cursor) q = q.or(`started_at.lt."${cursor.startedAt}",and(started_at.eq."${cursor.startedAt}",id.lt.${cursor.id})`); // hardening-ok: decodeCursor admits a strict ISO timestamp + a uuid only
  const { data, error } = await q;
  if (error) {
    console.error('[activities] list failed:', error.message);
    return { ok: false };
  }
  const rows = (data ?? []) as unknown as ActivityRow[];
  const page = rows.slice(0, LIST_PAGE);
  return {
    ok: true,
    items: page.map(r => projectActivity(r, audience)),
    next: rows.length > LIST_PAGE ? encodeCursor(page[page.length - 1]) : null,
  };
}

/** The last 12 weeks, folded (a bounded read: 12 weeks of one athlete). */
export async function readWeeklyTotals(admin: Admin, profileId: string, audience: ActivityAudience, today: string): Promise<WeekTotal[] | null> {
  const since = new Date(Date.parse(`${mondayOf(today)}T00:00:00Z`) - 11 * 7 * 86_400_000).toISOString().slice(0, 10);
  let q = admin
    .from('activities')
    .select('occurred_on, distance_m, moving_s, elapsed_s, elev_gain_m')
    .eq('profile_id', profileId)
    .gte('occurred_on', since)
    .limit(2000);
  if (audience !== 'owner') q = q.eq('only_me', false);
  const { data, error } = await q;
  if (error) {
    console.error('[activities] totals failed:', error.message);
    return null;
  }
  return weeklyTotals(data ?? [], today);
}

/** How many activities a viewer of this profile would see (the tab's count). */
export async function countActivities(admin: Admin, profileId: string, audience: ActivityAudience): Promise<number> {
  let q = admin.from('activities').select('id', { count: 'exact', head: true }).eq('profile_id', profileId);
  if (audience !== 'owner') q = q.eq('only_me', false);
  const { count, error } = await q;
  if (error) return 0;
  return count ?? 0;
}
