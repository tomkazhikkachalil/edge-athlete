// Unified guardian action queue — pure shaping, node-testable (Wave 2).
// The route (/api/guardian/queue) runs one roster query plus batched IN-queries
// (constant query count regardless of roster size, the athletes-route doctrine)
// and reduces them here into one typed, ordered item list the console hub
// renders as its centerpiece. This module supersedes the hub's old
// buildAttentionItems: same gap/transfer rules, but items carry enough data
// for inline action instead of a bare label + link.

import { stateFromAction, type ConsentState } from './consent';
import { formatDisplayName } from './formatters';
import { agePresetChanges, type HouseholdPolicy } from './household-policy';

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
    }
  | {
      /** A sent-back item (status = changes_requested, mig 129): the ball is
       *  in the CHILD's court — non-actionable, gray, sorted last, shown so
       *  the parent never wonders where the post went. */
      kind: 'waiting_on_child';
      id: string;
      athlete: QueueAthlete;
      createdAt: string;
      contentKind: 'post' | 'comment';
    }
  | {
      /** First-contact hold (mig 131): someone new wants to message the
       *  child. Inline Approve/Deny via the contacts POST; `requester.id`
       *  is the contactProfileId the decision takes. */
      kind: 'contact_request';
      id: string;
      athlete: QueueAthlete;
      /** The child's held_at — drives the aging badge. */
      createdAt: string;
      requester: QueuePerson;
      conversationId: string;
    }
  | {
      /** Age-preset prompt (Wave 4, mig 133): the child crossed the legal
       *  threshold and the CALLER's older overrides would change something.
       *  `id` is the eligible_notified transfer row; Apply/Keep POST to the
       *  age-preset decision route. */
      kind: 'age_preset_prompt';
      id: string;
      athlete: QueueAthlete;
      createdAt: string;
      changes: Array<{ field: string; from: string; to: string }>;
    }
  | {
      /** Risk signal (Wave 7, mig 137): a heuristic, metadata-only "worth a
       *  look" row. Non-accusatory by contract — the hub renders it with
       *  signalCopy()'s calm phrasing and a single Got-it acknowledge via
       *  PATCH /api/guardian/risk-signals/<id>. */
      kind: 'risk_signal';
      id: string;
      athlete: QueueAthlete;
      createdAt: string;
      signalKind: 'new_contact_burst' | 'message_volume_spike' | 'report_filed' | 'late_night_activity';
    }
  | {
      /** Pending event invite for a child — inline respond-as-child via
       *  POST /api/calendar/events/<event.id>/respond. `id` is the guest
       *  row (unique per child+event). */
      kind: 'calendar_invite';
      id: string;
      athlete: QueueAthlete;
      createdAt: string;
      event: {
        id: string;
        title: string;
        starts_at: string;
        ends_at: string;
        all_day: boolean;
        timezone: string;
      };
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
  /** Wave 4 (age-preset prompts) — present when the route selects them. */
  visibility?: string | null;
  messaging_permission?: string | null;
  comment_moderation?: string | null;
  dob?: string | null;
  jurisdiction?: string | null;
}

export interface QueuePostRow {
  id: string;
  profile_id: string;
  caption: string | null;
  created_at: string;
  status: string;
  mediaCount: number;
  thumbnailUrl: string | null;
}

export interface QueueCommentRow {
  id: string;
  profile_id: string;
  content: string | null;
  created_at: string;
  status: string;
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

// ── First-contact holds (Wave 3, mig 131) ────────────────────────────────────

export interface RawHeldRow {
  conversation_id: string;
  profile_id: string;
  held_at: string;
  conversations:
    | { type: string }
    | Array<{ type: string }>
    | null;
}

export interface RawCounterpartRow {
  conversation_id: string;
  profile_id: string;
  profiles:
    | { id: string; first_name: string | null; last_name: string | null; full_name: string | null; handle: string | null; avatar_url: string | null }
    | Array<{ id: string; first_name: string | null; last_name: string | null; full_name: string | null; handle: string | null; avatar_url: string | null }>
    | null;
}

export interface QueueHeldContactRow {
  childProfileId: string;
  heldAt: string;
  conversationId: string;
  requester: QueuePerson;
}

/** Join the held child rows to their conversation counterparts — pure,
 *  embed-guarded; non-direct conversations and orphan rows drop. */
export function buildHeldContactRows(
  heldRows: RawHeldRow[],
  counterpartRows: RawCounterpartRow[]
): QueueHeldContactRow[] {
  const counterpartByConv = new Map<string, RawCounterpartRow>();
  for (const row of counterpartRows) counterpartByConv.set(row.conversation_id, row);
  const out: QueueHeldContactRow[] = [];
  for (const held of heldRows) {
    const conv = unwrapEmbed(held.conversations);
    if (conv?.type !== 'direct') continue;
    const counterpart = counterpartByConv.get(held.conversation_id);
    const profile = counterpart ? unwrapEmbed(counterpart.profiles) : null;
    if (!counterpart || !profile) continue;
    out.push({
      childProfileId: held.profile_id,
      heldAt: held.held_at,
      conversationId: held.conversation_id,
      requester: {
        id: profile.id,
        name: formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name),
        handle: profile.handle,
        avatarUrl: profile.avatar_url,
      },
    });
  }
  return out;
}

// ── Calendar invites (Wave 2 PR 4) ───────────────────────────────────────────

interface InviteEventEmbed {
  id: string;
  title: string;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  timezone: string;
  status: string;
}

export interface RawInviteRow {
  id: string;
  profile_id: string;
  created_at: string;
  events: InviteEventEmbed | InviteEventEmbed[] | null;
}

export interface QueueInviteRow {
  id: string;
  profile_id: string;
  created_at: string;
  event: Omit<InviteEventEmbed, 'status'>;
}

/** Unwrap the events!inner embed (object OR array) and keep only invites a
 *  guardian can still act on: event active and not already over. */
export function flattenInviteRows(rows: RawInviteRow[], nowMs: number): QueueInviteRow[] {
  const out: QueueInviteRow[] = [];
  for (const row of rows) {
    const event = unwrapEmbed(row.events);
    if (!event) continue;
    if (event.status === 'cancelled') continue;
    if (Date.parse(event.ends_at) <= nowMs) continue;
    out.push({
      id: row.id,
      profile_id: row.profile_id,
      created_at: row.created_at,
      event: {
        id: event.id,
        title: event.title,
        starts_at: event.starts_at,
        ends_at: event.ends_at,
        all_day: event.all_day,
        timezone: event.timezone,
      },
    });
  }
  return out;
}

/** Unacknowledged risk_signals rows as the route selects them (Wave 7). */
export interface QueueRiskRow {
  id: string;
  profile_id: string;
  kind: 'new_contact_burst' | 'message_volume_spike' | 'report_filed' | 'late_night_activity';
  created_at: string;
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
  transferRows: Array<{
    profile_id: string;
    state: string;
    /** Wave 4: eligible_notified rows carry the age-preset rider. */
    id?: string;
    created_at?: string;
    age_preset_prompt?: string | null;
  }>,
  invites: QueueInviteRow[] = [],
  heldContacts: QueueHeldContactRow[] = [],
  policy: HouseholdPolicy | null = null,
  riskRows: QueueRiskRow[] = []
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
  // Sent-back items (changes_requested, mig 129) are the CHILD's to act on —
  // they render as muted informational rows after everything actionable.
  const waiting: QueueItem[] = [];
  for (const post of posts) {
    const athlete = athletesById.get(post.profile_id);
    if (!athlete) continue;
    if (post.status === 'changes_requested') {
      waiting.push({
        kind: 'waiting_on_child',
        id: post.id,
        athlete: toQueueAthlete(athlete),
        createdAt: post.created_at,
        contentKind: 'post',
      });
      continue;
    }
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
    if (comment.status === 'changes_requested') {
      waiting.push({
        kind: 'waiting_on_child',
        id: comment.id,
        athlete: toQueueAthlete(athlete),
        createdAt: comment.created_at,
        contentKind: 'comment',
      });
      continue;
    }
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

  const contactItems: QueueItem[] = [];
  for (const row of heldContacts) {
    const athlete = athletesById.get(row.childProfileId);
    if (!athlete) continue;
    contactItems.push({
      kind: 'contact_request',
      id: `contact-${row.childProfileId}-${row.requester.id}`,
      athlete: toQueueAthlete(athlete),
      createdAt: row.heldAt,
      requester: row.requester,
      conversationId: row.conversationId,
    });
  }
  contactItems.sort((a, b) =>
    ('createdAt' in a ? a.createdAt : '').localeCompare('createdAt' in b ? b.createdAt : '')
  );

  // Risk signals (Wave 7): safety-adjacent, so they sit right after the
  // contact requests — but they are observations, not requests, and the
  // only action is acknowledging.
  const riskItems: QueueItem[] = [];
  for (const row of riskRows) {
    const athlete = athletesById.get(row.profile_id);
    if (!athlete) continue;
    riskItems.push({
      kind: 'risk_signal',
      id: row.id,
      athlete: toQueueAthlete(athlete),
      createdAt: row.created_at,
      signalKind: row.kind,
    });
  }
  riskItems.sort((a, b) =>
    ('createdAt' in a ? a.createdAt : '').localeCompare('createdAt' in b ? b.createdAt : '')
  );

  // Age-preset prompts (Wave 4): derived from the eligible_notified row's
  // rider, but only when the CALLER's own older overrides would actually
  // change something — a co-guardian without a differing preset sees nothing.
  const ageItems: QueueItem[] = [];
  for (const row of transferRows) {
    if (row.state !== 'eligible_notified' || row.age_preset_prompt !== 'pending' || !row.id) continue;
    const athlete = athletesById.get(row.profile_id);
    if (!athlete) continue;
    const changes = agePresetChanges(
      {
        visibility: athlete.visibility ?? null,
        messaging_permission: athlete.messaging_permission ?? null,
        comment_moderation: athlete.comment_moderation ?? null,
      },
      policy
    );
    if (changes.length === 0) continue;
    ageItems.push({
      kind: 'age_preset_prompt',
      id: row.id,
      athlete: toQueueAthlete(athlete),
      createdAt: row.created_at ?? '',
      changes,
    });
  }
  ageItems.sort((a, b) =>
    ('createdAt' in a ? a.createdAt : '').localeCompare('createdAt' in b ? b.createdAt : '')
  );

  const inviteItems: QueueItem[] = [];
  for (const row of invites) {
    const athlete = athletesById.get(row.profile_id);
    if (!athlete) continue;
    inviteItems.push({
      kind: 'calendar_invite',
      id: row.id,
      athlete: toQueueAthlete(athlete),
      createdAt: row.created_at,
      event: row.event,
    });
  }
  inviteItems.sort((a, b) =>
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

  waiting.sort((a, b) =>
    ('createdAt' in a ? a.createdAt : '').localeCompare('createdAt' in b ? b.createdAt : '')
  );
  return [...content, ...followItems, ...contactItems, ...riskItems, ...ageItems, ...inviteItems, ...tail, ...waiting];
}
