/**
 * Support & Reporting — the ticket vocabulary (Spec 1, migration 222).
 *
 * ONE source for every union the schema pins with a CHECK: the zod schemas,
 * the routes, the queue and the forms read these arrays; the migration's
 * CHECKs repeat them (a value added here without a migration answers 23514
 * at the insert — never silently). Pure data, client-safe: no imports.
 *
 * Tom's Game Plan (Sep 17 2026): ONE ticket table for help requests, reports
 * and suggestions — type is a field, not a separate system. The reason lists
 * are fixed per type (one report list reused on every surface).
 */

export const TICKET_TYPES = ['help', 'report', 'suggestion'] as const;
export type TicketType = (typeof TICKET_TYPES)[number];

/** A report's subtype — where it was filed from. Every other type carries none. */
export const TICKET_SUBTYPES = ['post', 'comment', 'profile', 'dm', 'incident'] as const;
export type TicketSubtype = (typeof TICKET_SUBTYPES)[number];

export const TICKET_SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export type TicketSeverity = (typeof TICKET_SEVERITIES)[number];

export const TICKET_STATUSES = ['new', 'in_review', 'waiting_on_user', 'resolved', 'closed'] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];

/** The reported thing. `conversation` = a DM thread; `message` = one DM. */
export const TICKET_TARGET_TYPES = ['post', 'comment', 'profile', 'conversation', 'message'] as const;
export type TicketTargetType = (typeof TICKET_TARGET_TYPES)[number];

export const RESOLUTION_CODES = [
  'no_action',
  'content_removed',
  'warning',
  'suspension',
  'ban',
  'feature_shipped',
  'declined',
] as const;
export type ResolutionCode = (typeof RESOLUTION_CODES)[number];

/** The codes that COUNT as a strike against the reported user (derived — never a table). */
export const STRIKE_CODES: readonly ResolutionCode[] = ['warning', 'suspension', 'ban'];

export const SUGGESTION_TAGS = ['planned', 'maybe', 'declined'] as const;
export type SuggestionTag = (typeof SUGGESTION_TAGS)[number];

export const TICKET_EVENT_KINDS = [
  'created',
  'status_changed',
  'severity_changed',
  'assigned',
  'note',
  'reply_to_user',
  'user_reply',
  'merged',
  'action_taken',
  'email_sent',
  'reopened',
  'anonymized',
] as const;
export type TicketEventKind = (typeof TICKET_EVENT_KINDS)[number];

export const PLATFORM_ROLES = ['owner', 'moderator'] as const;
export type PlatformRole = (typeof PLATFORM_ROLES)[number];

// ── The reason lists (the doc's fixed lists, one per type) ──────────────────

export const REPORT_REASONS = [
  'harassment_bullying',
  'hate_discrimination',
  'sexual_content',
  'spam_scam',
  'impersonation',
  'self_harm',
  'minor_safety',
  'other',
] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

export const HELP_CATEGORIES = [
  'account',
  'posting_media',
  'events',
  'organizations',
  'privacy_reporting',
  'other',
] as const;
export type HelpCategory = (typeof HELP_CATEGORIES)[number];

export const SUGGESTION_AREAS = ['feed', 'events', 'profiles', 'media', 'stats', 'other'] as const;
export type SuggestionArea = (typeof SUGGESTION_AREAS)[number];

/** The reasons a ticket of each type may carry — what the zod schema and the forms read. */
export const REASONS_BY_TYPE: Record<TicketType, readonly string[]> = {
  help: HELP_CATEGORIES,
  report: REPORT_REASONS,
  suggestion: SUGGESTION_AREAS,
};

export function isReasonForType(type: TicketType, reason: string): boolean {
  return REASONS_BY_TYPE[type].includes(reason);
}

// ── Labels (the words the user sees; the keys are what the database stores) ─

export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  harassment_bullying: 'Harassment or bullying',
  hate_discrimination: 'Hate or discrimination',
  sexual_content: 'Sexual content',
  spam_scam: 'Spam or scam',
  impersonation: 'Impersonation',
  self_harm: 'Self-harm concern',
  minor_safety: 'Safety of a minor',
  other: 'Something else',
};

export const HELP_CATEGORY_LABELS: Record<HelpCategory, string> = {
  account: 'My account',
  posting_media: 'Posting and media',
  events: 'Events and tournaments',
  organizations: 'Clubs and leagues',
  privacy_reporting: 'Privacy and reporting',
  other: 'Something else',
};

export const SUGGESTION_AREA_LABELS: Record<SuggestionArea, string> = {
  feed: 'Feed',
  events: 'Events',
  profiles: 'Profiles',
  media: 'Media',
  stats: 'Stats',
  other: 'Other',
};

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  new: 'New',
  in_review: 'In review',
  waiting_on_user: 'Waiting on you',
  resolved: 'Resolved',
  closed: 'Closed',
};

export const TICKET_SEVERITY_LABELS: Record<TicketSeverity, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

export const RESOLUTION_CODE_LABELS: Record<ResolutionCode, string> = {
  no_action: 'No action needed',
  content_removed: 'Content removed',
  warning: 'Warning issued',
  suspension: 'Account suspended',
  ban: 'Account banned',
  feature_shipped: 'Feature shipped',
  declined: 'Declined',
};

/** The label for a ticket's reason, whichever list it came from. */
export function reasonLabel(type: TicketType, reason: string): string {
  const table: Record<string, string> =
    type === 'report' ? REPORT_REASON_LABELS : type === 'help' ? HELP_CATEGORY_LABELS : SUGGESTION_AREA_LABELS;
  return table[reason] ?? reason;
}

// ── Row shapes (what the service role reads; projections narrow them) ───────

export interface TicketRow {
  id: string;
  number: number;
  type: TicketType;
  subtype: TicketSubtype | null;
  reason: string;
  severity: TicketSeverity;
  status: TicketStatus;
  subject: string | null;
  description: string | null;
  reporter_profile_id: string | null;
  reporter_email: string | null;
  guest_email: string | null;
  target_type: TicketTargetType | null;
  target_id: string | null;
  target_profile_id: string | null;
  content_snapshot: Record<string, unknown> | null;
  attachment_url: string | null;
  report_count: number;
  merged_into_id: string | null;
  assignee_profile_id: string | null;
  resolution_code: ResolutionCode | null;
  resolution_note: string | null;
  suggestion_tag: SuggestionTag | null;
  contact_ok: boolean;
  appeal_used_at: string | null;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
  anonymized_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TicketEventRow {
  id: string;
  ticket_id: string;
  actor_profile_id: string | null;
  kind: TicketEventKind;
  old_value: string | null;
  new_value: string | null;
  body: string | null;
  visible_to_user: boolean;
  created_at: string;
}

/** An event the app is about to insert (the id and created_at come from the database). */
export type TicketEventInput = Omit<TicketEventRow, 'id' | 'created_at'>;

/** Text limits shared by the forms and the zod schemas. */
export const TICKET_LIMITS = {
  subject: 140,
  description: 4000,
  reply: 4000,
  note: 4000,
  resolutionNote: 2000,
} as const;
