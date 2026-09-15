'use client';

import type { JoinControl } from '@/lib/sport-events/join-state';

interface Props {
  control: JoinControl;
  busy: boolean;
  onAccept: () => void;
  onDecline: () => void;
  onRequest: () => void;
  onCancelRequest: () => void;
  onWithdraw: () => void;
  onFollow: () => void;
  onUnfollow: () => void;
  onManage: () => void;
}

const PRIMARY = 'ea-cta text-white px-4 min-h-[44px] rounded-lg text-sm font-semibold inline-flex items-center justify-center disabled:opacity-60';
const SECONDARY = 'ea-interactive border border-border-strong text-secondary px-4 min-h-[44px] rounded-lg text-sm font-semibold inline-flex items-center justify-center disabled:opacity-60';

/** One control, every join state — the header's and the players tab's. */
export default function EventJoinButton({ control, busy, onAccept, onDecline, onRequest, onCancelRequest, onWithdraw, onFollow, onUnfollow, onManage }: Props) {
  switch (control.kind) {
    case 'manage':
      return <button type="button" onClick={onManage} className={SECONDARY} data-event-join="manage">Manage players</button>;
    case 'respond':
      return (
        <div className="flex gap-2" data-event-join="respond">
          <button type="button" onClick={onAccept} disabled={busy} className={PRIMARY}>Accept</button>
          <button type="button" onClick={onDecline} disabled={busy} className={SECONDARY}>Decline</button>
        </div>
      );
    case 'request':
      return <button type="button" onClick={onRequest} disabled={busy} className={PRIMARY} data-event-join="request">Request to join</button>;
    case 'requested':
      return <button type="button" onClick={onCancelRequest} disabled={busy} className={SECONDARY} data-event-join="requested">Requested · Cancel</button>;
    case 'in':
      return (
        <div className="flex items-center gap-3" data-event-join="in">
          <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-300"><i className="fas fa-check mr-1" aria-hidden="true"></i>You&apos;re in</span>
          <button type="button" onClick={onWithdraw} disabled={busy} className={SECONDARY}>Withdraw</button>
        </div>
      );
    case 'waitlisted':
      return (
        <div className="flex items-center gap-3" data-event-join="waitlisted">
          <span className="text-sm font-semibold text-amber-700 dark:text-amber-300" data-event-waitlisted={control.position ?? ''}>Waitlisted{control.position ? ` #${control.position}` : ''}{control.ahead !== null ? (control.ahead === 0 ? ' · you\'re next' : ` · ${control.ahead} ahead`) : ''}</span>
          <button type="button" onClick={onWithdraw} disabled={busy} className={SECONDARY}>Leave</button>
        </div>
      );
    case 'follow':
      return <button type="button" onClick={onFollow} disabled={busy} className={SECONDARY} data-event-join="follow"><i className="fas fa-bell mr-2" aria-hidden="true"></i>Follow</button>;
    case 'following':
      return <button type="button" onClick={onUnfollow} disabled={busy} className={SECONDARY} data-event-join="following"><i className="fas fa-check mr-2" aria-hidden="true"></i>Following</button>;
    default:
      return null;
  }
}
