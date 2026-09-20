'use client';

/**
 * Shared pieces of the ticket surfaces (Support & Reporting, Spec 1):
 * the severity / status / type chips and the relative-time label. Pure
 * presentational; both the admin queue and the user's My requests use them.
 */
import {
  RESOLUTION_CODE_LABELS,
  TICKET_SEVERITY_LABELS,
  TICKET_STATUS_LABELS,
  reasonLabel,
  type ResolutionCode,
  type TicketSeverity,
  type TicketStatus,
  type TicketType,
} from '@/lib/tickets/types';

const SEVERITY_CLASS: Record<TicketSeverity, string> = {
  critical: 'bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-950/40 dark:text-orange-300',
  medium: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  low: 'bg-surface-muted text-secondary',
};

const STATUS_CLASS: Record<TicketStatus, string> = {
  new: 'bg-brand-soft text-brand-fg',
  in_review: 'bg-blue-100 text-blue-800 dark:bg-blue-950/40 dark:text-blue-300',
  waiting_on_user: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300',
  resolved: 'bg-green-100 text-green-800 dark:bg-green-950/40 dark:text-green-300',
  closed: 'bg-surface-muted text-muted',
};

const TYPE_LABEL: Record<TicketType, string> = { help: 'Help', report: 'Report', suggestion: 'Suggestion' };

export function SeverityChip({ severity }: { severity: TicketSeverity }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${SEVERITY_CLASS[severity]}`} data-ticket-severity={severity}>
      {TICKET_SEVERITY_LABELS[severity]}
    </span>
  );
}

export function StatusChip({ status }: { status: TicketStatus }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_CLASS[status]}`} data-ticket-status={status}>
      {TICKET_STATUS_LABELS[status]}
    </span>
  );
}

export function TypeChip({ type, subtype }: { type: TicketType; subtype?: string | null }) {
  return (
    <span className="inline-flex items-center rounded-full border border-border px-2 py-0.5 text-xs text-secondary">
      {TYPE_LABEL[type]}
      {subtype ? ` · ${subtype}` : ''}
    </span>
  );
}

export function resolutionLabel(code: ResolutionCode | null): string {
  return code ? RESOLUTION_CODE_LABELS[code] : '';
}

export { reasonLabel };

/** "3m ago" / "2h ago" / "4d ago" / a date past a fortnight. */
export function ago(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return 'just now';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 14) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The words for a status-change / reopened event in a timeline. */
export function eventLine(kind: string, oldValue: string | null, newValue: string | null): string {
  const label = (s: string | null) => (s && s in TICKET_STATUS_LABELS ? TICKET_STATUS_LABELS[s as TicketStatus] : s ?? '');
  switch (kind) {
    case 'created':
      return 'Request opened';
    case 'status_changed':
      return `Status: ${label(oldValue)} → ${label(newValue)}`;
    case 'reopened':
      return `Reopened (${label(oldValue)} → ${label(newValue)})`;
    case 'severity_changed':
      return `Severity: ${oldValue ?? '—'} → ${newValue ?? '—'}`;
    case 'assigned':
      return newValue ? 'Assigned' : 'Unassigned';
    case 'note':
      return 'Internal note';
    case 'reply_to_user':
      return 'Reply to the user';
    case 'user_reply':
      return 'Reply from the user';
    case 'email_sent':
      return `Email sent (${oldValue ?? ''}) to ${newValue ?? ''}`;
    case 'action_taken':
      return `Tagged: ${newValue ?? '—'}`;
    case 'merged':
      return 'Merged';
    case 'anonymized':
      return 'Anonymized (retention)';
    default:
      return kind;
  }
}
