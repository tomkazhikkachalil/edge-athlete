/**
 * Severity and response targets (Spec 1).
 *
 * Severity is set automatically at submit from the type and the reason —
 * and, for a report, whether the reported user is a minor — and an admin
 * may change it afterwards. It drives queue order and the response target.
 * The targets are GUIDANCE (Tom, Sep 20 2026): the queue marks a ticket
 * overdue and the created email quotes the target; nothing escalates on its
 * own. Pure; every branch pinned in __tests__/severity.test.ts.
 */
import type { TicketSeverity, TicketType } from './types';

export interface SeverityInput {
  type: TicketType;
  reason: string;
  /** A report against a supervised profile is Critical whatever the reason. */
  targetIsMinor?: boolean;
}

const CRITICAL_REASONS: ReadonlySet<string> = new Set(['minor_safety', 'self_harm']);
const HIGH_REASONS: ReadonlySet<string> = new Set([
  'harassment_bullying',
  'hate_discrimination',
  'sexual_content',
  'impersonation',
]);

export function severityFor(input: SeverityInput): TicketSeverity {
  if (input.type === 'suggestion') return 'low';
  if (input.type === 'help') return 'medium';
  if (input.targetIsMinor || CRITICAL_REASONS.has(input.reason)) return 'critical';
  if (HIGH_REASONS.has(input.reason)) return 'high';
  return 'medium';
}

/** Queue order: critical first, then by age. */
export const SEVERITY_RANK: Record<TicketSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

/** The first-response targets. `businessDays` counts Monday–Friday. */
export const SLA_TARGETS: Record<TicketSeverity, { hours?: number; businessDays?: number; label: string }> = {
  critical: { hours: 1, label: 'within 1 hour' },
  high: { businessDays: 1, label: 'the same business day' },
  medium: { businessDays: 2, label: 'within 2 business days' },
  low: { businessDays: 5, label: 'in the weekly review' },
};

/** Adds n business days (Mon–Fri) in UTC; a start on a weekend counts from the next Monday. */
export function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  let remaining = n;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return d;
}

/** When the first response is due for a ticket created at `createdAt`. */
export function firstResponseDue(createdAt: Date, severity: TicketSeverity): Date {
  const target = SLA_TARGETS[severity];
  if (target.hours !== undefined) return new Date(createdAt.getTime() + target.hours * 3_600_000);
  return addBusinessDays(createdAt, target.businessDays ?? 0);
}

/** Overdue = no first response yet and the target has passed. A responded ticket is never overdue. */
export function isOverdue(
  ticket: { created_at: string; severity: TicketSeverity; first_response_at: string | null; status: string },
  now: Date = new Date()
): boolean {
  if (ticket.first_response_at) return false;
  if (ticket.status === 'resolved' || ticket.status === 'closed') return false;
  return now.getTime() > firstResponseDue(new Date(ticket.created_at), ticket.severity).getTime();
}
