/**
 * What each reader may see of a ticket (Spec 1) — pure, the privacy boundary.
 *
 * Every ticket read runs on the service role (posture A), so the projection
 * IS the access rule. Two shapes:
 *
 *   USER (My requests) — the submitter, or a guardian of a supervised
 *   submitter. Never: the assignee, internal notes, the reported user's
 *   profile id, a report's snapshot (it may hold another person's content),
 *   the reporter email column (the user knows their own), merge links.
 *   A test serialises this projection and asserts the keys.
 *
 *   ADMIN (the console) — everything, plus the events with their actors.
 *
 * `userVisibleEvents` keeps only rows the schema marked visible AND of a
 * kind the user may read — a belt for the braces, so a mis-flagged note
 * still never leaves the console.
 */
import type { TicketEventKind, TicketEventRow, TicketRow } from './types';
import { formatTicketNumber } from './number';
import { SLA_TARGETS, isOverdue } from './severity';

const USER_EVENT_KINDS: ReadonlySet<TicketEventKind> = new Set([
  'created',
  'status_changed',
  'reply_to_user',
  'user_reply',
  'reopened',
]);

export interface UserTicketView {
  id: string;
  number: string;
  type: TicketRow['type'];
  subtype: TicketRow['subtype'];
  reason: string;
  severity: TicketRow['severity'];
  status: TicketRow['status'];
  subject: string | null;
  description: string | null;
  /** Whether the user may still reply (closed, or an appeal already used, → false). */
  canReply: boolean;
  /** Whether a reply now would be the one appeal. */
  replyIsAppeal: boolean;
  resolution_code: TicketRow['resolution_code'];
  resolution_note: string | null;
  responseTarget: string;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

export interface UserEventView {
  id: string;
  kind: TicketEventKind;
  /** 'you' | 'support' | 'system' — never a name or an id. */
  by: 'you' | 'support' | 'system';
  old_value: string | null;
  new_value: string | null;
  body: string | null;
  created_at: string;
}

export function projectTicketForUser(t: TicketRow): UserTicketView {
  const closed = t.status === 'closed';
  const appealUsed = t.appeal_used_at !== null;
  return {
    id: t.id,
    number: formatTicketNumber(t.number),
    type: t.type,
    subtype: t.subtype,
    reason: t.reason,
    severity: t.severity,
    status: t.status,
    subject: t.subject,
    description: t.description,
    canReply: !closed && !(t.status === 'resolved' && appealUsed),
    replyIsAppeal: t.status === 'resolved' && !appealUsed,
    resolution_code: t.resolution_code,
    resolution_note: t.resolution_note,
    responseTarget: SLA_TARGETS[t.severity].label,
    created_at: t.created_at,
    updated_at: t.updated_at,
    resolved_at: t.resolved_at,
  };
}

export function userVisibleEvents(events: TicketEventRow[], viewerProfileIds: ReadonlySet<string>): UserEventView[] {
  return events
    .filter(e => e.visible_to_user && USER_EVENT_KINDS.has(e.kind))
    .map(e => ({
      id: e.id,
      kind: e.kind,
      by: e.actor_profile_id === null ? 'system' : viewerProfileIds.has(e.actor_profile_id) ? 'you' : 'support',
      old_value: e.old_value,
      new_value: e.new_value,
      body: e.body,
      created_at: e.created_at,
    }));
}

export interface AdminTicketView extends TicketRow {
  numberLabel: string;
  overdue: boolean;
  responseTarget: string;
}

export function projectTicketForAdmin(t: TicketRow, now: Date = new Date()): AdminTicketView {
  return {
    ...t,
    numberLabel: formatTicketNumber(t.number),
    overdue: isOverdue(t, now),
    responseTarget: SLA_TARGETS[t.severity].label,
  };
}

// ── The reported user's view (Spec 2) ───────────────────────────────────────
//
// Once a decision was made AGAINST someone, they may read the outcome and
// appeal once — and nothing else: never the reporter, the description, the
// snapshot, the reason's details, the assignee or the internal notes. The
// thread they see is their own replies and support's replies AFTER the
// decision. Reports are anonymous to the reported user (the doc).

export interface SubjectTicketView {
  id: string;
  number: string;
  /** Always 'notice' — the front end renders it under "About your account". */
  role: 'subject';
  type: 'report';
  status: TicketRow['status'];
  resolution_code: TicketRow['resolution_code'];
  resolution_note: string | null;
  canReply: boolean;
  replyIsAppeal: boolean;
  resolved_at: string | null;
  updated_at: string;
}

export function projectTicketForSubject(t: TicketRow): SubjectTicketView {
  const closed = t.status === 'closed';
  const appealUsed = t.appeal_used_at !== null;
  return {
    id: t.id,
    number: formatTicketNumber(t.number),
    role: 'subject',
    type: 'report',
    status: t.status,
    resolution_code: t.resolution_code,
    resolution_note: t.resolution_note,
    canReply: !closed && !(t.status === 'resolved' && appealUsed),
    replyIsAppeal: t.status === 'resolved' && !appealUsed,
    resolved_at: t.resolved_at,
    updated_at: t.updated_at,
  };
}

const SUBJECT_EVENT_KINDS: ReadonlySet<TicketEventKind> = new Set(['reply_to_user', 'user_reply', 'status_changed', 'reopened']);

/** The subject's thread: their own replies, and support's replies + status changes after the decision. */
export function subjectVisibleEvents(events: TicketEventRow[], viewerProfileIds: ReadonlySet<string>, decidedAt: string | null): UserEventView[] {
  const cutoff = decidedAt ? Date.parse(decidedAt) : Number.POSITIVE_INFINITY;
  return events
    .filter(e => e.visible_to_user && SUBJECT_EVENT_KINDS.has(e.kind))
    .filter(e => (e.actor_profile_id !== null && viewerProfileIds.has(e.actor_profile_id)) || Date.parse(e.created_at) >= cutoff)
    .map(e => ({
      id: e.id,
      kind: e.kind,
      by: e.actor_profile_id === null ? 'system' : viewerProfileIds.has(e.actor_profile_id) ? 'you' : 'support',
      old_value: e.old_value,
      new_value: e.new_value,
      body: e.body,
      created_at: e.created_at,
    }));
}
