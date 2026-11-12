// ── The account's own data export (Nov 2 2026) — pure, ZERO imports ─────────
// The launch readiness review: deletion existed (`account/delete`, the 30-day
// park), access did not. A person can take a copy of what Edge Athlete holds
// about them — their profile row and every row of theirs in the tables below,
// as one JSON file from Settings → Account, next to Delete. The route reads
// each section with the admin client and ONLY `eq(column, userId)`: nothing
// another person wrote, nothing a tombstone keeps of someone else.
//
// Every section is a `table.column` the departure policy classifies
// (`PROFILE_FK_POLICY` in account-departure.ts) — the test holds that, so a
// renamed table breaks here before it breaks for a person. What stays out on
// purpose: tokens and access rows (`calendar_feed_tokens`, `profile_access`,
// `push_subscriptions`), the safety machinery (`risk_signals`, reports,
// blocks, mutes), other people's rows that merely name this account
// (`notifications.actor_id`, the rivalry display, challenges received).

export const EXPORT_FORMAT = 'edge-athlete-export/1';

/** Rows per section; past it the section is cut and named in `truncated`
 *  (a Vercel response is capped at 4.5 MB — the file must always arrive). */
export const EXPORT_ROW_CAP = 5000;

export interface ExportSection {
  /** The key in the file's `data`. */
  key: string;
  table: string;
  /** The column that names the account. */
  column: string;
}

export const EXPORT_SECTIONS: readonly ExportSection[] = [
  { key: 'posts', table: 'posts', column: 'profile_id' },
  { key: 'comments', table: 'post_comments', column: 'profile_id' },
  { key: 'likes', table: 'post_likes', column: 'profile_id' },
  { key: 'saved_posts', table: 'saved_posts', column: 'profile_id' },
  { key: 'following', table: 'follows', column: 'follower_id' },
  { key: 'followers', table: 'follows', column: 'following_id' },
  { key: 'golf_rounds', table: 'golf_rounds', column: 'profile_id' },
  { key: 'rounds_created', table: 'group_posts', column: 'creator_id' },
  { key: 'round_cards', table: 'group_post_participants', column: 'profile_id' },
  { key: 'activities', table: 'activities', column: 'profile_id' },
  { key: 'workout_sessions', table: 'workout_sessions', column: 'profile_id' },
  { key: 'workout_exercises', table: 'workout_exercises', column: 'profile_id' },
  { key: 'workout_sets', table: 'workout_sets', column: 'profile_id' },
  { key: 'training_pins', table: 'training_pins', column: 'profile_id' },
  { key: 'workout_routines', table: 'workout_routines', column: 'profile_id' },
  { key: 'body_metrics', table: 'athlete_vitals', column: 'profile_id' },
  { key: 'performances', table: 'performances', column: 'profile_id' },
  { key: 'achievements', table: 'athlete_achievements', column: 'profile_id' },
  { key: 'equipment', table: 'athlete_equipment', column: 'profile_id' },
  { key: 'sports', table: 'sports', column: 'profile_id' },
  { key: 'sport_settings', table: 'sport_settings', column: 'profile_id' },
  { key: 'messages_sent', table: 'messages', column: 'sender_id' },
  { key: 'event_participations', table: 'sport_event_participants', column: 'profile_id' },
  { key: 'competition_entries', table: 'competition_entries', column: 'profile_id' },
  { key: 'contest_stat_lines', table: 'contest_stat_lines', column: 'profile_id' },
  { key: 'memberships', table: 'memberships', column: 'profile_id' },
  { key: 'registrations', table: 'registrations', column: 'profile_id' },
  { key: 'calendar_events', table: 'events', column: 'organizer_id' },
  { key: 'notification_preferences', table: 'notification_preferences', column: 'user_id' },
  { key: 'privacy_settings', table: 'privacy_settings', column: 'profile_id' },
];

export type ExportRow = Record<string, unknown>;

export interface ExportBundle {
  format: typeof EXPORT_FORMAT;
  exported_at: string;
  account: { id: string; email: string | null };
  profile: ExportRow | null;
  /** Section key → rows; a section the database does not have is `null`. */
  data: Record<string, ExportRow[] | null>;
  /** Sections cut at EXPORT_ROW_CAP. */
  truncated: string[];
}

/** The file's name: the date, never the account (a shared Downloads folder). */
export function exportFilename(now: Date): string {
  return `edge-athlete-export-${now.toISOString().slice(0, 10)}.json`;
}

/**
 * Assemble the file from what the route read. `sections` holds up to
 * EXPORT_ROW_CAP + 1 rows per key — the extra row is how a cut is seen; the
 * file carries exactly the cap and names the section.
 */
export function buildExportBundle(
  meta: { userId: string; email: string | null; profile: ExportRow | null; now: Date },
  sections: Record<string, ExportRow[] | null>,
): ExportBundle {
  const data: Record<string, ExportRow[] | null> = {};
  const truncated: string[] = [];
  for (const section of EXPORT_SECTIONS) {
    const rows = sections[section.key];
    if (rows == null) { data[section.key] = null; continue; }
    if (rows.length > EXPORT_ROW_CAP) {
      truncated.push(section.key);
      data[section.key] = rows.slice(0, EXPORT_ROW_CAP);
    } else {
      data[section.key] = rows;
    }
  }
  return {
    format: EXPORT_FORMAT,
    exported_at: meta.now.toISOString(),
    account: { id: meta.userId, email: meta.email },
    profile: meta.profile,
    data,
    truncated,
  };
}
