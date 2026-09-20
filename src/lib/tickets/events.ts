/**
 * The history an admin change writes (Spec 1) — pure.
 *
 * `ticket_events` is append-only: every change is a row, never an edit. A
 * PATCH computes its rows here and inserts them beside the update; this
 * module never touches the database. `visible_to_user` decides what My
 * requests shows: status changes and replies yes; severity, assignment,
 * tags and internal notes never.
 */
import type { ResolutionCode, SuggestionTag, TicketEventInput, TicketSeverity, TicketStatus } from './types';

export interface AdminPatch {
  status?: TicketStatus;
  severity?: TicketSeverity;
  assignee_profile_id?: string | null;
  resolution_code?: ResolutionCode | null;
  resolution_note?: string | null;
  suggestion_tag?: SuggestionTag | null;
}

export interface TicketStateForEvents {
  id: string;
  status: TicketStatus;
  severity: TicketSeverity;
  assignee_profile_id: string | null;
  suggestion_tag: SuggestionTag | null;
  first_response_at: string | null;
  resolved_at: string | null;
  closed_at: string | null;
}

export interface ChangeOutcome {
  /** The rows to append, in order. Empty when nothing changed. */
  events: TicketEventInput[];
  /** The timestamp columns the update must set (a null clears one). */
  stamps: Partial<Pick<TicketStateForEvents, 'first_response_at' | 'resolved_at' | 'closed_at'>>;
}

const isTerminal = (s: TicketStatus) => s === 'resolved' || s === 'closed';

export function eventsForChange(
  before: TicketStateForEvents,
  patch: AdminPatch,
  actorProfileId: string,
  now: Date = new Date()
): ChangeOutcome {
  const events: TicketEventInput[] = [];
  const stamps: ChangeOutcome['stamps'] = {};
  const base = { ticket_id: before.id, actor_profile_id: actorProfileId, old_value: null, new_value: null, body: null };

  if (patch.status !== undefined && patch.status !== before.status) {
    const reopened = isTerminal(before.status) && !isTerminal(patch.status);
    events.push({
      ...base,
      kind: reopened ? 'reopened' : 'status_changed',
      old_value: before.status,
      new_value: patch.status,
      body: patch.status === 'resolved' || patch.status === 'closed' ? (patch.resolution_note ?? null) : null,
      visible_to_user: true,
    });
    if (patch.status === 'resolved') stamps.resolved_at = now.toISOString();
    if (patch.status === 'closed') {
      stamps.closed_at = now.toISOString();
      if (!before.resolved_at) stamps.resolved_at = now.toISOString();
    }
    if (reopened) {
      stamps.resolved_at = null;
      stamps.closed_at = null;
    }
  }

  if (patch.severity !== undefined && patch.severity !== before.severity) {
    events.push({ ...base, kind: 'severity_changed', old_value: before.severity, new_value: patch.severity, visible_to_user: false });
  }

  if (patch.assignee_profile_id !== undefined && patch.assignee_profile_id !== before.assignee_profile_id) {
    events.push({
      ...base,
      kind: 'assigned',
      old_value: before.assignee_profile_id,
      new_value: patch.assignee_profile_id,
      visible_to_user: false,
    });
  }

  if (patch.suggestion_tag !== undefined && patch.suggestion_tag !== before.suggestion_tag) {
    events.push({ ...base, kind: 'action_taken', old_value: before.suggestion_tag, new_value: patch.suggestion_tag, visible_to_user: false });
  }

  // The first admin-authored event is the first response, whatever it was.
  if (events.length > 0 && !before.first_response_at) stamps.first_response_at = now.toISOString();

  return { events, stamps };
}

/** A note, a reply to the user or a user reply — one row each. */
export function noteEvent(ticketId: string, actorProfileId: string, body: string): TicketEventInput {
  return { ticket_id: ticketId, actor_profile_id: actorProfileId, kind: 'note', old_value: null, new_value: null, body, visible_to_user: false };
}

export function replyToUserEvent(ticketId: string, actorProfileId: string, body: string): TicketEventInput {
  return { ticket_id: ticketId, actor_profile_id: actorProfileId, kind: 'reply_to_user', old_value: null, new_value: null, body, visible_to_user: true };
}

export function userReplyEvent(ticketId: string, actorProfileId: string, body: string): TicketEventInput {
  return { ticket_id: ticketId, actor_profile_id: actorProfileId, kind: 'user_reply', old_value: null, new_value: null, body, visible_to_user: true };
}

/** The email record: `new_value` is the MASKED recipient (never the address in full). */
export function emailSentEvent(ticketId: string, kind: string, maskedRecipient: string): TicketEventInput {
  return { ticket_id: ticketId, actor_profile_id: null, kind: 'email_sent', old_value: kind, new_value: maskedRecipient, body: null, visible_to_user: false };
}

/** `tom@example.com` → `t***@example.com` — what the history stores. */
export function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
