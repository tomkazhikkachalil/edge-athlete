// Completed-activity overlay for the calendar (in-app only, by decision):
// finished workouts, golf rounds, and training posts appear on their dates as
// READ-TIME items merged into the range response — never materialized as
// events rows, never in the ICS/subscribe feed. Deletes disappear for free
// because items derive from the source rows on every read.
//
// Builders are pure (unit-tested); fetchActivityOverlay is the one I/O entry,
// three self-scoped indexed queries. Items impersonate EventListItem so the
// grid math (structurally typed on {starts_at, ends_at, all_day, timezone})
// needs no changes; the `kind` discriminant is what stops the client from
// opening EventDetailModal on them (a guaranteed 404).

import type { SupabaseClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = SupabaseClient<any, 'public', any>;

// `post_id` is the feed post this activity was shared as, when there is one.
// The calendar preview renders that post (PostDetailModal = the feed layout);
// a null means the activity was never shared and gets a summary preview.
export type ActivityPayload =
  | { source: 'workout'; session_id: string; duration_seconds: number | null; post_id: string | null }
  | {
      source: 'golf_round';
      round_id: string;
      course: string;
      holes: number;
      gross_score: number | null;
      post_id: string | null;
    }
  | { source: 'training_post'; post_id: string };

export interface ActivityItem {
  id: string;
  organizer_id: string;
  title: string;
  description: string | null;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
  category: string;
  status: 'active';
  cancelled_at: null;
  series_id: null;
  series_override: false;
  my_status: 'accepted'; // never the dashed needs-reply styling
  is_organizer: true;
  kind: 'activity';
  activity: ActivityPayload;
}

const DEFAULT_WORKOUT_SECONDS = 3600;

const baseItem = {
  description: null,
  location: null,
  status: 'active' as const,
  cancelled_at: null,
  series_id: null,
  series_override: false as const,
  my_status: 'accepted' as const,
  is_organizer: true as const,
  kind: 'activity' as const,
};

export interface WorkoutSessionSourceRow {
  id: string;
  title: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds: number | null;
  /** Set when the workout was shared to the feed (045). */
  post_id?: string | null;
}

export function workoutSessionToItem(row: WorkoutSessionSourceRow, userId: string): ActivityItem {
  const startMs = Date.parse(row.started_at);
  const endedMs = row.ended_at ? Date.parse(row.ended_at) : NaN;
  const fallbackMs = startMs + (row.duration_seconds ?? DEFAULT_WORKOUT_SECONDS) * 1000;
  // Clamped strictly after the start so zero-duration rows still render
  const endMs = Math.max(Number.isFinite(endedMs) ? endedMs : fallbackMs, startMs + 60_000);
  return {
    ...baseItem,
    id: `activity:workout:${row.id}`,
    organizer_id: userId,
    title: `✓ ${row.title ?? 'Workout'}`,
    starts_at: new Date(startMs).toISOString(),
    ends_at: new Date(endMs).toISOString(),
    all_day: false,
    // Timed items render viewer-local everywhere; the zone only drives
    // all-day math, which never applies here.
    timezone: 'UTC',
    category: 'workout',
    activity: {
      source: 'workout',
      session_id: row.id,
      duration_seconds: row.duration_seconds,
      post_id: row.post_id ?? null,
    },
  };
}

export interface GolfRoundSourceRow {
  id: string;
  date: string; // YYYY-MM-DD (date-only — golf has no time of day)
  course: string;
  holes: number;
  gross_score: number | null;
  /** Set for rounds mirrored from a group/live round (039). */
  group_post_id?: string | null;
}

/**
 * `postId` is resolved by the caller: solo rounds link through
 * `posts.round_id`, mirrored group rounds through `posts.group_post_id`.
 */
export function golfRoundToItem(
  row: GolfRoundSourceRow,
  userId: string,
  postId: string | null = null
): ActivityItem {
  // All-day with UTC-midnight exclusive-end bounds (the 057 convention)
  const [y, m, d] = row.date.split('-').map(Number);
  const startMs = Date.UTC(y, m - 1, d);
  return {
    ...baseItem,
    id: `activity:golf:${row.id}`,
    organizer_id: userId,
    title: `✓ ${row.course}`,
    starts_at: new Date(startMs).toISOString(),
    ends_at: new Date(startMs + 86_400_000).toISOString(),
    all_day: true,
    timezone: 'UTC',
    category: 'game',
    activity: {
      source: 'golf_round',
      round_id: row.id,
      course: row.course,
      holes: row.holes,
      gross_score: row.gross_score,
      post_id: postId,
    },
  };
}

export interface TrainingPostSourceRow {
  id: string;
  caption: string | null;
  created_at: string;
  stats_data: unknown;
}

/**
 * Workout-share posts are covered by their workout_sessions row (dedupe via
 * stats_data.type) and stat-line posts are deferred (unindexed JSONB date) —
 * both are skipped in v1.
 */
export function shouldSkipTrainingPost(statsData: unknown): boolean {
  if (typeof statsData !== 'object' || statsData === null) return false;
  const type = (statsData as Record<string, unknown>).type;
  return type === 'workout_session' || type === 'stat_line';
}

export function trainingPostToItem(row: TrainingPostSourceRow, userId: string): ActivityItem {
  const startMs = Date.parse(row.created_at);
  const caption = (row.caption ?? '').trim();
  const title = caption.length > 0 ? caption.slice(0, 60) : 'Training session';
  return {
    ...baseItem,
    id: `activity:post:${row.id}`,
    organizer_id: userId,
    title: `✓ ${title}`,
    starts_at: new Date(startMs).toISOString(),
    ends_at: new Date(startMs + 30 * 60_000).toISOString(),
    all_day: false,
    timezone: 'UTC',
    category: 'training',
    activity: { source: 'training_post', post_id: row.id },
  };
}

/** Where an activity item deep-links (its home surface — no detail modal). */
export function activityHref(activity: ActivityPayload): string {
  switch (activity.source) {
    case 'workout':
      return `/app/workout/${activity.session_id}`;
    case 'golf_round':
      return `/app/sport/golf/rounds/${activity.round_id}`;
    case 'training_post':
      return `/feed?post=${activity.post_id}`;
  }
}

/** YYYY-MM-DD (UTC) for date-column range filters. */
function utcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Map round id → the feed post it appears as, in ONE query. Solo rounds are
 * linked by `posts.round_id`; a round mirrored from a group/live round shares
 * the creator's post via `posts.group_post_id` (the viewer is a participant,
 * so that post is the round as the feed shows it). Returns an empty map on
 * failure — a missing post just means the summary preview is used.
 */
async function resolveRoundPostIds(
  admin: Admin,
  rounds: GolfRoundSourceRow[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (rounds.length === 0) return out;
  const roundIds = rounds.map(r => r.id);
  const groupPostIds = [...new Set(rounds.map(r => r.group_post_id).filter(Boolean) as string[])];

  const filters = [`round_id.in.(${roundIds.join(',')})`];
  if (groupPostIds.length > 0) filters.push(`group_post_id.in.(${groupPostIds.join(',')})`);

  const { data, error } = await admin
    .from('posts')
    .select('id, round_id, group_post_id, created_at')
    .eq('status', 'published')
    .or(filters.join(','))
    .order('created_at', { ascending: true });
  if (error || !data) return out;

  const byRound = new Map<string, string>();
  const byGroupPost = new Map<string, string>();
  for (const post of data as { id: string; round_id: string | null; group_post_id: string | null }[]) {
    // First (oldest) wins: a round can be referenced by more than one post.
    if (post.round_id && !byRound.has(post.round_id)) byRound.set(post.round_id, post.id);
    if (post.group_post_id && !byGroupPost.has(post.group_post_id)) {
      byGroupPost.set(post.group_post_id, post.id);
    }
  }
  for (const round of rounds) {
    const direct = byRound.get(round.id);
    const viaGroup = round.group_post_id ? byGroupPost.get(round.group_post_id) : undefined;
    const postId = direct ?? viaGroup;
    if (postId) out.set(round.id, postId);
  }
  return out;
}

/**
 * The caller's completed activities in [from, to) — three self-scoped
 * queries, each on an existing index. Failures degrade to an empty overlay
 * (the calendar's events must never be held hostage by a source table).
 */
export async function fetchActivityOverlay(
  admin: Admin,
  userId: string,
  fromMs: number,
  toMs: number
): Promise<ActivityItem[]> {
  const fromIso = new Date(fromMs).toISOString();
  const toIso = new Date(toMs).toISOString();

  const [workouts, rounds, posts] = await Promise.all([
    admin
      .from('workout_sessions')
      .select('id, title, started_at, ended_at, duration_seconds, post_id')
      .eq('profile_id', userId)
      .eq('status', 'completed')
      .gte('started_at', fromIso)
      .lt('started_at', toIso)
      .then(({ data }) => (data ?? []) as WorkoutSessionSourceRow[]),
    admin
      .from('golf_rounds')
      .select('id, date, course, holes, gross_score, group_post_id')
      .eq('profile_id', userId)
      .gte('date', utcDay(fromMs))
      .lte('date', utcDay(toMs))
      .then(({ data }) => (data ?? []) as GolfRoundSourceRow[]),
    admin
      .from('posts')
      .select('id, caption, created_at, stats_data, status')
      .eq('profile_id', userId)
      .eq('post_category', 'training')
      .gte('created_at', fromIso)
      .lt('created_at', toIso)
      .then(({ data }) => (data ?? []) as (TrainingPostSourceRow & { status: string | null })[]),
  ]);

  // Round → feed post, one batched lookup: solo rounds link through
  // posts.round_id, mirrored group rounds through posts.group_post_id (039).
  const roundPostId = await resolveRoundPostIds(admin, rounds);

  return [
    ...workouts.map(row => workoutSessionToItem(row, userId)),
    ...rounds.map(row => golfRoundToItem(row, userId, roundPostId.get(row.id) ?? null)),
    ...posts
      // Published only — guardian pending_approval/rejected stay off (051)
      .filter(post => post.status === 'published')
      .filter(post => !shouldSkipTrainingPost(post.stats_data))
      .map(row => trainingPostToItem(row, userId)),
  ];
}
