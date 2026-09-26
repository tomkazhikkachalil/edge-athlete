'use client';

// ── The backup warning (Authority PR 2, Sep 25 2026) ────────────────────────
// Tom: "there always needs to be two accounts to create an event, tourney,
// club, league" — as a WARNING, never a block. Shown to the people who can
// act on it until a backup exists; deliberately NOT dismissible (a warning
// you can hide is a warning nobody sees twice). One CTA, a 44px target.

import type { BackupState } from '@/lib/authority/backup';

interface Props {
  state: BackupState | null | undefined;
  subject: 'event' | 'org';
  /** The one action: open the invite (event) or the members list (org). */
  onAct?: () => void;
  actHref?: string;
}

const COPY = {
  event: {
    none: { title: 'This event has no backup organizer', body: 'If you can’t run it, nobody else can. Add a co-organizer — they can manage it with you, or take it over.', cta: 'Add a co-organizer' },
    pending: { title: 'Your co-organizer hasn’t accepted yet', body: 'Until they accept, you are the only one who can run this event.', cta: 'Invite someone else' },
  },
  org: {
    none: { title: 'Add a backup for this organization', body: 'Only one person can run it right now. Make a member a manager or co-owner, so it keeps going if you can’t.', cta: 'Choose a backup' },
    pending: { title: 'Add a backup for this organization', body: 'Only one person can run it right now.', cta: 'Choose a backup' },
  },
} as const;

export default function BackupBanner({ state, subject, onAct, actHref }: Props) {
  if (state !== 'none' && state !== 'pending') return null;
  const copy = COPY[subject][state];
  const cta = 'ea-interactive inline-flex items-center justify-center min-h-[44px] px-4 rounded-lg bg-amber-600 text-white text-sm font-semibold hover:bg-amber-700 shrink-0';
  return (
    <div
      role="status"
      className="rounded-lg border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 p-4 flex flex-col sm:flex-row sm:items-center gap-3"
      data-backup-banner={state}
      data-backup-subject={subject}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-amber-900 dark:text-amber-100">
          <i className="fas fa-user-shield mr-2" aria-hidden="true"></i>
          {copy.title}
        </p>
        <p className="text-sm text-amber-900/90 dark:text-amber-100/90 mt-1">{copy.body}</p>
      </div>
      {actHref ? (
        <a href={actHref} className={cta} data-backup-act="">{copy.cta}</a>
      ) : onAct ? (
        <button type="button" onClick={onAct} className={cta} data-backup-act="">{copy.cta}</button>
      ) : null}
    </div>
  );
}
