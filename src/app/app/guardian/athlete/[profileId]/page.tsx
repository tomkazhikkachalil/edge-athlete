'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import { isOptimizableImageSrc } from '@/lib/media/image-src';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import AppHeader from '@/components/AppHeader';
import ConfirmModal from '@/components/ConfirmModal';
import { FEATURE_FLAGS } from '@/lib/features';
import { formatDisplayName, getInitials, formatAge } from '@/lib/formatters';
import { transferStateChip } from '@/lib/transfer-ui';
import {
  consentChip,
  loginChip,
  type Chip,
} from '@/lib/guardian-rollup';
import {
  VISIBILITY_OPTIONS,
  MESSAGING_OPTIONS,
  COMMENT_MODERATION_OPTIONS,
  type Visibility,
  type MessagingPermission,
  type CommentModeration,
} from '@/lib/profile-privacy';
import type { ConsentState } from '@/lib/consent';

interface GuardianRow {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  since: string | null;
}

interface PendingInvite {
  id: string;
  invited_email: string;
  expires_at: string;
}

// ── Per-athlete management ────────────────────────────────────────────────────
// One athlete's custody view: identity, live safety controls (the PATCH this
// page drives is the only way a guardian changes these after creation), and
// the doors into consent, login credentials, and transfer — pages that used
// to be reachable only from the creation funnel.

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
  comment_moderation: string | null;
  consentState: ConsentState;
  hasLogin: boolean;
  pendingPostCount: number;
  activeTransfer: { state: string } | null;
}

const CHIP_TONES = {
  violet: 'bg-violet-100 dark:bg-violet-950/60 text-brand-fg-strong',
  amber: 'bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300',
  gray: 'bg-surface-sunken text-tertiary',
} as const;

function ChipPill({ chip }: { chip: Chip }) {
  return (
    <span className={`text-xs font-medium px-2.5 py-1 rounded-full shrink-0 ${CHIP_TONES[chip.tone]}`}>
      {chip.label}
    </span>
  );
}

function RadioCard<V extends string>({
  option,
  selected,
  disabled,
  onSelect,
}: {
  option: { value: V; label: string; description: string };
  selected: boolean;
  disabled: boolean;
  onSelect: (value: V) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(option.value)}
      disabled={disabled}
      className={`w-full text-left p-3 rounded-lg border-2 transition-all disabled:opacity-60 ${
        selected ? 'border-brand bg-brand-soft' : 'border-border hover:border-border-strong'
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`mt-0.5 w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ${
            selected ? 'border-brand bg-brand' : 'border-border-strong'
          }`}
        >
          {selected && <i className="fas fa-check text-white text-xs"></i>}
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-primary text-sm mb-0.5">{option.label}</h4>
          <p className="text-xs text-tertiary">{option.description}</p>
        </div>
      </div>
    </button>
  );
}

export default function GuardianAthletePage() {
  const params = useParams();
  const router = useRouter();
  const profileId = params.profileId as string;
  const { user, loading, initialAuthCheckComplete } = useAuth();
  const { showSuccess, showError } = useToast();
  const [state, setState] = useState<'loading' | 'ready'>('loading');
  const [athlete, setAthlete] = useState<ConsoleAthlete | null>(null);
  const [saving, setSaving] = useState(false);

  // Co-guardian lifecycle (Round 3): the custody links + pending invites.
  const [guardians, setGuardians] = useState<GuardianRow[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  const [manualInviteUrl, setManualInviteUrl] = useState('');
  const [removeTarget, setRemoveTarget] = useState<GuardianRow | null>(null);
  const [removing, setRemoving] = useState(false);

  const refetchGuardians = useCallback(async () => {
    try {
      const res = await fetch(`/api/guardian/athletes/${profileId}/guardians`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setGuardians(data.guardians ?? []);
        setPendingInvites(data.pendingInvites ?? []);
      }
    } catch {
      // The section is informational — a failed load must not break the page.
    }
  }, [profileId]);

  useEffect(() => {
    if (!loading && initialAuthCheckComplete && !user) router.replace('/');
  }, [user, loading, initialAuthCheckComplete, router]);

  useEffect(() => {
    if (!user || !profileId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/guardian/athletes');
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        const found = (data.athletes ?? []).find((a: ConsoleAthlete) => a.id === profileId) ?? null;
        setAthlete(found);
      } catch {
        if (!cancelled) setAthlete(null);
      } finally {
        if (!cancelled) setState('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, profileId]);

  useEffect(() => {
    if (!user || !profileId) return;
    // Inlined cancellable IIFE (house pattern) — the async hop also keeps the
    // set-state-in-effect rule honest about no synchronous setState here.
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/guardian/athletes/${profileId}/guardians`);
        const data = await res.json().catch(() => ({}));
        if (cancelled || !res.ok) return;
        setGuardians(data.guardians ?? []);
        setPendingInvites(data.pendingInvites ?? []);
      } catch {
        // informational section — never break the page
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, profileId]);

  const submitInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (inviteBusy || !inviteEmail.trim()) return;
    setInviteBusy(true);
    setManualInviteUrl('');
    try {
      const res = await fetch(`/api/guardian/athletes/${profileId}/guardians`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send the invite');
      setInviteEmail('');
      if (data.emailSent) {
        showSuccess('Invite sent', 'They have 7 days to accept.');
      } else {
        // Send failed OR SMTP unset — either way the URL is the reliable
        // channel; never claim a configuration problem we can't see.
        setManualInviteUrl(data.inviteUrl ?? '');
        showSuccess('Invite created', "We couldn't email it — share the link below.");
      }
      refetchGuardians();
    } catch (err) {
      showError('Invite failed', err instanceof Error ? err.message : 'Please try again');
    } finally {
      setInviteBusy(false);
    }
  };

  const [avatarBusy, setAvatarBusy] = useState(false);
  const uploadAthleteAvatar = async (file: File) => {
    if (!athlete || avatarBusy) return;
    setAvatarBusy(true);
    try {
      const fd = new FormData();
      fd.append('avatar', file);
      fd.append('targetProfileId', athlete.id);
      const res = await fetch('/api/upload/avatar', { method: 'POST', body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Upload failed');
      setAthlete({ ...athlete, avatar_url: data.avatar_url });
      showSuccess('Photo updated', `${athlete.first_name || 'Their'} profile photo is live.`);
    } catch (e) {
      showError('Photo not updated', e instanceof Error ? e.message : 'Please try again');
    } finally {
      setAvatarBusy(false);
    }
  };

  // Cancel + re-invite the same address; the POST returns the fresh URL,
  // which the manual-link block displays (component state — a refresh loses
  // it, hence the affordance instead of trying to re-derive a token).
  const regenInvite = async (inviteId: string, email: string) => {
    if (inviteBusy) return;
    setInviteBusy(true);
    try {
      await fetch(`/api/guardian/athletes/${profileId}/guardians`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteId }),
      });
      const res = await fetch(`/api/guardian/athletes/${profileId}/guardians`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not create a new link');
      setManualInviteUrl(data.inviteUrl ?? '');
      showSuccess('New link ready', data.emailSent ? 'Also emailed to them.' : 'Share the link below.');
      refetchGuardians();
    } catch (err) {
      showError('Could not get a new link', err instanceof Error ? err.message : 'Please try again');
    } finally {
      setInviteBusy(false);
    }
  };

  const cancelInvite = async (inviteId: string) => {
    try {
      const res = await fetch(`/api/guardian/athletes/${profileId}/guardians`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not cancel the invite');
      showSuccess('Invite cancelled', 'You can invite someone else any time.');
      refetchGuardians();
    } catch (err) {
      showError('Cancel failed', err instanceof Error ? err.message : 'Please try again');
    }
  };

  const confirmRemove = async () => {
    if (!removeTarget || removing) return;
    setRemoving(true);
    try {
      const res = await fetch(`/api/guardian/athletes/${profileId}/guardians`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guardianUserId: removeTarget.user_id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not remove the guardian');
      const removedSelf = removeTarget.user_id === user?.id;
      setRemoveTarget(null);
      showSuccess('Guardian removed', removedSelf ? 'You no longer manage this athlete.' : undefined);
      if (removedSelf) {
        // No longer a guardian of this profile — the console is the way out.
        router.replace('/app/guardian');
        return;
      }
      refetchGuardians();
    } catch (err) {
      showError('Remove failed', err instanceof Error ? err.message : 'Please try again');
    } finally {
      setRemoving(false);
    }
  };

  // Optimistic safety change with revert — the 403 consent-gate message from
  // the server is surfaced verbatim so the guardian learns the WHY.
  const applySafety = async (patch: {
    visibility?: Visibility;
    messaging_permission?: MessagingPermission;
    comment_moderation?: CommentModeration;
  }) => {
    if (!athlete || saving) return;
    const before = athlete;
    setAthlete({ ...athlete, ...patch });
    setSaving(true);
    try {
      const res = await fetch(`/api/guardian/athletes/${athlete.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not save the change');
      showSuccess('Saved', 'Safety settings updated.');
    } catch (e) {
      setAthlete(before);
      showError('Not saved', e instanceof Error ? e.message : 'Please try again');
    } finally {
      setSaving(false);
    }
  };

  if (!FEATURE_FLAGS.FEATURE_GUARDIAN_PROFILES || loading || !initialAuthCheckComplete || !user) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  const name = athlete
    ? formatDisplayName(athlete.first_name, null, athlete.last_name, athlete.display_name)
    : '';
  const transferred = athlete?.supervision_state === 'self';

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <main className="max-w-2xl mx-auto px-4 py-8">
        <Link
          href="/app/guardian"
          className="inline-flex items-center gap-2 text-sm font-semibold text-brand-fg-strong hover:text-violet-800 dark:hover:text-violet-300 mb-4 min-h-[44px]"
        >
          <i className="fas fa-chevron-left text-xs"></i>
          Family console
        </Link>

        {state === 'loading' ? (
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-brand mx-auto my-12"></div>
        ) : !athlete ? (
          <div className="bg-surface border border-border rounded-lg p-6 text-center">
            <h1 className="text-h3 font-bold text-primary mb-2">Not one of your athletes</h1>
            <p className="text-sm text-tertiary mb-4">
              This profile isn&apos;t managed by your account.
            </p>
            <Link
              href="/app/guardian"
              className="inline-flex items-center px-4 py-2 min-h-[44px] bg-brand text-white rounded-lg font-semibold hover:bg-brand-hover"
            >
              Back to the console
            </Link>
          </div>
        ) : (
          <>
            {/* Identity */}
            <div className="flex items-center gap-4 mb-6">
              <div className="relative w-16 h-16 rounded-full overflow-hidden bg-violet-100 dark:bg-violet-950/60 flex items-center justify-center shrink-0">
                {athlete.avatar_url ? (
                  <Image
                    src={athlete.avatar_url}
                    alt=""
                    fill
                    sizes="64px"
                    className="object-cover"
                    unoptimized={!isOptimizableImageSrc(athlete.avatar_url)}
                  />
                ) : (
                  <span className="text-lg font-semibold text-brand-fg-strong">{getInitials(name)}</span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h1 className="text-xl font-bold text-primary truncate">{name}</h1>
                <p className="text-sm text-muted truncate">
                  {athlete.handle && <>@{athlete.handle} · </>}
                  {athlete.dob && <>{formatAge(athlete.dob)} · </>}
                  {transferred ? 'Transferred' : 'Supervised'}
                </p>
                {/* Acting-as parity (Round C): children created here have no
                    photo and can't take their own — the guardian sets it. */}
                {!transferred && (
                  <label className={`inline-flex items-center gap-1.5 mt-1 text-xs font-semibold cursor-pointer min-h-[32px] ${avatarBusy ? 'text-muted' : 'text-brand-fg-strong hover:text-violet-800 dark:hover:text-violet-300'}`}>
                    <i className={`fas ${avatarBusy ? 'fa-spinner fa-spin' : 'fa-camera'} text-[11px]`} aria-hidden="true"></i>
                    {athlete.avatar_url ? 'Change photo' : 'Add a photo'}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="sr-only"
                      disabled={avatarBusy}
                      onChange={e => {
                        const f = e.target.files?.[0];
                        if (f) uploadAthleteAvatar(f);
                        e.target.value = '';
                      }}
                    />
                  </label>
                )}
              </div>
            </div>

            {transferred ? (
              <div className="bg-surface border border-border rounded-lg p-6 text-sm text-tertiary">
                This account has been handed over to its owner. They control
                their own settings now.
              </div>
            ) : (
              <>
                {/* Safety */}
                <section className="bg-surface border border-border rounded-lg p-5 mb-4">
                  <h2 className="text-base font-bold text-primary mb-1">Safety</h2>
                  <p className="text-xs text-tertiary mb-4">
                    How the outside world can reach {athlete.first_name || 'this athlete'}.
                    Changes apply immediately.
                  </p>
                  <h3 className="text-sm font-semibold text-secondary mb-2">Profile visibility</h3>
                  <div className="space-y-2 mb-5">
                    {VISIBILITY_OPTIONS.map(option => (
                      <RadioCard
                        key={option.value}
                        option={option}
                        selected={athlete.visibility === option.value}
                        disabled={saving}
                        onSelect={v => applySafety({ visibility: v })}
                      />
                    ))}
                  </div>
                  <h3 className="text-sm font-semibold text-secondary mb-2">Who can send messages</h3>
                  <div className="space-y-2 mb-5">
                    {MESSAGING_OPTIONS.map(option => (
                      <RadioCard
                        key={option.value}
                        option={option}
                        selected={athlete.messaging_permission === option.value}
                        disabled={saving}
                        onSelect={v => applySafety({ messaging_permission: v })}
                      />
                    ))}
                  </div>
                  <h3 className="text-sm font-semibold text-secondary mb-2">Comments they write</h3>
                  <div className="space-y-2">
                    {COMMENT_MODERATION_OPTIONS.map(option => (
                      <RadioCard
                        key={option.value}
                        option={option}
                        selected={(athlete.comment_moderation ?? 'held') === option.value}
                        disabled={saving}
                        onSelect={v => applySafety({ comment_moderation: v })}
                      />
                    ))}
                  </div>
                </section>

                {/* Consent */}
                <section className="bg-surface border border-border rounded-lg p-5 mb-4 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="text-base font-bold text-primary mb-1">Consent</h2>
                    <ChipPill chip={consentChip(athlete.consentState)} />
                  </div>
                  <Link
                    href={`/app/guardian/consent/${athlete.id}`}
                    className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors"
                  >
                    {athlete.consentState === 'approved' ? 'View consent' : 'Complete consent'}
                  </Link>
                </section>

                {/* Login */}
                <section className="bg-surface border border-border rounded-lg p-5 mb-4 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="text-base font-bold text-primary mb-1">Login</h2>
                    <ChipPill chip={loginChip(athlete.hasLogin)} />
                  </div>
                  <Link
                    href={`/app/guardian/credentials/${athlete.id}`}
                    className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors"
                  >
                    {athlete.hasLogin ? 'Manage login' : 'Issue login'}
                  </Link>
                </section>

                {/* Guardians — the custody links themselves (Round 3) */}
                <section className="bg-surface border border-border rounded-lg p-5 mb-4">
                  <h2 className="text-base font-bold text-primary mb-1">Guardians</h2>
                  <p className="text-xs text-tertiary mb-3">
                    Who manages this profile. An athlete can have up to two
                    guardians; there must always be at least one.
                  </p>
                  <ul className="space-y-2 mb-3">
                    {guardians.map(g => {
                      const gName = formatDisplayName(g.first_name, null, g.last_name, g.full_name);
                      const isSelf = g.user_id === user.id;
                      return (
                        <li key={g.user_id} className="flex items-center gap-3">
                          <div className="relative w-8 h-8 rounded-full overflow-hidden bg-violet-100 dark:bg-violet-950/60 flex items-center justify-center shrink-0">
                            {g.avatar_url ? (
                              <Image
                                src={g.avatar_url}
                                alt=""
                                fill
                                sizes="32px"
                                className="object-cover"
                                unoptimized={!isOptimizableImageSrc(g.avatar_url)}
                              />
                            ) : (
                              <span className="text-xs font-semibold text-brand-fg-strong">{getInitials(gName)}</span>
                            )}
                          </div>
                          <div className="min-w-0 flex-grow">
                            <p className="text-sm font-semibold text-primary truncate">
                              {gName}
                              {isSelf && <span className="font-normal text-muted"> (you)</span>}
                            </p>
                            {g.since && (
                              <p className="text-xs text-muted">
                                since {new Date(g.since).toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                              </p>
                            )}
                          </div>
                          {/* Removing is only offered while a second guardian
                              remains — a supervised profile never drops to zero. */}
                          {guardians.length >= 2 && (
                            <button
                              type="button"
                              onClick={() => setRemoveTarget(g)}
                              className="shrink-0 px-3 py-2 min-h-[44px] inline-flex items-center border border-red-300 dark:border-red-800 rounded-lg text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                            >
                              Remove
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>

                  {pendingInvites.map(inv => (
                    <div key={inv.id} className="flex items-center justify-between gap-3 bg-surface-sunken rounded-lg px-3 py-2 mb-2">
                      <p className="text-sm text-secondary min-w-0 truncate">
                        <i className="fas fa-envelope text-xs mr-2 text-muted"></i>
                        {inv.invited_email}
                        <span className="text-xs text-muted"> · invited, expires {new Date(inv.expires_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                      </p>
                      <button
                        type="button"
                        onClick={() => regenInvite(inv.id, inv.invited_email)}
                        disabled={inviteBusy}
                        className="shrink-0 min-h-[44px] px-2 inline-flex items-center text-sm font-semibold text-brand-fg-strong hover:text-violet-800 dark:hover:text-violet-300 transition-colors disabled:opacity-60"
                      >
                        Get new link
                      </button>
                      <button
                        type="button"
                        onClick={() => cancelInvite(inv.id)}
                        className="shrink-0 min-h-[44px] px-2 inline-flex items-center text-sm font-semibold text-secondary hover:text-red-600 transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  ))}

                  {guardians.length < 2 && (
                    <form onSubmit={submitInvite} className="flex flex-wrap items-center gap-2 mt-3">
                      <input
                        type="email"
                        value={inviteEmail}
                        onChange={e => setInviteEmail(e.target.value)}
                        placeholder="Co-guardian's email"
                        aria-label="Co-guardian's email"
                        disabled={inviteBusy}
                        className="flex-grow min-w-[180px] px-3 py-2 min-h-[44px] border border-border-strong rounded-lg text-sm bg-surface text-primary"
                      />
                      <button
                        type="submit"
                        disabled={inviteBusy || !inviteEmail.trim()}
                        className="px-3 py-2 min-h-[44px] inline-flex items-center gap-2 border border-violet-300 dark:border-violet-800 rounded-lg text-sm font-semibold text-brand-fg-strong hover:bg-brand-soft disabled:opacity-60 transition-colors"
                      >
                        <i className={`fas ${inviteBusy ? 'fa-spinner fa-spin' : 'fa-user-plus'} text-xs`}></i>
                        Invite co-guardian
                      </button>
                    </form>
                  )}

                  {manualInviteUrl && (
                    <div className="mt-3 text-xs text-tertiary">
                      We couldn&apos;t email this invite — share the link with
                      them directly (valid 7 days):
                      <code className="block mt-1 p-2 bg-surface-sunken rounded select-all break-all">{manualInviteUrl}</code>
                    </div>
                  )}
                </section>

                {/* Transfer */}
                <section className="bg-surface border border-border rounded-lg p-5 mb-4 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <h2 className="text-base font-bold text-primary mb-1">Account transfer</h2>
                    <ChipPill
                      chip={
                        athlete.activeTransfer
                          ? transferStateChip(athlete.activeTransfer.state as Parameters<typeof transferStateChip>[0])
                          : { label: 'Supervised', tone: 'gray' }
                      }
                    />
                  </div>
                  <Link
                    href={`/app/transfer/${athlete.id}`}
                    className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors"
                  >
                    {athlete.activeTransfer ? 'View transfer' : 'Hand over the account'}
                  </Link>
                </section>

                {/* Danger zone */}
                <section className="border border-red-200 dark:border-red-900 rounded-lg p-5">
                  <h2 className="text-base font-bold text-red-600 dark:text-red-400 mb-1">Danger zone</h2>
                  <p className="text-xs text-tertiary mb-3">
                    Withdrawing consent permanently deletes this profile and all
                    of its content.
                  </p>
                  <Link
                    href={`/app/guardian/credentials/${athlete.id}`}
                    className="inline-flex items-center px-3 py-2 min-h-[44px] border border-red-300 dark:border-red-800 rounded-lg text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                  >
                    Withdraw consent &amp; delete
                  </Link>
                </section>
              </>
            )}
          </>
        )}
      </main>

      <ConfirmModal
        isOpen={!!removeTarget}
        title={removeTarget?.user_id === user?.id ? 'Stop managing this athlete?' : 'Remove this guardian?'}
        message={
          removeTarget?.user_id === user?.id
            ? `You'll no longer manage ${athlete?.first_name || 'this athlete'}'s profile. The other guardian keeps full custody.`
            : `${removeTarget ? formatDisplayName(removeTarget.first_name, null, removeTarget.last_name, removeTarget.full_name) : ''} will no longer manage ${athlete?.first_name || 'this athlete'}'s profile. You keep full custody.`
        }
        confirmText={removing ? 'Removing…' : 'Remove'}
        onConfirm={confirmRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
