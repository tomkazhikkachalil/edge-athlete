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
