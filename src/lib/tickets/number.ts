/**
 * The human-readable ticket number (Spec 1, migration 222).
 *
 * `tickets.number` is a bigint IDENTITY starting at 1000; the user sees
 * `EA-1000` in every email subject and on My requests. The uuid stays the
 * primary key and the URL id — a number is guessable, so a route never
 * looks a ticket up by it for a user (an admin search may). Pure.
 */

export const TICKET_NUMBER_PREFIX = 'EA-';

export function formatTicketNumber(n: number): string {
  if (!Number.isInteger(n) || n < 0) throw new Error(`formatTicketNumber: not a ticket number: ${n}`);
  return `${TICKET_NUMBER_PREFIX}${n}`;
}

/** `EA-1042` → 1042; tolerant of case and surrounding whitespace; null for anything else. */
export function parseTicketNumber(text: string): number | null {
  const m = /^\s*EA-?(\d{1,12})\s*$/i.exec(text);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) ? n : null;
}
