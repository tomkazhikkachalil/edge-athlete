import type { SupabaseClient } from '@supabase/supabase-js';
import { notifyGuardians } from '@/lib/guardian-notify';
import { hiddenAuthorsFor } from '@/lib/mutes';
import { isMissingTableError } from '@/lib/orgs/validate';
import { isDeparted, publicDisplayName, type MaskableProfile } from '@/lib/orgs/public-names';
import { OFFICIAL_PROVENANCE } from '@/lib/results/official';
import type { PerformanceRow } from '@/lib/performance/types';
import {
  challengeLine,
  expiredStatus,
  nextStatus,
  qualifies,
  validateChallenge,
  type ChallengeAction,
  type ChallengeDraft,
  type ChallengeStatus,
  type ChallengeTerms,
} from './challenges';

/**
 * Friend challenges — the Play program (244). Server-only; the ONE writer
 * of `challenges`.
 *
 *  • create — mutual follows only (Tom), never across a block or a mute
 *    (either side), never to a departed account, never while the challengee
 *    turned challenges off; at most 10 open per challenger. The challengee
 *    gets an ACTIONABLE bell (Accept / Decline); a supervised athlete's
 *    guardians get a copy of every challenge bell.
 *  • respond — accept / decline (the challengee, pending only) or cancel
 *    (the challenger, while open), a compare-and-set on `version`. An
 *    accept settles at once when a result already in the window answers it.
 *  • settle — the post-write hook (after-write.ts): a written result of the
 *    challengee that answers an accepted challenge wins it (verified when
 *    the result is); both hear.
 *  • expire — the daily cron: pending → expired, accepted → lost.
 *
 * Never throws out of settle / expire (they ride other writes); create and
 * respond answer typed outcomes for the routes.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;
const TAG = '[challenges]';
const OPEN_CAP = 10;
const COLUMNS = 'id, challenger_id, challengee_id, sport_key, metric, direction, target, course_id, min_holes, source_key, message, starts_on, ends_on, status, responded_at, settled_at, settled_key, settled_value, verified, version, created_at';

export interface ChallengeRow extends ChallengeTerms {
  id: string;
  challenger_id: string;
  challengee_id: string;
  source_key: string | null;
  message: string | null;
  status: ChallengeStatus;
  responded_at: string | null;
  settled_at: string | null;
  settled_key: string | null;
  settled_value: number | null;
  verified: boolean;
  version: number;
  created_at: string;
}

type Outcome<T> = ({ ok: true } & T) | { ok: false; status: number; error: string };

const today = () => new Date().toISOString().slice(0, 10);

async function names(admin: Admin, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const { data } = await admin.from('profiles').select('id, first_name, last_name, full_name, visibility, email, supervision_state, departed_at').in('id', [...ids]);
  // Between mutual followers the full name is known to both — the bell speaks it (the event bells' rule).
  for (const p of (data ?? []) as Array<MaskableProfile & { id: string }>) out.set(p.id, [p.first_name, p.last_name].filter(Boolean).join(' ') || p.full_name || publicDisplayName(p));
  return out;
}

async function courseName(admin: Admin, courseId: string | null): Promise<string | null> {
  if (!courseId) return null;
  const { data } = await admin.from('golf_courses').select('name').eq('id', courseId).maybeSingle();
  return (data as { name?: string } | null)?.name ?? null;
}

/** The bell lands on the athlete's own Stats, on the challenge's sport (P9 lists them there). */
const challengeUrl = (c: { id: string; sport_key: string }) => `/athlete?tab=stats&sport=${encodeURIComponent(c.sport_key)}&challenge=${c.id}`;

async function bell(admin: Admin, to: string, from: string | null, type: 'challenge' | 'challenge_result', title: string, message: string, c: { id: string; sport_key: string }, pending = false): Promise<void> {
  const challengeId = c.id;
  const row = {
    user_id: to,
    type,
    actor_id: from,
    title,
    message,
    action_url: challengeUrl(c),
    is_read: false,
    metadata: { challenge_id: challengeId },
    ...(pending ? { action_status: 'pending' } : {}),
  };
  try {
    const { error } = await admin.from('notifications').insert(row);
    if (error) console.warn(`${TAG} bell failed:`, error.message);
    await notifyGuardians(admin, to, { type, title, message, actionUrl: null, actorId: from, metadata: { challenge_id: challengeId } }, from);
  } catch (e) {
    console.warn(`${TAG} bell threw:`, e instanceof Error ? e.message : e);
  }
}

/** Both directions accepted (never an `.or()` over interpolated ids). */
async function mutualFollow(admin: Admin, a: string, b: string): Promise<boolean> {
  const [ab, ba] = await Promise.all([
    admin.from('follows').select('id').eq('follower_id', a).eq('following_id', b).eq('status', 'accepted').limit(1),
    admin.from('follows').select('id').eq('follower_id', b).eq('following_id', a).eq('status', 'accepted').limit(1),
  ]);
  return (ab.data ?? []).length > 0 && (ba.data ?? []).length > 0;
}

/** Everyone the challenger may challenge — mutual follows not hidden either way. For the picker. */
export async function challengeablePeople(admin: Admin, profileId: string): Promise<Array<{ id: string; name: string }>> {
  const [out, inn, hidden] = await Promise.all([
    admin.from('follows').select('following_id').eq('follower_id', profileId).eq('status', 'accepted').limit(2000),
    admin.from('follows').select('follower_id').eq('following_id', profileId).eq('status', 'accepted').limit(2000),
    hiddenAuthorsFor(admin, profileId),
  ]);
  const followers = new Set(((inn.data ?? []) as Array<{ follower_id: string }>).map(r => r.follower_id));
  const mutual = ((out.data ?? []) as Array<{ following_id: string }>).map(r => r.following_id).filter(id => followers.has(id) && !hidden.has(id) && id !== profileId);
  const who = await names(admin, mutual);
  return mutual.filter(id => who.has(id)).map(id => ({ id, name: who.get(id)! })).sort((a, b) => a.name.localeCompare(b.name));
}

export async function createChallenge(admin: Admin, challengerId: string, draft: ChallengeDraft): Promise<Outcome<{ challenge: ChallengeRow }>> {
  const checked = validateChallenge(draft, challengerId, today());
  if (!checked.ok) return { ok: false, status: 400, error: checked.error };
  const c = checked.value;
  const refused = { ok: false as const, status: 403, error: 'You can challenge people you follow who follow you back.' };

  const [{ data: target }, mutual, hiddenByMe, hiddenByThem, { data: pref }, { count: open }] = await Promise.all([
    admin.from('profiles').select('id, departed_at').eq('id', c.challengee_id).maybeSingle(),
    mutualFollow(admin, challengerId, c.challengee_id),
    hiddenAuthorsFor(admin, challengerId),
    hiddenAuthorsFor(admin, c.challengee_id),
    admin.from('notification_preferences').select('challenges_enabled').eq('user_id', c.challengee_id).maybeSingle(),
    admin.from('challenges').select('id', { count: 'exact', head: true }).eq('challenger_id', challengerId).in('status', ['pending', 'accepted']),
  ]);
  if (!target || isDeparted(target as { departed_at: string | null })) return refused;
  // A block or a mute on either side reads exactly like "not mutual" — never which it was.
  if (!mutual || hiddenByMe.has(c.challengee_id) || hiddenByThem.has(challengerId)) return refused;
  if ((pref as { challenges_enabled?: boolean | null } | null)?.challenges_enabled === false) {
    return { ok: false, status: 403, error: 'They are not taking challenges right now.' };
  }
  if ((open ?? 0) >= OPEN_CAP) return { ok: false, status: 409, error: `You have ${OPEN_CAP} open challenges — let one finish first.` };

  // "Beat my 78 at Eagle Creek": the course comes off the challenger's OWN round (a catalog course only).
  if (draft.sameCourse && c.sport_key === 'golf' && c.source_key?.startsWith('golf_round:')) {
    const { data: src } = await admin.from('golf_rounds').select('course_id').eq('id', c.source_key.slice('golf_round:'.length)).eq('profile_id', challengerId).maybeSingle();
    const courseId = (src as { course_id?: string | null } | null)?.course_id ?? null;
    if (courseId) c.course_id = courseId;
  }

  const { data, error } = await admin.from('challenges').insert({ challenger_id: challengerId, ...c }).select(COLUMNS).single();
  if (error || !data) {
    if (error && isMissingTableError(error.code)) return { ok: false, status: 503, error: 'Challenges are not available yet.' };
    console.warn(`${TAG} create failed:`, error?.message);
    return { ok: false, status: 500, error: 'Could not send the challenge.' };
  }
  const row = data as ChallengeRow;
  const [who, course] = await Promise.all([names(admin, [challengerId]), courseName(admin, row.course_id)]);
  await bell(admin, row.challengee_id, challengerId, 'challenge', `${who.get(challengerId) ?? 'A friend'} challenged you`, challengeLine({ ...row, courseName: course }), row, true);
  return { ok: true, challenge: row };
}

/** The first result already in the window that answers it (an accept settles at once). */
async function firstAnswer(admin: Admin, c: ChallengeRow): Promise<{ natural_key: string; value: number; verified: boolean } | null> {
  const { data } = await admin
    .from('athlete_performances')
    .select('natural_key, sport_key, occurred_on, metrics, context, provenance')
    .eq('profile_id', c.challengee_id)
    .eq('sport_key', c.sport_key)
    .gte('occurred_on', c.starts_on)
    .lte('occurred_on', c.ends_on)
    .order('occurred_on', { ascending: true })
    .limit(500);
  for (const r of (data ?? []) as Array<{ natural_key: string; sport_key: string; occurred_on: string; metrics: Record<string, number>; context: Record<string, unknown> | null; provenance: string | null }>) {
    if (qualifies(c, r)) return { natural_key: r.natural_key, value: r.metrics[c.metric], verified: !!r.provenance && OFFICIAL_PROVENANCE.has(r.provenance) };
  }
  return null;
}

async function win(admin: Admin, c: ChallengeRow, answer: { natural_key: string; value: number; verified: boolean }, notify: boolean): Promise<boolean> {
  const { data, error } = await admin
    .from('challenges')
    .update({ status: 'won', settled_at: new Date().toISOString(), settled_key: answer.natural_key, settled_value: answer.value, verified: answer.verified, version: c.version + 1 })
    .eq('id', c.id)
    .eq('version', c.version)
    .eq('status', 'accepted')
    .select('id');
  if (error) {
    console.warn(`${TAG} settle failed:`, error.message);
    return false;
  }
  if (!data || data.length === 0) return false; // someone else settled or moved it first
  if (notify) {
    const [who, course] = await Promise.all([names(admin, [c.challenger_id, c.challengee_id]), courseName(admin, c.course_id)]);
    const line = challengeLine({ ...c, courseName: course });
    const mark = answer.verified ? ' — verified' : '';
    await bell(admin, c.challengee_id, c.challenger_id, 'challenge_result', `Challenge won: ${answer.value}${mark}`, `You answered ${who.get(c.challenger_id) ?? 'your friend'}'s challenge — ${line}.`, c);
    await bell(admin, c.challenger_id, c.challengee_id, 'challenge_result', `${who.get(c.challengee_id) ?? 'Your friend'} met your challenge`, `${answer.value}${mark} — ${line}.`, c);
  }
  return true;
}

export async function respondChallenge(admin: Admin, challengeId: string, actorId: string, action: ChallengeAction): Promise<Outcome<{ status: ChallengeStatus }>> {
  const { data } = await admin.from('challenges').select(COLUMNS).eq('id', challengeId).maybeSingle();
  const c = data as ChallengeRow | null;
  // A stranger learns nothing: not yours = not found.
  if (!c || (actorId !== c.challenger_id && actorId !== c.challengee_id)) return { ok: false, status: 404, error: 'No such challenge.' };
  const by = actorId === c.challenger_id ? 'challenger' : 'challengee';
  const next = nextStatus(c.status, action, by);
  if (!next) return { ok: false, status: 409, error: 'That challenge has moved on — reload.' };
  if (next === 'accepted' && c.ends_on < today()) return { ok: false, status: 409, error: 'That challenge has run out of time.' };
  const { data: moved, error } = await admin
    .from('challenges')
    .update({ status: next, version: c.version + 1, ...(action !== 'cancel' ? { responded_at: new Date().toISOString() } : {}) })
    .eq('id', c.id)
    .eq('version', c.version)
    .select('id');
  if (error) {
    console.warn(`${TAG} respond failed:`, error.message);
    return { ok: false, status: 500, error: 'Could not update the challenge.' };
  }
  if (!moved || moved.length === 0) return { ok: false, status: 409, error: 'That challenge changed — reload.' };

  // The challengee's bell stops asking.
  if (action !== 'cancel') {
    await admin.from('notifications').update({ action_status: next === 'accepted' ? 'accepted' : 'declined', is_read: true }).eq('user_id', c.challengee_id).eq('type', 'challenge').eq('metadata->>challenge_id', c);
  }
  const who = await names(admin, [c.challenger_id, c.challengee_id]);
  const line = challengeLine({ ...c, courseName: await courseName(admin, c.course_id) });
  if (next === 'accepted') await bell(admin, c.challenger_id, c.challengee_id, 'challenge_result', `${who.get(c.challengee_id) ?? 'Your friend'} accepted your challenge`, line, c);
  if (next === 'declined') await bell(admin, c.challenger_id, c.challengee_id, 'challenge_result', `${who.get(c.challengee_id) ?? 'Your friend'} passed on your challenge`, line, c);
  if (next === 'cancelled' && c.status === 'accepted') await bell(admin, c.challengee_id, c.challenger_id, 'challenge_result', `${who.get(c.challenger_id) ?? 'Your friend'} called off the challenge`, line, c);

  // An accept settles at once when a result already in the window answers it.
  if (next === 'accepted') {
    const answer = await firstAnswer(admin, { ...c, status: 'accepted', version: c.version + 1 });
    if (answer && (await win(admin, { ...c, status: 'accepted', version: c.version + 1 }, answer, true))) return { ok: true, status: 'won' };
  }
  return { ok: true, status: next };
}

/** The post-write hook's half: a challengee's new results against their accepted challenges. */
export async function settleChallengesAfterWrite(admin: Admin, rows: readonly PerformanceRow[], opts: { notify: boolean }): Promise<void> {
  try {
    const byProfile = new Map<string, PerformanceRow[]>();
    for (const r of rows) {
      if (!r.profile_id) continue;
      const list = byProfile.get(r.profile_id);
      if (list) list.push(r);
      else byProfile.set(r.profile_id, [r]);
    }
    for (const [profileId, mine] of byProfile) {
      const sports = [...new Set(mine.map(r => r.sport_key))];
      const { data, error } = await admin.from('challenges').select(COLUMNS).eq('challengee_id', profileId).eq('status', 'accepted').in('sport_key', sports);
      if (error) {
        if (!isMissingTableError(error.code)) console.warn(`${TAG} open read failed:`, error.message);
        continue;
      }
      for (const c of (data ?? []) as ChallengeRow[]) {
        const hits = mine.filter(r => qualifies(c, r));
        if (hits.length === 0) continue;
        const best = hits.find(r => !!r.provenance && OFFICIAL_PROVENANCE.has(r.provenance)) ?? hits[0];
        await win(admin, c, { natural_key: best.natural_key, value: best.metrics[c.metric], verified: !!best.provenance && OFFICIAL_PROVENANCE.has(best.provenance) }, opts.notify);
      }
    }
  } catch (e) {
    console.warn(`${TAG} settle pass threw:`, e instanceof Error ? e.message : e);
  }
}

/** The daily cron's step: an open challenge past its window expires (pending) or is lost (accepted). */
export async function expireChallenges(admin: Admin, now = new Date()): Promise<{ ok: boolean; expired: number; lost: number }> {
  const day = now.toISOString().slice(0, 10);
  let expired = 0, lost = 0;
  try {
    const { data, error } = await admin.from('challenges').select(COLUMNS).in('status', ['pending', 'accepted']).lt('ends_on', day).limit(500);
    if (error) {
      if (isMissingTableError(error.code)) return { ok: true, expired, lost };
      console.warn(`${TAG} sweep read failed:`, error.message);
      return { ok: false, expired, lost };
    }
    for (const c of (data ?? []) as ChallengeRow[]) {
      const next = expiredStatus(c.status, c.ends_on, day);
      if (!next) continue;
      const { data: moved } = await admin.from('challenges').update({ status: next, version: c.version + 1 }).eq('id', c.id).eq('version', c.version).select('id');
      if (!moved || moved.length === 0) continue;
      if (next === 'expired') {
        expired++;
        await admin.from('notifications').update({ action_status: 'declined', is_read: true }).eq('user_id', c.challengee_id).eq('type', 'challenge').eq('metadata->>challenge_id', c.id).eq('action_status', 'pending');
      } else {
        lost++;
        const who = await names(admin, [c.challenger_id, c.challengee_id]);
        const line = challengeLine({ ...c, courseName: await courseName(admin, c.course_id) });
        await bell(admin, c.challengee_id, c.challenger_id, 'challenge_result', 'A challenge ran out of time', `${who.get(c.challenger_id) ?? 'Your friend'}'s challenge — ${line}. Next time!`, c);
        await bell(admin, c.challenger_id, c.challengee_id, 'challenge_result', `Your challenge held`, `${who.get(c.challengee_id) ?? 'Your friend'} did not get there — ${line}.`, c);
      }
    }
    return { ok: true, expired, lost };
  } catch (e) {
    console.warn(`${TAG} sweep threw:`, e instanceof Error ? e.message : e);
    return { ok: false, expired, lost };
  }
}

export interface ChallengeView extends ChallengeRow {
  role: 'challenger' | 'challengee';
  otherName: string;
  courseName: string | null;
  line: string;
}

/** Both directions of a profile's challenges, newest first (the owner's list). */
export async function listChallenges(admin: Admin, profileId: string): Promise<ChallengeView[]> {
  const [mine, theirs] = await Promise.all([
    admin.from('challenges').select(COLUMNS).eq('challenger_id', profileId).order('created_at', { ascending: false }).limit(50),
    admin.from('challenges').select(COLUMNS).eq('challengee_id', profileId).order('created_at', { ascending: false }).limit(50),
  ]);
  const rows = [...((mine.data ?? []) as ChallengeRow[]), ...((theirs.data ?? []) as ChallengeRow[])].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const others = [...new Set(rows.map(r => (r.challenger_id === profileId ? r.challengee_id : r.challenger_id)))];
  const courses = [...new Set(rows.map(r => r.course_id).filter((x): x is string => !!x))];
  const [who, { data: courseRows }] = await Promise.all([
    names(admin, others),
    courses.length ? admin.from('golf_courses').select('id, name').in('id', courses) : Promise.resolve({ data: [] as Array<{ id: string; name: string }> }),
  ]);
  const courseOf = new Map(((courseRows ?? []) as Array<{ id: string; name: string }>).map(c => [c.id, c.name]));
  return rows.map(r => {
    const role = r.challenger_id === profileId ? 'challenger' : 'challengee';
    const other = role === 'challenger' ? r.challengee_id : r.challenger_id;
    const course = r.course_id ? courseOf.get(r.course_id) ?? null : null;
    return { ...r, role, otherName: who.get(other) ?? 'Athlete', courseName: course, line: challengeLine({ ...r, courseName: course }) };
  });
}

