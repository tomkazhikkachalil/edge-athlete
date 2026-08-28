// Unified guardian action queue — pure shaping, node-testable (Wave 2).
// The route (/api/guardian/queue) runs one roster query plus batched IN-queries
// (constant query count regardless of roster size, the athletes-route doctrine)
// and reduces them here into one typed, ordered item list the console hub
// renders as its centerpiece. This module supersedes the hub's old
// buildAttentionItems: same gap/transfer rules, but items carry enough data
// for inline action instead of a bare label + link.

import { stateFromAction, type ConsentState } from './consent';
import { formatDisplayName } from './formatters';

/** Queue items older than this get the amber "waiting N days" badge, and the
 *  48h cron nudge (PR 3) re-bells guardians past the same threshold — one
 *  constant so the badge and the nudge can never disagree. */
export const AGING_BADGE_MS = 48 * 3_600_000;

/** Transfer states where the ball is in the guardian's court — mirrors the
 *  amber tone in transferStateChip (transfer-ui.ts). */
export const TRANSFER_NEEDS_GUARDIAN = new Set(['requested', 'dual_confirm']);

export interface QueueAthlete {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
}

export interface QueuePerson {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
}

export type QueueItem =
  | {
      kind: 'approve_post';
      id: string;
      athlete: QueueAthlete;
      createdAt: string;
      caption: string | null;
      mediaCount: number;
      /** First media thumbnail, already proxied by the route. */
      thumbnailUrl: string | null;
      /** Approving will 403 until the athlete's consent review completes. */
      consentBlocked: boolean;
      href: string;
    }
  | {
      kind: 'release_comment';
      id: string;
      athlete: QueueAthlete;
      createdAt: string;
      excerpt: string | null;
      consentBlocked: boolean;
      href: string;
    }
  | {
      kind: 'follow_request';
      id: string;
      athlete: QueueAthlete;
      createdAt: string;
      follower: QueuePerson;
      message: string | null;
    }
  | {
      kind: 'transfer_step';
      id: string;
      athlete: QueueAthlete;
      state: string;
      href: string;
    }
  | {
      kind: 'consent_gap';
      id: string;
      athlete: QueueAthlete;
      consentState: Extract<ConsentState, 'none' | 'rejected'>;
      href: string;
    }
  | {
      kind: 'credentials_gap';
      id: string;
      athlete: QueueAthlete;
      href: string;
    };

// ── Route row shapes ─────────────────────────────────────────────────────────
// Raw-ish rows as the batched queries return them. Supabase embeds can come
// back object OR single-element array; the shaper guards both.

export interface RosterRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  handle: string | null;
  avatar_url: string | null;
  supervision_state: string | null;
}

export interface QueuePostRow {
  id: string;
  profile_id: string;
  caption: string | null;
  created_at: string;
  mediaCount: number;
  thumbnailUrl: string | null;
}

export interface QueueCommentRow {
  id: string;
  profile_id: string;
  content: string | null;
  created_at: string;
}

export interface QueueFollowRow {
  id: string;
  following_id: string;
  message: string | null;
  created_at: string;
  follower:
    | { id: string; first_name: string | null; last_name: string | null; full_name: string | null; handle: string | null; avatar_url: string | null }
    | Array<{ id: string; first_name: string | null; last_name: string | null; full_name: string | null; handle: string | null; avatar_url: string | null }>
    | null;
}

function unwrapEmbed<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function toQueueAthlete(row: RosterRow): QueueAthlete {
  return {
    id: row.id,
    name: formatDisplayName(row.first_name, null, row.last_name, row.full_name),
    handle: row.handle,
    avatarUrl: row.avatar_url,
  };
}

/**
 * Reduce the batched query results into the ordered queue.
 *
 * `consentRows` MUST arrive ordered created_at DESC (append-only table, first
 * row per profile wins — same contract as buildAthleteSummaries).
 *
 * Ordering: content items (posts + comments interleaved) oldest first, then
 * follow requests oldest first, then transfer steps, consent gaps and
 * credentials gaps in roster order. Content ages; setup gaps don't.
 */
export function buildQueueItems(
  roster: RosterRow[],
  posts: QueuePostRow[],
  comments: QueueCommentRow[],
  follows: QueueFollowRow[],
  consentRows: Array<{ profile_id: string; action: string }>,
  supervisedRows: Array<{ user_id: string; profile_id: string }>,
  transferRows: Array<{ profile_id: string; state: string }>
): QueueItem[] {
  const athletesById = new Map<string, RosterRow>();
  for (const row of roster) athletesById.set(row.id, row);

  const consentState = new Map<string, ConsentState>();
  for (const row of consentRows) {
    if (!athletesById.has(row.profile_id) || consentState.has(row.profile_id)) continue;
    consentState.set(row.profile_id, stateFromAction(row.action));
  }
  const stateOf = (profileId: string): ConsentState => consentState.get(profileId) ?? 'none';

  const hasLogin = new Set<string>();
  for (const row of supervisedRows) {
    // Only a SELF row means the child has credentials (rollup rule).
    if (row.user_id === row.profile_id) hasLogin.add(row.profile_id);
  }

  const content: QueueItem[] = [];
  for (const post of posts) {
    const athlete = athletesById.get(post.profile_id);
    if (!athlete) continue;
    content.push({
      kind: 'approve_post',
      id: post.id,
      athlete: toQueueAthlete(athlete),
      createdAt: post.created_at,
      caption: post.caption,
      mediaCount: post.mediaCount,
      thumbnailUrl: post.thumbnailUrl,
      consentBlocked: stateOf(post.profile_id) !== 'approved',
      href: `/app/guardian/approvals?athlete=${post.profile_id}`,
    });
  }
  for (const comment of comments) {
    const athlete = athletesById.get(comment.profile_id);
    if (!athlete) continue;
    content.push({
      kind: 'release_comment',
      id: comment.id,
      athlete: toQueueAthlete(athlete),
      createdAt: comment.created_at,
      excerpt: comment.content,
      consentBlocked: stateOf(comment.profile_id) !== 'approved',
      href: `/app/guardian/approvals?athlete=${comment.profile_id}`,
    });
  }
  content.sort((a, b) => {
    const aAt = 'createdAt' in a ? a.createdAt : '';
    const bAt = 'createdAt' in b ? b.createdAt : '';
    return aAt.localeCompare(bAt);
  });

  const followItems: QueueItem[] = [];
  for (const row of follows) {
    const athlete = athletesById.get(row.following_id);
    const follower = unwrapEmbed(row.follower);
    if (!athlete || !follower) continue;
    followItems.push({
      kind: 'follow_request',
      id: row.id,
      athlete: toQueueAthlete(athlete),
      createdAt: row.created_at,
      follower: {
        id: follower.id,
        name: formatDisplayName(follower.first_name, null, follower.last_name, follower.full_name),
        handle: follower.handle,
        avatarUrl: follower.avatar_url,
      },
      message: row.message,
    });
  }
  followItems.sort((a, b) =>
    ('createdAt' in a ? a.createdAt : '').localeCompare('createdAt' in b ? b.createdAt : '')
  );

  const tail: QueueItem[] = [];
  for (const row of transferRows) {
    const athlete = athletesById.get(row.profile_id);
    if (!athlete || !TRANSFER_NEEDS_GUARDIAN.has(row.state)) continue;
    tail.push({
      kind: 'transfer_step',
      id: `transfer-${row.profile_id}`,
      athlete: toQueueAthlete(athlete),
      state: row.state,
      href: `/app/transfer/${row.profile_id}`,
    });
  }
  for (const row of roster) {
    if (row.supervision_state !== 'supervised') continue;
    const state = stateOf(row.id);
    if (state === 'none' || state === 'rejected') {
      tail.push({
        kind: 'consent_gap',
        id: `consent-${row.id}`,
        athlete: toQueueAthlete(row),
        consentState: state,
        href: `/app/guardian/consent/${row.id}`,
      });
    }
  }
  for (const row of roster) {
    if (row.supervision_state !== 'supervised' || hasLogin.has(row.id)) continue;
    tail.push({
      kind: 'credentials_gap',
      id: `login-${row.id}`,
      athlete: toQueueAthlete(row),
      href: `/app/guardian/credentials/${row.id}`,
    });
  }

  return [...content, ...followItems, ...tail];
}
