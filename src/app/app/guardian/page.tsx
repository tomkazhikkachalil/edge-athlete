'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { isOptimizableImageSrc } from '@/lib/media/image-src';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import { FEATURE_FLAGS } from '@/lib/features';
import { formatDisplayName, getInitials, formatAge } from '@/lib/formatters';
import { transferStateChip } from '@/lib/transfer-ui';
import { parkPurgeDate } from '@/lib/account-park';
import {
  consentChip,
  loginChip,
  messagingChip,
  visibilityChip,
  type Chip,
} from '@/lib/guardian-rollup';
import { AGING_BADGE_MS, type QueueItem } from '@/lib/guardian-queue';
import GuardianWeekStrip from '@/components/calendar/GuardianWeekStrip';
import type { ConsentState } from '@/lib/consent';

// ── Family console ────────────────────────────────────────────────────────────
// The guardianship layer's home: every athlete this account is responsible
// for, what needs attention, and the way into each one. Three questions, in
// order: what happened? what needs me? what are they allowed to do?
//
// Chrome is AppHeader (not BrandBar): this is a recurring signed-in
// destination like /settings, not a step in a funnel — the linear guardian
// flows (add-athlete, consent, credentials, transfer) keep BrandBar.

interface ConsoleAthlete {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  handle: string | null;
  avatar_url: string | null;
  dob: string | null;
  supervision_state: string | null;
  visibility: string | null;
  messaging_permission: string | null;
  consentState: ConsentState;
  hasLogin: boolean;
  pendingPostCount: number;
  pendingCommentCount: number;
  pendingFollowRequestCount: number;
  activeTransfer: { state: string } | null;
  // Soft-delete park stamp (migration 128) — parked athletes render in the
  // restore section instead of the roster cards.
  deletion_requested_at: string | null;
}

const CHIP_TONES = {
  violet: 'bg-violet-100 dark:bg-violet-950/60 text-brand-fg-strong',
  amber: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300',
  gray: 'bg-surface-sunken text-tertiary',
} as const;

/** Coarse "how long has this been waiting" label for the aging badge. */
function waitingLabel(createdAt: string, nowMs: number): string | null {
  const days = Math.floor((nowMs - Date.parse(createdAt)) / 86_400_000);
  return days >= AGING_BADGE_MS / 86_400_000 ? `Waiting ${days} day${days === 1 ? '' : 's'}` : null;
}

/** One-line description per queue item kind (the row's main text). */
function queueLabel(item: QueueItem): string {
  switch (item.kind) {
    case 'approve_post':
      return `${item.athlete.name} shared a post for your review`;
    case 'release_comment':
      return `${item.athlete.name} wrote a comment for your review`;
    case 'follow_request':
      return `${item.follower.name} wants to follow ${item.athlete.name}`;
    case 'transfer_step':
      return `${item.athlete.name}'s account transfer needs you`;
    case 'consent_gap':
      return item.consentState === 'rejected'
        ? `Consent for ${item.athlete.name} was rejected — resubmit the form`
        : `Finish consent for ${item.athlete.name}`;
    case 'credentials_gap':
      return `${item.athlete.name} has no login yet`;
    case 'waiting_on_child':
      return `Sent back to ${item.athlete.name} — waiting on their edit`;
    case 'calendar_invite':
      return `${item.athlete.name} was invited: ${item.event.title}`;
    case 'contact_request':
      return `${item.requester.name} wants to message ${item.athlete.name}`;
  }
}

/** "Sat, Aug 29 · 3:00 PM" (or date only for all-day) for invite rows. */
function inviteWhen(event: Extract<QueueItem, { kind: 'calendar_invite' }>['event']): string {
  const start = new Date(Date.parse(event.starts_at));
  return start.toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(event.all_day ? {} : { hour: 'numeric', minute: '2-digit' }),
  });
}

const QUEUE_ICONS: Record<QueueItem['kind'], string> = {
  approve_post: 'fa-image',
  release_comment: 'fa-comment',
  follow_request: 'fa-user-plus',
  transfer_step: 'fa-right-left',
  consent_gap: 'fa-file-signature',
  credentials_gap: 'fa-key',
  waiting_on_child: 'fa-hourglass-half',
  calendar_invite: 'fa-calendar-day',
  contact_request: 'fa-user-clock',
};

function ChipPill({ chip }: { chip: Chip }) {
  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${CHIP_TONES[chip.tone]}`}>
      {chip.label}
    </span>
  );
}

export default function FamilyConsolePage() {
  const router = useRouter();
  const { user, loading, initialAuthCheckComplete, managedProfiles, activeProfile, setActiveProfile } = useAuth();
  const [state, setState] = useState<'loading' | 'ready'>('loading');
  const [athletes, setAthletes] = useState<ConsoleAthlete[]>([]);
  const [error, setError] = useState('');
  const [retryKey, setRetryKey] = useState(0);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [queueError, setQueueError] = useState('');
  const [queueActing, setQueueActing] = useState('');
  // Stamped once per load — the aging badge is coarse (whole days), so it
  // doesn't need a ticking clock.
  const [nowMs] = useState(() => Date.now());

  const restoreAthlete = async (profileId: string) => {
    setRestoringId(profileId);
    try {
      const res = await fetch('/api/account/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetProfileId: profileId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not restore the profile');
      setRetryKey(k => k + 1); // refetch the roster — the athlete rejoins it
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not restore the profile');
    } finally {
      setRestoringId(null);
    }
  };

  useEffect(() => {
    if (!loading && initialAuthCheckComplete && !user) router.replace('/');
  }, [user, loading, initialAuthCheckComplete, router]);

  // Memoized so the week strip's fetch effect keys on roster CONTENT, not on
  // a fresh array identity every render.
  const stripAthletes = useMemo(
    () =>
      athletes
        .filter(a => !a.deletion_requested_at && a.supervision_state === 'supervised')
        .map(a => ({
          id: a.id,
          name: formatDisplayName(a.first_name, null, a.last_name, a.display_name),
        })),
    [athletes]
  );

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        // Queue failure is section-scoped: the roster must render even when
        // the action queue can't (and vice versa is impossible — the queue
        // section only shows once the page is up).
        const [rosterRes, queueRes] = await Promise.all([
          fetch('/api/guardian/athletes'),
          fetch('/api/guardian/queue'),
        ]);
        const data = await rosterRes.json().catch(() => ({}));
        const queueData = await queueRes.json().catch(() => ({}));
        if (!rosterRes.ok) throw new Error(data.error || 'Could not load your athletes');
        if (cancelled) return;
        setAthletes(data.athletes ?? []);
        if (queueRes.ok) {
          setQueueItems(queueData.items ?? []);
          setQueueError('');
        } else {
          setQueueError(queueData.error || 'Could not load the action queue');
        }
        setError('');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load your athletes');
      } finally {
        if (!cancelled) setState('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, retryKey]);

  // Inline respond-as-child on a calendar invite — the same endpoint the
  // athlete page's decline uses; the guest row stays the CHILD's (attribution
  // doctrine: the organizer sees the child's response).
  const decideInvite = async (
    item: Extract<QueueItem, { kind: 'calendar_invite' }>,
    status: 'accepted' | 'declined'
  ) => {
    setQueueActing(item.id);
    setQueueError('');
    try {
      const res = await fetch(`/api/calendar/events/${item.event.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, scope: 'this', targetProfileId: item.athlete.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not respond to the invite');
      setQueueItems(prev => prev.filter(i => i.id !== item.id));
    } catch (e) {
      setQueueError(e instanceof Error ? e.message : 'Could not respond to the invite');
    } finally {
      setQueueActing('');
    }
  };

  // Inline decide on a held first contact (Wave 3) — approve makes the
  // thread appear for the child; deny is Tom's quiet removal (sever, tell
  // nobody, repeatable).
  const decideContact = async (
    item: Extract<QueueItem, { kind: 'contact_request' }>,
    decision: 'approve' | 'deny'
  ) => {
    setQueueActing(item.id);
    setQueueError('');
    try {
      const res = await fetch(`/api/guardian/athletes/${item.athlete.id}/contacts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contactProfileId: item.requester.id, decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not record the decision');
      setQueueItems(prev => prev.filter(i => i.id !== item.id));
    } catch (e) {
      setQueueError(e instanceof Error ? e.message : 'Could not record the decision');
    } finally {
      setQueueActing('');
    }
  };

  // Inline decide on a fan request — the same POST the athlete page's fans
  // section fires; decline is a repeatable non-notifying delete, so neither
  // direction needs a confirm step.
  const decideFollow = async (item: Extract<QueueItem, { kind: 'follow_request' }>, action: 'accept' | 'reject') => {
    setQueueActing(item.id);
    setQueueError('');
    try {
      const res = await fetch('/api/followers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, followId: item.id, profileId: item.athlete.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not update the request');
      setQueueItems(prev => prev.filter(i => i.id !== item.id));
    } catch (e) {
      setQueueError(e instanceof Error ? e.message : 'Could not update the request');
    } finally {
      setQueueActing('');
    }
  };

  if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES || loading || !initialAuthCheckComplete || !user) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  // Parked athletes (30-day soft delete) get the restore section, not the
  // roster cards — nothing else on the console applies to a parked profile.
  const parked = athletes.filter(a => a.deletion_requested_at);
  const activeAthletes = athletes.filter(a => !a.deletion_requested_at);

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <main className="max-w-3xl mx-auto px-4 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-1">
          <h1 className="text-2xl font-bold text-primary">Family console</h1>
          <div className="flex items-center gap-2">
            <Link
              href="/app/guardian/add-athlete"
              className="px-3 py-2 min-h-[44px] inline-flex items-center gap-2 bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold transition-colors"
            >
              <i className="fas fa-plus text-xs"></i>
              Add athlete
            </Link>
            <Link
              href="/app/guardian/approvals"
              className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors"
            >
              Approvals
            </Link>
            <Link
              href="/app/guardian/transfers"
              className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors"
            >
              Transfers
            </Link>
          </div>
        </div>
        <p className="text-sm text-tertiary mb-6">
          The athletes you&apos;re responsible for — what&apos;s happening, what needs you,
          and what each profile is allowed to do.
        </p>

        {state === 'loading' ? (
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand mx-auto my-12"></div>
        ) : error ? (
          // Round D: a fetch failure is NOT an empty roster — no "add your
          // first athlete" CTA on top of an error, just the truth + a retry.
          <div className="bg-surface border border-border rounded-lg p-8 text-center">
            <div role="alert" className="text-sm text-red-600 dark:text-red-400 mb-4">{error}</div>
            <button
              type="button"
              onClick={() => { setError(''); setState('loading'); setRetryKey(k => k + 1); }}
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold transition-colors"
            >
              <i className="fas fa-rotate-right text-xs"></i>
              Try again
            </button>
          </div>
        ) : (
          <>
            {parked.length > 0 && (
              <section aria-label="Scheduled for deletion" className="mb-6">
                <h2 className="text-xs font-bold uppercase tracking-wide text-red-700 dark:text-red-300 mb-2">
                  Scheduled for deletion
                </h2>
                <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-lg divide-y divide-red-200 dark:divide-red-900">
                  {parked.map(a => {
                    const name = formatDisplayName(a.first_name, null, a.last_name, a.display_name);
                    const purge = parkPurgeDate(a.deletion_requested_at!).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
                    return (
                      <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                        <span className="text-red-800 dark:text-red-200 font-medium">
                          {name}&apos;s profile will be permanently deleted on {purge}.
                        </span>
                        <button
                          type="button"
                          disabled={restoringId === a.id}
                          onClick={() => restoreAthlete(a.id)}
                          className="inline-flex min-h-[44px] items-center px-3 -my-1 rounded-lg font-semibold text-red-700 dark:text-red-300 hover:bg-red-100 active:bg-red-100 dark:hover:bg-red-950/60 dark:active:bg-red-950/60 transition-colors disabled:opacity-60"
                        >
                          {restoringId === a.id ? 'Restoring…' : 'Restore'}
                        </button>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}

            {(queueItems.length > 0 || queueError) && (
              <section aria-label="Needs your attention" className="mb-6">
                <h2 className="text-xs font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300 mb-2">
                  Needs you
                </h2>
                {queueError ? (
                  <div role="alert" className="bg-surface border border-border rounded-lg px-4 py-3 text-sm text-red-600 dark:text-red-400">
                    {queueError}
                  </div>
                ) : (
                  <div className="bg-surface border border-border rounded-lg divide-y divide-border">
                    {queueItems.map(item => {
                      // No aging badge on waiting_on_child rows — the badge
                      // means "the GUARDIAN is late", and those aren't theirs.
                      const aging =
                        'createdAt' in item && item.kind !== 'waiting_on_child'
                          ? waitingLabel(item.createdAt, nowMs)
                          : null;
                      const detail =
                        item.kind === 'approve_post'
                          ? item.caption || (item.mediaCount > 0 ? `${item.mediaCount} photo${item.mediaCount === 1 ? '' : 's'} or video${item.mediaCount === 1 ? '' : 's'}` : null)
                          : item.kind === 'release_comment'
                          ? item.excerpt
                          : item.kind === 'follow_request'
                          ? item.message
                          : item.kind === 'calendar_invite'
                          ? inviteWhen(item.event)
                          : item.kind === 'contact_request'
                          ? item.requester.handle
                            ? `@${item.requester.handle} — held until you decide`
                            : 'Held until you decide'
                          : null;
                      const waitingOnChild = item.kind === 'waiting_on_child';
                      const body = (
                        <>
                          <span className={`w-8 h-8 rounded-full inline-flex items-center justify-center shrink-0 ${
                            waitingOnChild
                              ? 'bg-surface-sunken text-tertiary'
                              : 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300'
                          }`}>
                            <i className={`fas ${QUEUE_ICONS[item.kind]} text-xs`}></i>
                          </span>
                          <span className="flex-grow min-w-0">
                            <span className={`block text-sm font-medium ${waitingOnChild ? 'text-tertiary' : 'text-primary'}`}>
                              {queueLabel(item)}
                            </span>
                            {detail && (
                              <span className="block text-xs text-muted truncate">{detail}</span>
                            )}
                            {(aging || (('consentBlocked' in item) && item.consentBlocked)) && (
                              <span className="flex flex-wrap gap-1.5 mt-1">
                                {aging && (
                                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300">
                                    {aging}
                                  </span>
                                )}
                                {'consentBlocked' in item && item.consentBlocked && (
                                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-surface-sunken text-tertiary">
                                    Consent needed before you can approve
                                  </span>
                                )}
                              </span>
                            )}
                          </span>
                        </>
                      );
                      if (
                        item.kind === 'follow_request' ||
                        item.kind === 'calendar_invite' ||
                        item.kind === 'contact_request'
                      ) {
                        const decide =
                          item.kind === 'follow_request'
                            ? (yes: boolean) => decideFollow(item, yes ? 'accept' : 'reject')
                            : item.kind === 'calendar_invite'
                            ? (yes: boolean) => decideInvite(item, yes ? 'accepted' : 'declined')
                            : (yes: boolean) => decideContact(item, yes ? 'approve' : 'deny');
                        const [yesLabel, noLabel] =
                          item.kind === 'contact_request' ? ['Approve', 'Deny'] : ['Accept', 'Decline'];
                        return (
                          <div key={item.id} className="flex flex-wrap items-center gap-3 px-4 py-3 min-h-[44px]">
                            {body}
                            <span className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                disabled={queueActing === item.id}
                                onClick={() => decide(true)}
                                className="px-3 py-2 min-h-[44px] inline-flex items-center bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                              >
                                {yesLabel}
                              </button>
                              <button
                                type="button"
                                disabled={queueActing === item.id}
                                onClick={() => decide(false)}
                                className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors disabled:opacity-50"
                              >
                                {noLabel}
                              </button>
                            </span>
                          </div>
                        );
                      }
                      if (item.kind === 'waiting_on_child') {
                        // The ball is in the child's court — informational
                        // only, nothing here for the guardian to click.
                        return (
                          <div key={item.id} className="flex items-center gap-3 px-4 py-3 min-h-[44px]">
                            {body}
                          </div>
                        );
                      }
                      return (
                        <Link
                          key={item.id}
                          href={item.href}
                          className="flex items-center gap-3 px-4 py-3 min-h-[44px] hover:bg-surface-muted transition-colors first:rounded-t-lg last:rounded-b-lg"
                        >
                          {body}
                          <i className="fas fa-chevron-right text-xs text-muted shrink-0"></i>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            {stripAthletes.length > 0 && <GuardianWeekStrip athletes={stripAthletes} />}

            {athletes.length === 0 ? (
              // All-parked rosters skip this card — the restore section above
              // is the whole story then.
              <div className="bg-surface border border-border rounded-lg p-8 text-center">
                <p className="text-sm text-muted mb-4">
                  You&apos;re not managing any athlete profiles yet.
                </p>
                <Link
                  href="/app/guardian/add-athlete"
                  className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold transition-colors"
                >
                  <i className="fas fa-plus text-xs"></i>
                  Add your first athlete
                </Link>
              </div>
            ) : (
              activeAthletes.map(a => {
                const name = formatDisplayName(a.first_name, null, a.last_name, a.display_name);
                const transferred = a.supervision_state === 'self';
                const isActive = activeProfile?.id === a.id;
                const managed = managedProfiles.find(mp => mp.id === a.id) ?? null;
                return (
                  <div key={a.id} className="bg-surface border border-border rounded-lg p-4 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="relative w-12 h-12 rounded-full overflow-hidden bg-violet-100 dark:bg-violet-950/60 flex items-center justify-center shrink-0">
                        {a.avatar_url ? (
                          <Image
                            src={a.avatar_url}
                            alt=""
                            fill
                            sizes="48px"
                            className="object-cover"
                            unoptimized={!isOptimizableImageSrc(a.avatar_url)}
                          />
                        ) : (
                          <span className="text-sm font-semibold text-brand-fg-strong">{getInitials(name)}</span>
                        )}
                      </div>
                      <div className="flex-grow min-w-0">
                        <p className="text-sm font-semibold text-primary truncate">
                          {name}
                          {a.dob && <span className="font-normal text-muted"> · {formatAge(a.dob)}</span>}
                        </p>
                        {a.handle && <p className="text-xs text-muted truncate">@{a.handle}</p>}
                      </div>
                      {a.pendingPostCount + (a.pendingCommentCount ?? 0) > 0 && (
                        <Link
                          href={`/app/guardian/approvals?athlete=${a.id}`}
                          className="shrink-0 min-w-[24px] h-6 px-2 inline-flex items-center justify-center rounded-full bg-red-600 text-white text-xs font-bold"
                          aria-label={`${a.pendingPostCount + (a.pendingCommentCount ?? 0)} items pending review`}
                        >
                          {a.pendingPostCount + (a.pendingCommentCount ?? 0)}
                        </Link>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 mt-3">
                      {transferred ? (
                        <ChipPill chip={{ label: 'Transferred', tone: 'gray' }} />
                      ) : (
                        <>
                          <ChipPill chip={consentChip(a.consentState)} />
                          <ChipPill chip={loginChip(a.hasLogin)} />
                          <ChipPill chip={visibilityChip(a.visibility)} />
                          <ChipPill chip={messagingChip(a.messaging_permission)} />
                          {a.activeTransfer && (
                            <ChipPill chip={transferStateChip(a.activeTransfer.state as Parameters<typeof transferStateChip>[0])} />
                          )}
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-3">
                      {!transferred && managed && (
                        <button
                          type="button"
                          onClick={() => setActiveProfile(isActive ? null : managed)}
                          className={`px-3 py-2 min-h-[44px] inline-flex items-center gap-2 rounded-lg text-sm font-semibold transition-colors ${
                            isActive
                              ? 'bg-brand text-white hover:bg-brand-hover'
                              : 'border border-border-strong text-secondary hover:bg-surface-muted'
                          }`}
                        >
                          <i className={`fas ${isActive ? 'fa-circle-check' : 'fa-right-left'} text-xs`}></i>
                          {isActive ? 'Posting as — switch back' : 'Post as'}
                        </button>
                      )}
                      <Link
                        href={`/athlete/${a.id}`}
                        className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors"
                      >
                        View profile
                      </Link>
                      {!transferred && (
                        <Link
                          href={`/app/guardian/athlete/${a.id}`}
                          className="px-3 py-2 min-h-[44px] inline-flex items-center gap-2 border border-violet-300 dark:border-violet-800 rounded-lg text-sm font-semibold text-brand-fg-strong hover:bg-brand-soft transition-colors"
                        >
                          <i className="fas fa-sliders text-xs"></i>
                          Manage
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </>
        )}
      </main>
    </div>
  );
}
