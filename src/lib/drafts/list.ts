// ── Drafts (Drafts round, Oct 2026): the one list of what is not posted yet ──
// Finish and Post are two actions. Everything a person has started or finished
// but not posted lives in ONE private list: rounds IN PROGRESS (being played —
// Resume / Finish / Discard), DRAFTS (finished, reviewed, not yet posted —
// Review / Post / Delete), workouts in progress (Resume), and a live activity
// recording waiting on THIS phone (Resume). Pure: the server reader hands rows
// in, the page and the reopen prompt read the result. Zero imports.

export type DraftKind = 'round' | 'workout' | 'recording';

export interface DraftItem {
  kind: DraftKind;
  /** The thing's own id: group_posts.id, workout_sessions.id, the recording id. */
  id: string;
  /** The round's feed post (a draft) — rounds only. */
  postId: string | null;
  /** 'in_progress' (Resume) or 'draft' (Review / Post). */
  state: 'in_progress' | 'draft';
  title: string;
  /** ISO — when it started (a round: its date; a workout: started_at). */
  startedAt: string | null;
  /** ISO — the last thing that happened to it (a score, a set, a save). */
  lastActivityAt: string | null;
  /** Where to continue or review it. */
  href: string;
  /** Rounds: the viewer created it (Finish / Discard / Post are theirs). */
  isCreator: boolean;
  /** Rounds: someone has scored ('active') — Finish has something to record.
   *  A scoreless ('pending') round offers Discard only. */
  scored: boolean;
}

export interface DraftRoundRow {
  id: string;
  status: string | null;
  date: string | null;
  post_id: string | null;
  course_name: string | null;
  title: string | null;
  /** The round's creator is the viewer. */
  isCreator: boolean;
  /** Newest score write across the round (ISO) — null when nobody has scored. */
  lastScoreAt: string | null;
  /** The round's post is still a draft (false once posted, or when there is no post). */
  postIsDraft: boolean;
  /** An event's round (203) — organizer-run, never listed here. */
  sportEventRoundId: string | null;
}

export interface DraftWorkoutRow {
  id: string;
  status: string | null;
  title: string | null;
  started_at: string | null;
  last_activity_at: string | null;
  ended_at?: string | null;
  post_id?: string | null;
  /** 253: when the owner chose Share or Keep private. NULL on a completed session = a draft. */
  share_decided_at?: string | null;
}

/** Sessions finished before the Drafts round never had a share decision
 *  recorded (253 added the column, Oct 6 2026) — they are history, not
 *  drafts. Only what finishes from here on can be a draft. */
export const WORKOUT_DRAFTS_SINCE = '2026-10-06T00:00:00Z';

/** A finished workout whose owner never chose Share or Keep private. */
export function isWorkoutDraft(w: DraftWorkoutRow): boolean {
  if (w.status !== 'completed' || w.post_id || w.share_decided_at) return false;
  const ended = ts(w.ended_at ?? w.last_activity_at ?? null);
  return ended >= Date.parse(WORKOUT_DRAFTS_SINCE);
}

export interface DraftRecordingLike {
  id: string;
  /** The catalog label, already resolved ("Walk", "Run"). */
  label: string;
  savedAt: number;
}

export interface DraftsList {
  inProgress: DraftItem[];
  drafts: DraftItem[];
}

export const ROUND_IN_PROGRESS = new Set(['pending', 'active']);

const ts = (iso: string | null): number => {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
};

/** Newest activity first; a thing nobody touched sorts by when it started. */
const newestFirst = (a: DraftItem, b: DraftItem): number =>
  (ts(b.lastActivityAt) || ts(b.startedAt)) - (ts(a.lastActivityAt) || ts(a.startedAt));

export function roundTitle(r: { course_name: string | null; title: string | null }): string {
  return r.course_name?.trim() || r.title?.trim() || 'Golf round';
}

/** The review screen for a draft post. ONE spelling (round-route.ts re-exports it for the composer). */
export function draftReviewHref(postId: string): string {
  return `/athlete/drafts/${postId}`;
}

export function buildDraftsList(input: {
  rounds: DraftRoundRow[];
  workouts: DraftWorkoutRow[];
  recording?: DraftRecordingLike | null;
}): DraftsList {
  const inProgress: DraftItem[] = [];
  const drafts: DraftItem[] = [];

  for (const r of input.rounds) {
    if (r.sportEventRoundId) continue;
    const base = {
      kind: 'round' as const,
      id: r.id,
      postId: r.post_id,
      title: roundTitle(r),
      startedAt: r.date,
      lastActivityAt: r.lastScoreAt,
      isCreator: r.isCreator,
      scored: r.status === 'active' || r.status === 'completed',
    };
    if (ROUND_IN_PROGRESS.has(r.status ?? '')) {
      inProgress.push({ ...base, state: 'in_progress', href: `/live/${r.id}` });
    } else if (r.status === 'completed' && r.isCreator && r.post_id && r.postIsDraft) {
      // Only the creator holds the draft: the round has ONE post, theirs.
      drafts.push({ ...base, state: 'draft', href: draftReviewHref(r.post_id) });
    }
  }

  for (const w of input.workouts) {
    const base = {
      kind: 'workout' as const,
      id: w.id,
      postId: null,
      title: w.title?.trim() || 'Workout',
      startedAt: w.started_at,
      lastActivityAt: w.ended_at ?? w.last_activity_at,
      isCreator: true,
      scored: true,
    };
    if (w.status === 'active') {
      inProgress.push({ ...base, state: 'in_progress', href: `/app/workout/${w.id}` });
    } else if (isWorkoutDraft(w)) {
      // The share step of the finished workout: Share or Keep private.
      drafts.push({ ...base, state: 'draft', href: `/app/workout/${w.id}?share=1` });
    }
  }

  if (input.recording) {
    const iso = new Date(input.recording.savedAt).toISOString();
    inProgress.push({
      kind: 'recording',
      id: input.recording.id,
      postId: null,
      state: 'in_progress',
      title: `${input.recording.label} (on this phone)`,
      startedAt: iso,
      lastActivityAt: iso,
      href: '/activities/record',
      isCreator: true,
      scored: true,
    });
  }

  inProgress.sort(newestFirst);
  drafts.sort(newestFirst);
  return { inProgress, drafts };
}

/** The ONE thing the reopen prompt asks about: the most recently touched in-progress item. */
export function pickReopenCandidate(list: DraftsList): DraftItem | null {
  return list.inProgress[0] ?? null;
}

export function draftsCount(list: DraftsList): number {
  return list.inProgress.length + list.drafts.length;
}
