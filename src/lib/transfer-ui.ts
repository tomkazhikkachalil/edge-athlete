// ── Transfer-of-control UI helpers ───────────────────────────────────────────
// Pure display logic shared by the transfer page, the guardian overview
// chips, and the supervised-athlete banner. The server state machine lives
// in lib/transfers.ts; this module only maps its states to copy.

export type TransferState =
  | 'eligible_notified'
  | 'requested'
  | 'initiated'
  | 'credentials_pending'
  | 'dual_confirm'
  | 'cooling_off'
  | 'executing';

export type ViewerRole = 'owner' | 'guardian' | 'supervised' | 'viewer';

// Terminal states (Round D). GET /api/transfers reports the LATEST terminal
// row as `lastTransfer` when nothing is active, so a dead attempt renders
// honestly instead of looping back to a bare "Start the handover".
export type TerminalTransferState = 'completed' | 'aborted' | 'failed' | 'expired';

export interface LastTransfer {
  state: TerminalTransferState;
  updated_at: string | null;
}

/** One-liner shown above the start-over CTA when the previous attempt died.
 *  'completed' intentionally returns null — a finished handover flips
 *  supervision_state to 'self', which the pages already render as
 *  "Already handed over"; a banner would just repeat it. */
export function terminalTransferNotice(
  state: TerminalTransferState,
  viewer: 'guardian' | 'supervised'
): string | null {
  switch (state) {
    case 'completed':
      return null;
    case 'aborted':
      return viewer === 'guardian'
        ? 'The last handover was called off before it finished. Nothing changed — you can start again whenever you like.'
        : 'The last handover was called off. Nothing changed — you can ask again whenever you like.';
    case 'expired':
      return viewer === 'guardian'
        ? 'The last handover attempt sat unfinished for two weeks and expired. Nothing changed — start again when you’re both ready.'
        : 'The last handover attempt expired because it sat unfinished. Nothing changed — ask again when you’re ready.';
    case 'failed':
      return viewer === 'guardian'
        ? 'The last handover ran into a problem on our side and couldn’t finish. Nothing was lost — you can try again, and we’ve been notified.'
        : 'The last handover ran into a problem on our side. Nothing was lost — your guardian can start it again.';
  }
}

// Shape returned by GET /api/transfers (active transfers only).
export interface ClientTransfer {
  id: string;
  state: TransferState;
  initiated_by: 'guardian' | 'athlete' | 'system';
  athlete_contact_email: string | null;
  contact_verified_at: string | null;
  athlete_confirmed_at: string | null;
  guardian_confirmed_at: string | null;
  cooling_off_ends_at: string | null;
  guardian_post_role: 'viewer' | 'removed' | null;
  created_at: string;
}

export interface StateChip {
  label: string;
  // amber = the guardian has something to do; violet = moving; gray = waiting
  tone: 'violet' | 'amber' | 'gray';
}

export function transferStateChip(state: TransferState): StateChip {
  switch (state) {
    case 'eligible_notified':
      return { label: 'Ready to transfer', tone: 'violet' };
    case 'requested':
      return { label: 'Needs your approval', tone: 'amber' };
    case 'initiated':
      return { label: "Waiting on athlete's email", tone: 'gray' };
    case 'credentials_pending':
      return { label: 'Athlete verifying email', tone: 'gray' };
    case 'dual_confirm':
      return { label: 'Confirmation needed', tone: 'amber' };
    case 'cooling_off':
      return { label: 'Cooling off', tone: 'violet' };
    case 'executing':
      return { label: 'Completing…', tone: 'violet' };
  }
}

// "6 days, 4 hours" / "3 hours" / "under an hour" / "any moment now"
export function formatCountdown(endsAtIso: string, now: Date = new Date()): string {
  const msLeft = new Date(endsAtIso).getTime() - now.getTime();
  if (msLeft <= 0) return 'any moment now';
  const hoursLeft = Math.floor(msLeft / 3_600_000);
  if (hoursLeft < 1) return 'under an hour';
  const days = Math.floor(hoursLeft / 24);
  const hours = hoursLeft % 24;
  if (days < 1) return `${hours} hour${hours === 1 ? '' : 's'}`;
  const dayPart = `${days} day${days === 1 ? '' : 's'}`;
  return hours > 0 ? `${dayPart}, ${hours} hour${hours === 1 ? '' : 's'}` : dayPart;
}

// One-liner for the supervised athlete's banner, kid-appropriate.
export function bannerCopy(state: TransferState): string {
  switch (state) {
    case 'eligible_notified':
      return "You're old enough to take over your account!";
    case 'requested':
      return 'Waiting for your guardian to say yes to your takeover.';
    case 'initiated':
      return 'Your account handover has started — add your email to keep it moving.';
    case 'credentials_pending':
      return 'Almost there — enter the code we emailed you.';
    case 'dual_confirm':
      return 'Your account handover needs your confirmation.';
    case 'cooling_off':
      return 'Your account becomes yours soon.';
    case 'executing':
      return 'Your account handover is completing now.';
  }
}
