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

import type { SupabaseClient } from '@supabase/supabase-js';
import { collectSetMediaPaths } from './storage-sweep';

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
}

/**
 * Delete every trace of an account: DB rows (explicit, ordered — cascades
 * for pre-migration tables like posts are not fully verifiable), storage
 * files (best-effort → warnings), then the auth user. Throws when the
 * profiles delete or the auth delete fails; everything else degrades to
 * warnings.
 */
export async function hardDeleteAccount(
  admin: SupabaseClient,
  userId: string
): Promise<HardDeleteResult> {
  const warnings: string[] = [];

  // 1. Collect storage refs BEFORE deleting the rows that hold them.
  const byBucket = new Map<string, Set<string>>();
  const addRef = (url: unknown) => {
    const ref = storageRefFromUrl(url);
    if (!ref) return;
    if (!byBucket.has(ref.bucket)) byBucket.set(ref.bucket, new Set());
    byBucket.get(ref.bucket)!.add(ref.path);
  };

  const { data: profile } = await admin
    .from('profiles')
    .select('avatar_url, cover_url')
    .eq('id', userId)
    .maybeSingle();
  addRef(profile?.avatar_url);
  addRef(profile?.cover_url);

  // post_media has NO profile_id column — it links via post_id, so this
  // must go through the user's posts.
  const { data: userPosts } = await admin
    .from('posts')
    .select('id')
    .eq('profile_id', userId);
  const userPostIds = (userPosts || []).map(p => p.id);
  if (userPostIds.length > 0) {
    const { data: postMedia } = await admin
      .from('post_media')
      .select('media_url, thumbnail_url')
      .in('post_id', userPostIds);
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
  // Engagement data first.
  await admin.from('comment_likes').delete().eq('profile_id', userId);
  await admin.from('post_likes').delete().eq('profile_id', userId);
  await admin.from('saved_posts').delete().eq('profile_id', userId);
  await admin.from('post_comments').delete().eq('profile_id', userId);
  // Notifications (recipient and actor).
  await admin.from('notifications').delete().eq('user_id', userId);
  await admin.from('notifications').delete().eq('actor_id', userId);
  await admin.from('notification_preferences').delete().eq('user_id', userId);
  // Follow relationships (both directions).
  await admin.from('follows').delete().eq('follower_id', userId);
  await admin.from('follows').delete().eq('following_id', userId);
  // Sport data (golf_holes has no profile_id — cascades from golf_rounds).
  await admin.from('golf_rounds').delete().eq('profile_id', userId);
  await admin.from('season_highlights').delete().eq('profile_id', userId);
  await admin.from('performances').delete().eq('profile_id', userId);
  await admin.from('athlete_badges').delete().eq('profile_id', userId);
  await admin.from('sport_settings').delete().eq('profile_id', userId);
  // Org membership needs no explicit step: memberships (140) and the
  // club/league request tables CASCADE from profiles, and an owned org goes
  // ownerless via owner_profile_id's SET NULL (athlete_clubs was dropped).
  // Group rounds: participant rows key on profile_id; created rounds'
  // participants/scorecards cascade.
  await admin.from('group_post_participants').delete().eq('profile_id', userId);
  await admin.from('group_posts').delete().eq('creator_id', userId);
  // Posts (post_media, likes and comments cascade via post_id).
  await admin.from('posts').delete().eq('profile_id', userId);

  // Profile row — guardian tables (profile_access, guardian_invites,
  // profile_transfers) cascade from here; consent_records SET NULL.
  const { error: profileError } = await admin
    .from('profiles')
    .delete()
    .eq('id', userId);
  if (profileError) {
    throw new Error(`Failed to delete profile: ${profileError.message}`);
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

  // 5. Auth user — CRITICAL: must succeed to free the email.
  const { error: authError } = await admin.auth.admin.deleteUser(userId);
  if (authError) {
    throw new Error(`Failed to delete authentication user: ${authError.message}`);
  }

  return { warnings };
}
