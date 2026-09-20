/**
 * Status transitions (Spec 1).
 *
 *   new → in_review → waiting_on_user → resolved → closed
 *
 * Two actors, two rules, both pure and pinned in __tests__/transitions.test.ts:
 *
 * ADMIN — moves a ticket anywhere among the five, except that a CLOSED ticket
 * reopens only to in_review (the reopen event), and the same status is not a
 * transition. Resolving needs a resolution code — the route checks the
 * payload; this module only says whether the move is legal.
 *
 * USER (a reply from My requests) — never picks a status; the reply decides:
 *   new / in_review      → status unchanged (the reply is appended)
 *   waiting_on_user      → in_review (the admin's question was answered)
 *   resolved             → in_review ONCE — the appeal (Tom's rule: "can
 *                          appeal once by replying, which reopens the ticket");
 *                          refused after `appeal_used_at`
 *   closed               → refused (terminal for users)
 */
import type { TicketStatus } from './types';

export type TransitionResult =
  | { ok: true; next: TicketStatus; reopened: boolean; appeal: boolean }
  | { ok: false; reason: 'unchanged' | 'closed_reopens_only_to_review' | 'closed' | 'appeal_used' | 'unknown_status' };

const STATUSES: ReadonlySet<string> = new Set(['new', 'in_review', 'waiting_on_user', 'resolved', 'closed']);

export function validateAdminTransition(from: TicketStatus, to: TicketStatus): TransitionResult {
  if (!STATUSES.has(from) || !STATUSES.has(to)) return { ok: false, reason: 'unknown_status' };
  if (from === to) return { ok: false, reason: 'unchanged' };
  if (from === 'closed' && to !== 'in_review') return { ok: false, reason: 'closed_reopens_only_to_review' };
  const reopened = (from === 'resolved' || from === 'closed') && to !== 'closed';
  return { ok: true, next: to, reopened, appeal: false };
}

export function transitionForUserReply(
  ticket: { status: TicketStatus; appeal_used_at: string | null }
): TransitionResult {
  switch (ticket.status) {
    case 'new':
    case 'in_review':
      return { ok: true, next: ticket.status, reopened: false, appeal: false };
    case 'waiting_on_user':
      return { ok: true, next: 'in_review', reopened: false, appeal: false };
    case 'resolved':
      if (ticket.appeal_used_at) return { ok: false, reason: 'appeal_used' };
      return { ok: true, next: 'in_review', reopened: true, appeal: true };
    case 'closed':
      return { ok: false, reason: 'closed' };
    default:
      return { ok: false, reason: 'unknown_status' };
  }
}

/** The words the API answers with when a user reply is refused. */
export const USER_REPLY_REFUSALS: Record<Exclude<TransitionResult, { ok: true }>['reason'], string> = {
  unchanged: 'Nothing to change.',
  closed_reopens_only_to_review: 'A closed ticket can only be reopened for review.',
  closed: 'This request is closed. Open a new request if you need more help.',
  appeal_used: 'This request has already been appealed once. Open a new request if you need more help.',
  unknown_status: 'This request is in an unknown state.',
};
