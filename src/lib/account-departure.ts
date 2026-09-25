// ── Departed accounts — the pure rules (migration 238, Sep 24 2026) ─────────
// Tom's rule: a result that is part of a game, event, round, club or league
// OUTLIVES the person — "if someone leaves, I don't want that affecting other
// players' stats". When an account is purged, the deletion engine
// (src/lib/account-deletion.ts, the ONE writer) keeps the `profiles` row as a
// name-only TOMBSTONE whenever the person has results others depend on:
// the auth user is deleted, every personal column is stripped, and
// `profiles.departed_at` is stamped. Every foreign key keeps pointing at a
// real row, so no result reader changes shape — the roster stub (150) is the
// precedent for a name-only profile.
//
// Three modes, decided here and nowhere else:
//   * 'tombstone' — an adult with tied rows: the row keeps the FULL name.
//   * 'masked'    — a supervised athlete whose guardian signed a consent
//                   version that says results stay (v3 onward), with tied
//                   rows: the row is renamed "Athlete".
//   * 'erase'     — everyone else: today's full delete (a v2-consented minor
//                   — the statement the guardian signed promises it — an adult
//                   with nothing tied, a roster stub).
//
// Pure and node-testable; no I/O. The column lists below are PINNED by
// src/lib/__tests__/account-departure.test.ts, and PROFILE_FK_POLICY by
// src/lib/__tests__/profile-fk-classification.test.ts (every cascading FK
// onto profiles must be classified, so a new table cannot leak personal data
// behind a tombstone).

import { isStubEmail } from '@/lib/config/stubs-config';

export type DepartureMode = 'tombstone' | 'masked' | 'erase';

/** The reserved, unroutable email domain a tombstone carries (the
 *  `stubs.invalid` / `minors.invalid` family). */
export const DEPARTED_EMAIL_DOMAIN = 'departed.invalid';

export function departedEmailFor(profileId: string): string {
  return `${profileId}@${DEPARTED_EMAIL_DOMAIN}`;
}

export function isDepartedEmail(email: string | null | undefined): boolean {
  return !!email && email.toLowerCase().endsWith(`@${DEPARTED_EMAIL_DOMAIN}`);
}

/** The name a masked (minor) tombstone carries. */
export const MASKED_NAME = 'Athlete';

/** Consent versions whose signed statement says results stay under
 *  "Athlete" on withdrawal. Anything else — v2, an unknown or missing
 *  version — keeps the stricter promise and erases. */
export const MASKED_CONSENT_VERSIONS: readonly string[] = ['minors-consent-v3'];

/** Rows other people depend on. Any one non-zero makes an adult a
 *  tombstone. Counted by the engine with head-only queries. */
export interface TiedCounts {
  /** competition_entries where the person is the entrant */
  entries: number;
  /** competition_entry_members (an ad-hoc side's roster) */
  entryMembers: number;
  /** contest_stat_lines (an org's stat line for the person) */
  contestStatLines: number;
  /** sport_event_participants (any role: player, organizer, recorder) */
  eventParticipants: number;
  /** sport_events hosted */
  hostedEvents: number;
  /** group_posts the person created that another participant plays in, or
   *  that an event minted */
  sharedRoundsCreated: number;
  /** group_post_participants on a round someone else created */
  cardsOnOthersRounds: number;
  /** calendar events the person organized FOR an org (events.org_id set) */
  orgCalendarEvents: number;
  /** media on a shared thing: event media, photos on someone else's round,
   *  an org contest photo tag */
  sharedMedia: number;
}

export const NO_TIES: TiedCounts = {
  entries: 0, entryMembers: 0, contestStatLines: 0, eventParticipants: 0,
  hostedEvents: 0, sharedRoundsCreated: 0, cardsOnOthersRounds: 0,
  orgCalendarEvents: 0, sharedMedia: 0,
};

export function hasTies(t: TiedCounts): boolean {
  return Object.values(t).some(n => n > 0);
}

export interface DepartingProfile {
  email: string | null;
  supervision_state: string | null;
}

/**
 * THE decision. `consentVersion` is the latest GRANTED consent record's
 * `policy_version` for a supervised profile (null for an adult).
 */
export function departureMode(
  profile: DepartingProfile,
  tied: TiedCounts,
  consentVersion: string | null
): DepartureMode {
  if (isStubEmail(profile.email)) return 'erase';
  if (!hasTies(tied)) return 'erase';
  if (profile.supervision_state === 'supervised') {
    return consentVersion !== null && MASKED_CONSENT_VERSIONS.includes(consentVersion) ? 'masked' : 'erase';
  }
  return 'tombstone';
}

// ── The strip ────────────────────────────────────────────────────────────────

/** Columns a tombstone KEEPS as they are. `display_name` must stay non-empty
 *  (check_display_name_not_empty); the counters are trigger-maintained and
 *  fall to zero as the follows go. */
export const DEPARTED_KEEP_COLUMNS = [
  'id', 'created_at', 'updated_at', 'user_type', 'supervision_state', 'dob_locked',
  'handle_change_count', 'comment_moderation', 'moderation_state', 'followers_count',
  'following_count', 'search_vector',
  // the name — replaced with MASKED_NAME in 'masked' mode
  'first_name', 'middle_name', 'last_name', 'full_name', 'display_name',
] as const;

/** Columns the strip SETS to a fixed value. */
export const DEPARTED_SET_COLUMNS = [
  'departed_at', 'email', 'visibility', 'messaging_permission', 'recruiting_status',
  'deletion_requested_at',
] as const;

/** Every other personal column — NULLed. The handle is RELEASED (so
 *  `/u/<handle>` 404s by construction and the name can be taken again). */
export const DEPARTED_NULL_COLUMNS = [
  'handle', 'handle_updated_at', 'username', 'nickname', 'phone', 'birthday', 'dob',
  'gender', 'location', 'postal_code', 'bio', 'height_cm', 'weight_kg', 'weight_display',
  'weight_unit', 'class_year', 'social_twitter', 'social_instagram', 'social_facebook',
  'social_tiktok', 'avatar_url', 'cover_url', 'sport', 'school', 'coach', 'graduation_year',
  'gpa', 'sat_score', 'act_score', 'onboarded_at', 'jurisdiction', 'minor_threshold_age',
  'equipment_prefs', 'theme_prefs', 'place_id', 'city', 'region', 'region_code', 'country',
  'country_code', 'lat', 'lng', 'location_source', 'vitals_privacy', 'household_policy',
  'recruiting_profile', 'scout_affiliation', 'moderation_until', 'moderation_ticket_id',
] as const;

export type DepartedPatch = Record<string, string | null>;

/** The UPDATE the engine writes to the profile row. Only for the two
 *  keeping modes — an 'erase' deletes the row instead. */
export function departedProfilePatch(
  profileId: string,
  mode: Exclude<DepartureMode, 'erase'>,
  now: Date
): DepartedPatch {
  const patch: DepartedPatch = {
    departed_at: now.toISOString(),
    email: departedEmailFor(profileId),
    visibility: 'private',
    messaging_permission: 'nobody',
    recruiting_status: 'closed',
    deletion_requested_at: null,
  };
  for (const c of DEPARTED_NULL_COLUMNS) patch[c] = null;
  if (mode === 'masked') {
    patch.first_name = MASKED_NAME;
    patch.middle_name = null;
    patch.last_name = null;
    patch.full_name = MASKED_NAME;
    patch.display_name = MASKED_NAME;
  }
  return patch;
}

// ── The foreign keys onto profiles(id) ───────────────────────────────────────
/**
 * Every `ON DELETE CASCADE` foreign key onto `profiles(id)`, classified for a
 * KEPT row (tombstone or masked), where the cascade no longer fires:
 *   * 'survives' — the row stays and keeps pointing at the tombstone: the
 *                  result, participation, hosted thing or shared media.
 *   * 'goes'     — the engine deletes it explicitly: `mustDelete('<table>',
 *                  '<column>')` must appear in account-deletion.ts.
 *   * 'engine'   — partly kept; the engine carries its own logic, and the
 *                  table's name must appear in account-deletion.ts (the solo
 *                  rounds go, the shared ones stay; calendar events of an org
 *                  stay; the person's own access row stays for the
 *                  zero-access guard).
 * An 'erase' deletes the row, so every cascade fires as it always did.
 */
export const PROFILE_FK_POLICY: Readonly<Record<string, 'survives' | 'goes' | 'engine'>> = {
  // the results and everything they hang off — Tom's rule
  'competition_entries.profile_id': 'survives',
  'competition_entry_members.profile_id': 'survives',
  'contest_stat_lines.profile_id': 'survives',
  'contest_media_tags.profile_id': 'survives',
  'sport_event_participants.profile_id': 'survives',
  'sport_event_stat_lines.profile_id': 'survives',
  'sport_events.host_profile_id': 'survives',
  'sport_event_media.uploaded_by': 'survives',
  'group_post_media.uploaded_by': 'survives',
  // partly kept — the engine decides row by row
  'golf_rounds.profile_id': 'engine',
  'group_posts.creator_id': 'engine',
  'group_post_participants.profile_id': 'engine',
  'profile_access.profile_id': 'engine',
  'profile_access.user_id': 'engine',
  'events.organizer_id': 'engine',
  'event_series.organizer_id': 'engine',
  'posts.profile_id': 'engine', // an event round's / a kept shared round's feed post stays
  // the person's own things — deleted
  'approved_contacts.child_profile_id': 'goes',
  'approved_contacts.contact_profile_id': 'goes',
  'athlete_achievements.profile_id': 'goes',
  'athlete_claim_invites.profile_id': 'goes',
  'athlete_equipment.profile_id': 'goes',
  'athlete_vitals.profile_id': 'goes',
  'calendar_feed_tokens.profile_id': 'goes',
  'comment_likes.profile_id': 'goes',
  'connection_suggestions.profile_id': 'goes',
  'connection_suggestions.suggested_profile_id': 'goes',
  'conversation_participants.profile_id': 'goes',
  'conversations.created_by': 'goes',
  'event_carpool_claims.rider_profile_id': 'goes',
  'event_carpool_offers.driver_profile_id': 'goes',
  'event_guests.profile_id': 'goes',
  'follows.follower_id': 'goes',
  'follows.following_id': 'goes',
  'guardian_invites.profile_id': 'goes',
  'handle_history.profile_id': 'goes',
  'memberships.profile_id': 'goes',
  'message_reactions.profile_id': 'goes',
  'message_reports.reported_profile_id': 'goes',
  'message_reports.reporter_id': 'goes',
  'messages.sender_id': 'goes',
  'notification_preferences.user_id': 'goes',
  'notifications.actor_id': 'goes',
  'notifications.user_id': 'goes',
  'org_join_requests.profile_id': 'goes',
  'org_requests.requester_profile_id': 'goes',
  'performances.profile_id': 'goes',
  'platform_admins.profile_id': 'goes',
  'post_comments.profile_id': 'goes',
  'post_likes.profile_id': 'goes',
  'post_tags.created_by_profile_id': 'goes',
  'post_tags.tagged_profile_id': 'goes',
  'privacy_settings.profile_id': 'goes',
  'profile_transfers.profile_id': 'goes',
  'registrations.profile_id': 'goes',
  'risk_signals.profile_id': 'goes',
  'saved_posts.profile_id': 'goes',
  'scout_shortlists.athlete_id': 'goes',
  'scout_shortlists.scout_id': 'goes',
  'season_highlights.profile_id': 'goes',
  'sport_settings.profile_id': 'goes',
  'sports.profile_id': 'goes',
  'user_blocks.blocked_id': 'goes',
  'user_blocks.blocker_id': 'goes',
  'user_media_presets.profile_id': 'goes',
  'user_mutes.muted_id': 'goes',
  'user_mutes.muter_id': 'goes',
  'workout_exercises.profile_id': 'goes',
  'workout_routine_exercises.profile_id': 'goes',
  'workout_routines.profile_id': 'goes',
  'workout_sessions.profile_id': 'goes',
  'workout_sets.profile_id': 'goes',
};
