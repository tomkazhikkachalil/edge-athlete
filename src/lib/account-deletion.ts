// Hard account deletion — the ONE deletion engine, shared by self-serve
// account deletion, guardian child-profile deletion (consent withdrawal),
// and admin orphan cleanup. Callers own authentication, confirmation, and
// any compliance writes (consent/audit rows); this module owns the data.
//
// Storage: refs are collected from DB URLs before rows are deleted and
// removed best-effort afterwards — the weekly storage sweep remains the
// safety net for anything missed. consent-evidence is NEVER touched:
// signed consent forms must survive deletion (compliance; the matching
// consent_records rows SET NULL their profile FK by design).
//
// Departed accounts (migration 238, Sep 24 2026) — Tom's rule: a result that
// is part of a game, event, round, club or league OUTLIVES the person. The
// engine first counts the rows other people depend on and asks
// `departureMode` (src/lib/account-departure.ts) what to do:
//   * 'erase'     — the full delete below, as it always was (nothing tied, a
//                   roster stub, or a minor whose guardian signed the v2
//                   consent that promised erasure) — with the protections
//                   for OTHER players a v2 minor needs (a shared round or an
//                   event the minor created passes to another participant).
//   * 'tombstone' / 'masked' — the profile ROW stays, name only: solo content
//                   goes, results / participations / hosted things / shared
//                   media stay, every personal column is stripped, the auth
//                   user is deleted and `departed_at` is stamped. Every
//                   cascading FK onto profiles is classified in
//                   PROFILE_FK_POLICY and each 'goes' entry is deleted here
//                   by `mustDelete('<table>', '<column>')` — the
//                   classification test reads this file to hold it true.

import type { SupabaseClient } from '@supabase/supabase-js';
import * as Sentry from '@sentry/nextjs';
import { collectSetMediaPaths } from './storage-sweep';
import { orgRefOf } from './orgs/org-ref';
import { departedProfilePatch, departureMode, type DepartureMode, type TiedCounts } from './account-departure';
import { recordAuthority } from './authority/audit-server';

/**
 * Parse any Supabase public-object URL into { bucket, path }. Returns null
 * for external hosts, malformed URLs, and the consent-evidence bucket
 * (explicit denylist — evidence survives account deletion).
 */
export function storageRefFromUrl(url: unknown): { bucket: string; path: string } | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  const m = /\/storage\/v1\/object\/public\/([^/]+)\/(.+?)(?:[?#]|$)/.exec(url);
  if (!m) return null;
  const bucket = m[1];
  if (bucket === 'consent-evidence') return null;
  let path = m[2];
  try {
    path = decodeURIComponent(path);
  } catch {
    // keep the raw path
  }
  return { bucket, path };
}

export interface HardDeleteResult {
  warnings: string[];
  /** 238: what happened to the row — erased, or kept as a tombstone. */
  mode: DepartureMode;
}

type Admin = SupabaseClient;

async function countOf(q: PromiseLike<{ count: number | null; error: { message: string } | null }>, what: string): Promise<number> {
  const { count, error } = await q;
  if (error) throw new Error(`Failed to count ${what}: ${error.message}`);
  return count ?? 0;
}

/** The person's group rounds split three ways: SOLO (only the creator plays
 *  and no event minted it — solo content, deleted), SHARED (created by the
 *  person, another participant or an event depends on it — kept) and the
 *  rounds of OTHERS the person has a card on. */
export async function readRoundTies(admin: Admin, userId: string): Promise<{ soloCreated: string[]; sharedCreated: string[]; othersRounds: string[] }> {
  const { data: created, error } = await admin.from('group_posts').select('id, sport_event_round_id').eq('creator_id', userId);
  if (error) throw new Error(`Failed to read created rounds: ${error.message}`);
  const createdIds = (created ?? []).map(r => r.id as string);
  const withOthers = new Set<string>();
  if (createdIds.length > 0) {
    const { data: others, error: othersError } = await admin
      .from('group_post_participants').select('group_post_id').in('group_post_id', createdIds).neq('profile_id', userId);
    if (othersError) throw new Error(`Failed to read round participants: ${othersError.message}`);
    for (const r of others ?? []) withOthers.add(r.group_post_id as string);
  }
  const soloCreated: string[] = [];
  const sharedCreated: string[] = [];
  for (const r of created ?? []) {
    if (r.sport_event_round_id || withOthers.has(r.id as string)) sharedCreated.push(r.id as string);
    else soloCreated.push(r.id as string);
  }
  const { data: cards, error: cardsError } = await admin.from('group_post_participants').select('group_post_id').eq('profile_id', userId);
  if (cardsError) throw new Error(`Failed to read round cards: ${cardsError.message}`);
  const createdSet = new Set(createdIds);
  const othersRounds = [...new Set((cards ?? []).map(c => c.group_post_id as string).filter(id => !createdSet.has(id)))];
  return { soloCreated, sharedCreated, othersRounds };
}

/** Count the rows other people depend on (the input to departureMode). */
export async function countTiedRows(admin: Admin, userId: string, rounds?: Awaited<ReturnType<typeof readRoundTies>>): Promise<TiedCounts> {
  const r = rounds ?? await readRoundTies(admin, userId);
  const head = { count: 'exact' as const, head: true };
  const [entries, entryMembers, contestStatLines, eventParticipants, hostedEvents, orgCalendarEvents, eventMedia, contestTags, roundMedia] = await Promise.all([
    countOf(admin.from('competition_entries').select('id', head).eq('profile_id', userId), 'competition entries'),
    countOf(admin.from('competition_entry_members').select('entry_id', head).eq('profile_id', userId), 'entry members'),
    countOf(admin.from('contest_stat_lines').select('id', head).eq('profile_id', userId), 'contest stat lines'),
    countOf(admin.from('sport_event_participants').select('id', head).eq('profile_id', userId), 'event participations'),
    countOf(admin.from('sport_events').select('id', head).eq('host_profile_id', userId), 'hosted events'),
    countOf(admin.from('events').select('id', head).eq('organizer_id', userId).not('org_id', 'is', null), 'org calendar events'),
    countOf(admin.from('sport_event_media').select('id', head).eq('uploaded_by', userId), 'event media'),
    countOf(admin.from('contest_media_tags').select('media_id', head).eq('profile_id', userId), 'contest photo tags'),
    r.othersRounds.length > 0
      ? countOf(admin.from('group_post_media').select('id', head).eq('uploaded_by', userId).in('group_post_id', r.othersRounds), 'round media')
      : Promise.resolve(0),
  ]);
  return {
    entries, entryMembers, contestStatLines, eventParticipants, hostedEvents,
    sharedRoundsCreated: r.sharedCreated.length,
    cardsOnOthersRounds: r.othersRounds.length,
    orgCalendarEvents,
    sharedMedia: eventMedia + contestTags + roundMedia,
  };
}

/** The policy_version of the latest GRANTED consent for a supervised profile. */
export async function latestConsentVersion(admin: Admin, profileId: string): Promise<string | null> {
  const { data, error } = await admin
    .from('consent_records').select('policy_version')
    .eq('profile_id', profileId).eq('action', 'granted')
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Failed to read consent version: ${error.message}`);
  return (data?.policy_version as string | undefined) ?? null;
}

export interface DeparturePlan {
  mode: DepartureMode;
  tied: TiedCounts;
  consentVersion: string | null;
}

/** What the engine WOULD do — the admin door's dry run reads this. */
export async function planDeparture(admin: Admin, userId: string): Promise<DeparturePlan> {
  const { data: profile, error } = await admin.from('profiles').select('email, supervision_state').eq('id', userId).maybeSingle();
  if (error) throw new Error(`Failed to read profile: ${error.message}`);
  if (!profile) throw new Error('Profile not found');
  const tied = await countTiedRows(admin, userId);
  const consentVersion = profile.supervision_state === 'supervised' ? await latestConsentVersion(admin, userId) : null;
  return { mode: departureMode(profile, tied, consentVersion), tied, consentVersion };
}

/**
 * Delete every trace of an account — or, when the person has results other
 * people depend on, everything but a name-only tombstone (238). Storage is
 * best-effort (warnings); everything else throws BEFORE the profile row
 * changes, so a failure leaves the account intact for a retry.
 */
export async function hardDeleteAccount(
  admin: SupabaseClient,
  userId: string
): Promise<HardDeleteResult> {
  const warnings: string[] = [];

  const { data: profileRow, error: profileReadError } = await admin
    .from('profiles')
    .select('email, supervision_state, avatar_url, cover_url')
    .eq('id', userId)
    .maybeSingle();
  if (profileReadError) throw new Error(`Failed to read profile: ${profileReadError.message}`);
  if (!profileRow) throw new Error('Profile not found');

  const rounds = await readRoundTies(admin, userId);
  const tied = await countTiedRows(admin, userId, rounds);
  const consentVersion = profileRow.supervision_state === 'supervised' ? await latestConsentVersion(admin, userId) : null;
  const mode = departureMode(profileRow, tied, consentVersion);
  const keep = mode !== 'erase';

  // 1. Collect storage refs BEFORE deleting the rows that hold them.
  const byBucket = new Map<string, Set<string>>();
  const addRef = (url: unknown) => {
    const ref = storageRefFromUrl(url);
    if (!ref) return;
    if (!byBucket.has(ref.bucket)) byBucket.set(ref.bucket, new Set());
    byBucket.get(ref.bucket)!.add(ref.path);
  };
  addRef(profileRow.avatar_url);
  addRef(profileRow.cover_url);

  // The posts that go. A kept account keeps the posts that ARE a shared
  // thing's feed card — an event round's post, a kept shared round's post —
  // and deletes the rest; an erase deletes them all.
  const { data: userPosts, error: postsError } = await admin
    .from('posts')
    .select('id, group_post_id, sport_event_round_id')
    .eq('profile_id', userId);
  if (postsError) throw new Error(`Failed to read posts: ${postsError.message}`);
  const sharedRoundSet = new Set(rounds.sharedCreated);
  const keptPost = (p: { group_post_id: string | null; sport_event_round_id: string | null }) =>
    keep && (!!p.sport_event_round_id || (!!p.group_post_id && sharedRoundSet.has(p.group_post_id)));
  const doomedPostIds = (userPosts ?? []).filter(p => !keptPost(p)).map(p => p.id as string);

  // post_media has NO profile_id column — it links via post_id.
  if (doomedPostIds.length > 0) {
    const { data: postMedia } = await admin
      .from('post_media')
      .select('media_url, thumbnail_url')
      .in('post_id', doomedPostIds);
    for (const m of postMedia || []) {
      addRef(m.media_url);
      addRef(m.thumbnail_url);
    }
  }

  // Workout media lives in workout_sets.media jsonb (uploads bucket).
  const { data: workoutSets } = await admin
    .from('workout_sets')
    .select('media')
    .eq('profile_id', userId);
  for (const path of collectSetMediaPaths((workoutSets || []).map(s => s.media))) {
    if (!byBucket.has('uploads')) byBucket.set('uploads', new Set());
    byBucket.get('uploads')!.add(path);
  }

  // 2. Release consent rows FIRST. They survive deletion with their FKs
  // nulled (050's design); nulling them explicitly up front means that on
  // a database without migration 056 (whose append-only trigger would also
  // reject the FKs' own ON DELETE SET NULL) we abort CLEANLY here, with
  // nothing deleted yet — never a half-deleted account. With 056 applied
  // this is exactly the transition the trigger permits.
  const { error: consentProfileNull } = await admin
    .from('consent_records')
    .update({ profile_id: null })
    .eq('profile_id', userId);
  if (consentProfileNull) {
    throw new Error(`Failed to release consent records (is migration 056 applied?): ${consentProfileNull.message}`);
  }
  const { error: consentGuardianNull } = await admin
    .from('consent_records')
    .update({ guardian_user_id: null })
    .eq('guardian_user_id', userId);
  if (consentGuardianNull) {
    throw new Error(`Failed to release consent records (is migration 056 applied?): ${consentGuardianNull.message}`);
  }

  // 3. Delete data in dependency order (admin client bypasses RLS).
  // Round 1 PR 2: every delete is CHECKED and a failure ABORTS before the
  // profile row goes — nothing irrecoverable has happened yet, the account
  // is intact, the caller retries. A discarded error here used to report a
  // partial deletion as success.
  const mustDelete = async (table: string, column: string) => {
    const { error } = await admin.from(table).delete().eq(column, userId);
    if (error) throw new Error(`Failed to delete ${table} (${column}): ${error.message}`);
  };
  const check = async (what: string, q: PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await q;
    if (error) throw new Error(`Failed to ${what}: ${error.message}`);
  };
  // Engagement data first.
  await mustDelete('comment_likes', 'profile_id');
  await mustDelete('post_likes', 'profile_id');
  await mustDelete('saved_posts', 'profile_id');
  await mustDelete('post_comments', 'profile_id');
  // Notifications (recipient and actor).
  await mustDelete('notifications', 'user_id');
  await mustDelete('notifications', 'actor_id');
  await mustDelete('notification_preferences', 'user_id');
  // Follow relationships (both directions).
  await mustDelete('follows', 'follower_id');
  await mustDelete('follows', 'following_id');
  await mustDelete('season_highlights', 'profile_id');
  await mustDelete('performances', 'profile_id');
  // athlete_badges: dropped by migration 199 (Sep 2026) — nothing to delete.
  await mustDelete('sport_settings', 'profile_id');
  // Ownership (0.8): move the primary-owner cache to a surviving co-owner
  // BEFORE the membership rows go — best-effort; when the departing profile
  // was the LAST owner, the org orphans (owner cache NULL, no owner rows).
  try {
    const { recomputePrimaryOwner } = await import('./orgs/owners');
    const { data: ownerMemberships } = await admin
      .from('memberships')
      .select('org_id, org:organizations(kind)')
      .eq('profile_id', userId)
      .eq('role', 'owner')
      .eq('kind', 'follow')
      .eq('scope_type', 'org');
    for (const row of ownerMemberships ?? []) {
      const ref = orgRefOf(row);
      if (!ref) continue;
      const { side, orgId } = ref;
      const { error } = await recomputePrimaryOwner(admin, { side, orgId }, { excludeProfileId: userId });
      if (error) warnings.push(`owner cache recompute (${side} ${orgId}): ${error.message}`);
    }
  } catch (e) {
    warnings.push(`owner cache recompute failed: ${e instanceof Error ? e.message : 'unknown'}`);
  }

  if (!keep) {
    await eraseRoundsAndPosts(admin, userId, rounds, profileRow.supervision_state === 'supervised', warnings, mustDelete);
  } else {
    await keepRoundsAndPosts(admin, userId, rounds, doomedPostIds, check);
    await deleteOwnThings(admin, userId, mustDelete, check);
  }

  if (!keep) {
    // Profile row — every cascade fires as it always did (guardian tables,
    // memberships, calendar rows …); consent_records SET NULL; 238:
    // athlete_performances SET NULL (the fact survives the person).
    const { error: profileError } = await admin.from('profiles').delete().eq('id', userId);
    if (profileError) throw new Error(`Failed to delete profile: ${profileError.message}`);
  } else {
    // The dataset keeps the fact and severs the person (Tom).
    await check('sever performance rows', admin.from('athlete_performances').update({ profile_id: null }).eq('profile_id', userId));
    // The strip — the row becomes a name-only tombstone. The search
    // document leaves through its trigger (238 watches departed_at).
    await check('strip the profile', admin.from('profiles').update(departedProfilePatch(userId, mode, new Date())).eq('id', userId));
  }

  // 4. Storage cleanup — best-effort, the sweep catches leftovers.
  for (const [bucket, paths] of byBucket) {
    try {
      const { error } = await admin.storage.from(bucket).remove([...paths]);
      if (error) {
        console.error(`[ACCOUNT-DELETION] storage remove failed (${bucket}):`, error);
        warnings.push(`${bucket}: ${error.message}`);
      }
    } catch (e) {
      console.error(`[ACCOUNT-DELETION] storage error (${bucket}):`, e);
      warnings.push(`${bucket}: ${e instanceof Error ? e.message : 'Unknown error'}`);
    }
  }

  // 5. Auth user — CRITICAL: must succeed to free the email. Since 238 the
  // profile row no longer cascades from it, so a tombstone survives this.
  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError) {
    throw new Error(`Failed to delete authentication user: ${authError.message}`);
  }

  // Round 1 PR 2: the warnings were returned and read by nobody — a deletion
  // that left storage or an owner cache behind now shows up in Sentry.
  if (warnings.length > 0) {
    Sentry.captureMessage('account deletion completed with warnings', { level: 'warning', extra: { userId, mode, warnings } });
  }
  return { warnings, mode };
}

type MustDelete = (table: string, column: string) => Promise<void>;
type Check = (what: string, q: PromiseLike<{ error: { message: string } | null }>) => Promise<void>;
type Rounds = Awaited<ReturnType<typeof readRoundTies>>;

/** The erase path's rounds and posts — today's order, plus the protections
 *  for OTHER players a supervised minor's erasure needs: a shared round or
 *  an event the minor created passes to another participant first, so the
 *  partners' cards and the event are not deleted with the minor. */
async function eraseRoundsAndPosts(admin: Admin, userId: string, rounds: Rounds, supervised: boolean, warnings: string[], mustDelete: MustDelete): Promise<void> {
  if (supervised) {
    for (const roundId of rounds.sharedCreated) {
      const { data: heir } = await admin
        .from('group_post_participants').select('profile_id')
        .eq('group_post_id', roundId).neq('profile_id', userId)
        .order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (!heir) { warnings.push(`shared round ${roundId}: no other participant to inherit it`); continue; }
      const { error } = await admin.from('group_posts').update({ creator_id: heir.profile_id }).eq('id', roundId);
      if (error) throw new Error(`Failed to hand over round ${roundId}: ${error.message}`);
    }
    const { data: hosted } = await admin.from('sport_events').select('id').eq('host_profile_id', userId);
    for (const ev of hosted ?? []) {
      const { data: heir } = await admin
        .from('sport_event_participants').select('profile_id')
        .eq('sport_event_id', ev.id).neq('profile_id', userId).eq('status', 'accepted')
        .in('role', ['organizer', 'co_organizer'])
        .order('created_at', { ascending: true }).limit(1).maybeSingle();
      if (!heir) { warnings.push(`hosted event ${ev.id}: no co-organizer to inherit it — it goes with the host`); continue; }
      const { error } = await admin.from('sport_events').update({ host_profile_id: heir.profile_id }).eq('id', ev.id);
      if (error) throw new Error(`Failed to hand over event ${ev.id}: ${error.message}`);
      // The event's minted rounds are created by the host — they follow it.
      const { data: minted } = await admin.from('sport_event_rounds').select('id').eq('sport_event_id', ev.id);
      const mintedIds = (minted ?? []).map(r => r.id as string);
      if (mintedIds.length > 0) {
        const { error: rErr } = await admin.from('group_posts').update({ creator_id: heir.profile_id }).in('sport_event_round_id', mintedIds).eq('creator_id', userId);
        if (rErr) throw new Error(`Failed to hand over event rounds of ${ev.id}: ${rErr.message}`);
      }
      await recordAuthority(admin, {
        subject: { type: 'sport_event', id: ev.id as string },
        actor: { kind: 'system' },
        action: 'host_transferred',
        targetProfileId: heir.profile_id as string,
        detail: { from_profile_id: userId, to_profile_id: heir.profile_id, reason: 'account_erased' },
      });
    }
  }
  // Sport data (golf_holes has no profile_id — cascades from golf_rounds).
  await mustDelete('golf_rounds', 'profile_id');
  // Group rounds: participant rows key on profile_id; created rounds'
  // participants/scorecards cascade.
  await mustDelete('group_post_participants', 'profile_id');
  await mustDelete('group_posts', 'creator_id');
  // Posts (post_media, likes and comments cascade via post_id).
  await mustDelete('posts', 'profile_id');
}

/** The keeping path's rounds and posts: solo rounds go, shared rounds (and
 *  the person's cards on them, and on everyone else's) stay. */
async function keepRoundsAndPosts(admin: Admin, userId: string, rounds: Rounds, doomedPostIds: string[], check: Check): Promise<void> {
  // group_posts: the SOLO ones only. Their participants and cards cascade;
  // their mirror golf_rounds lose group_post_id (SET NULL) and go below.
  for (let i = 0; i < rounds.soloCreated.length; i += 100) {
    await check('delete solo rounds', admin.from('group_posts').delete().in('id', rounds.soloCreated.slice(i, i + 100)));
  }
  // golf_rounds: the person's rounds that are not a shared round's mirror.
  await check('delete solo golf rounds', admin.from('golf_rounds').delete().eq('profile_id', userId).is('group_post_id', null));
  // group_post_participants: KEPT — the person's card on a shared round.
  for (let i = 0; i < doomedPostIds.length; i += 100) {
    await check('delete posts', admin.from('posts').delete().in('id', doomedPostIds.slice(i, i + 100)));
  }
}

/** Everything the person owned that used to cascade from the profile row —
 *  the 'goes' entries of PROFILE_FK_POLICY, plus the partly-kept tables. */
async function deleteOwnThings(admin: Admin, userId: string, mustDelete: MustDelete, check: Check): Promise<void> {
  // Messaging (a thread the person started goes whole, as the cascade always took it).
  await mustDelete('message_reactions', 'profile_id');
  await mustDelete('message_reports', 'reporter_id');
  await mustDelete('message_reports', 'reported_profile_id');
  await mustDelete('messages', 'sender_id');
  await mustDelete('conversation_participants', 'profile_id');
  await mustDelete('conversations', 'created_by');
  // Social graph and safety.
  await mustDelete('user_blocks', 'blocker_id');
  await mustDelete('user_blocks', 'blocked_id');
  await mustDelete('user_mutes', 'muter_id');
  await mustDelete('user_mutes', 'muted_id');
  await mustDelete('connection_suggestions', 'profile_id');
  await mustDelete('connection_suggestions', 'suggested_profile_id');
  await mustDelete('post_tags', 'tagged_profile_id');
  await mustDelete('post_tags', 'created_by_profile_id');
  await mustDelete('risk_signals', 'profile_id');
  await mustDelete('privacy_settings', 'profile_id');
  await mustDelete('handle_history', 'profile_id');
  await mustDelete('platform_admins', 'profile_id');
  // Guardian machinery: rows linking this profile to OTHER profiles go; the
  // profile's own access row stays (the zero-access guard, 048).
  await mustDelete('approved_contacts', 'child_profile_id');
  await mustDelete('approved_contacts', 'contact_profile_id');
  await mustDelete('guardian_invites', 'profile_id');
  await mustDelete('profile_transfers', 'profile_id');
  await mustDelete('athlete_claim_invites', 'profile_id');
  await check('delete profile_access rows over others', admin.from('profile_access').delete().eq('user_id', userId).neq('profile_id', userId));
  await check('delete profile_access rows held by others', admin.from('profile_access').delete().eq('profile_id', userId).neq('user_id', userId));
  // Orgs: the person leaves (memberships after the owner recompute above).
  await mustDelete('memberships', 'profile_id');
  await mustDelete('registrations', 'profile_id');
  await mustDelete('org_join_requests', 'profile_id');
  await mustDelete('org_requests', 'requester_profile_id');
  await check('release org owner caches', admin.from('organizations').update({ owner_profile_id: null }).eq('owner_profile_id', userId));
  // Calendar: the person's OWN events go; an org's events stay (organizer =
  // the tombstone), and so does a series that holds one.
  await mustDelete('event_guests', 'profile_id');
  await mustDelete('event_carpool_claims', 'rider_profile_id');
  await mustDelete('event_carpool_offers', 'driver_profile_id');
  await mustDelete('calendar_feed_tokens', 'profile_id');
  const { data: series, error: seriesError } = await admin.from('event_series').select('id').eq('organizer_id', userId);
  if (seriesError) throw new Error(`Failed to read event series: ${seriesError.message}`);
  const seriesIds = (series ?? []).map(r => r.id as string);
  const orgSeries = new Set<string>();
  if (seriesIds.length > 0) {
    const { data: orgEvents, error: oeError } = await admin.from('events').select('series_id').in('series_id', seriesIds).not('org_id', 'is', null);
    if (oeError) throw new Error(`Failed to read org series events: ${oeError.message}`);
    for (const e of orgEvents ?? []) if (e.series_id) orgSeries.add(e.series_id as string);
  }
  const ownSeries = seriesIds.filter(id => !orgSeries.has(id));
  if (ownSeries.length > 0) await check('delete own event series', admin.from('event_series').delete().in('id', ownSeries));
  await check('delete own calendar events', admin.from('events').delete().eq('organizer_id', userId).is('org_id', null));
  // Support: a ticket the person filed keeps its history, not their address
  // (the two-year anonymize's rule, applied at departure).
  await check('release reporter emails', admin.from('tickets').update({ reporter_email: null }).eq('reporter_profile_id', userId));
  // Recruiting.
  await mustDelete('scout_shortlists', 'scout_id');
  await mustDelete('scout_shortlists', 'athlete_id');
  // The person's own records and gear.
  await mustDelete('athlete_achievements', 'profile_id');
  await mustDelete('athlete_equipment', 'profile_id');
  await mustDelete('athlete_vitals', 'profile_id');
  await mustDelete('user_media_presets', 'profile_id');
  await mustDelete('sports', 'profile_id');
  await mustDelete('workout_sets', 'profile_id');
  await mustDelete('workout_exercises', 'profile_id');
  await mustDelete('workout_routine_exercises', 'profile_id');
  await mustDelete('workout_routines', 'profile_id');
  await mustDelete('workout_sessions', 'profile_id');
}
