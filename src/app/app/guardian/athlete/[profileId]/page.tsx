'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import dynamic from 'next/dynamic';
import type { Profile } from '@/lib/supabase';
import { isOptimizableImageSrc } from '@/lib/media/image-src';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import AppHeader from '@/components/AppHeader';
import ConfirmModal from '@/components/ConfirmModal';
import { FEATURE_FLAGS } from '@/lib/features';
import { formatDisplayName, getInitials, formatAge } from '@/lib/formatters';
import { transferStateChip } from '@/lib/transfer-ui';
import {
  buildSetupChecklist,
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

const EditProfileTabs = dynamic(() => import('@/components/EditProfileTabs'), { ssr: false });
const BlockedUsersList = dynamic(() => import('@/components/settings/BlockedUsersList'), { ssr: false });
const ContactsSection = dynamic(() => import('@/components/guardian/ContactsSection'), { ssr: false });

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

interface FanProfile {
  id: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
  handle: string | null;
}

interface FollowRequestRow {
  id: string;
  message: string | null;
  created_at: string;
  follower: FanProfile;
}

interface FollowerRow {
  id: string;
  created_at: string;
  follower: FanProfile;
}

interface TagRow {
  id: string;
  post_id: string;
  created_at: string;
  created_by: FanProfile | null;
}

interface ChildEvent {
  id: string;
  title: string;
  location: string | null;
  starts_at: string;
  ends_at: string;
  all_day: boolean;
  my_status?: string;
  is_organizer?: boolean;
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
  const { user, loading, initialAuthCheckComplete, refreshManagedProfiles } = useAuth();
  const { showSuccess, showError } = useToast();
  const [state, setState] = useState<'loading' | 'ready'>('loading');
  const [athlete, setAthlete] = useState<ConsoleAthlete | null>(null);
  // Round D: a failed roster fetch is an ERROR, not "not one of your
  // athletes" — the two used to collapse into the same screen.
  const [loadError, setLoadError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [saving, setSaving] = useState(false);
  // ?contact= highlight for the escalation deep-link (Wave 3). Mount-only
  // window.location read — the feed ?create precedent, no Suspense wrap.
  const [highlightContactId, setHighlightContactId] = useState<string | null>(null);
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('contact');
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (id) setHighlightContactId(id);
  }, []);
  // Danger zone (consent withdrawal = permanent deletion) — inline typed
  // confirm; this page used to send guardians to the credentials screen.
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // Co-guardian lifecycle (Round 3): the custody links + pending invites.
  const [guardians, setGuardians] = useState<GuardianRow[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInvite[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteBusy, setInviteBusy] = useState(false);
  // Cancelling breaks a link that may already be in the other parent's
  // hands, and it sits one tap from "Get new link" — confirm it
  // (dummy-proofing round).
  const [cancelInviteTarget, setCancelInviteTarget] = useState<{ id: string; email: string } | null>(null);
  const [manualInviteUrl, setManualInviteUrl] = useState('');
  const [removeTarget, setRemoveTarget] = useState<GuardianRow | null>(null);
  const [removing, setRemoving] = useState(false);

  // Fans section (Round G): pending requests + accepted fans, guardian-side.
  const [followRequests, setFollowRequests] = useState<FollowRequestRow[]>([]);
  const [fans, setFans] = useState<FollowerRow[]>([]);
  const [followBusy, setFollowBusy] = useState<string | null>(null);
  const [removeFanTarget, setRemoveFanTarget] = useState<FollowerRow | null>(null);
  const [removingFan, setRemovingFan] = useState(false);

  // Edit profile (Round H): the standard editor modal in acting-as mode.
  const [editOpen, setEditOpen] = useState(false);
  const [editLoading, setEditLoading] = useState(false);
  const [childProfile, setChildProfile] = useState<Profile | null>(null);

  const refreshChildProfile = useCallback(async () => {
    try {
      const res = await fetch(`/api/profile?id=${profileId}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.profile) setChildProfile(data.profile as Profile);
    } catch {
      // modal keeps its current seed — next open refetches
    }
  }, [profileId]);

  // Tags (Round H): what the child is tagged in, with guardian remove.
  const [tags, setTags] = useState<TagRow[]>([]);
  const [removeTagTarget, setRemoveTagTarget] = useState<TagRow | null>(null);
  const [removingTag, setRemovingTag] = useState(false);

  const refetchTags = useCallback(async () => {
    try {
      const res = await fetch(`/api/tags?profileId=${profileId}`);
      const data = await res.json().catch(() => ({}));
      if (res.ok) setTags(data.tags ?? []);
    } catch {
      // informational section — never break the page
    }
  }, [profileId]);

  // Calendar (Round I): read-only view of the child's next two weeks.
  const [childEvents, setChildEvents] = useState<ChildEvent[]>([]);
  const [decliningId, setDecliningId] = useState<string | null>(null);

  const refetchCalendar = useCallback(async () => {
    if (!FEATURE_FLAGS.FEATURE_CALENDAR) return;
    try {
      const from = new Date();
      const to = new Date(Date.now() + 14 * 86_400_000);
      const res = await fetch(
        `/api/calendar/events?from=${from.toISOString()}&to=${to.toISOString()}&targetProfileId=${profileId}`
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        // The overlay entries (completed activities) lack my_status — the
        // schedule card shows real events only.
        setChildEvents(
          ((data.events ?? []) as ChildEvent[]).filter(ev => ev.my_status !== undefined)
        );
      }
    } catch {
      // informational section — never break the page
    }
  }, [profileId]);

  const declineEvent = async (ev: ChildEvent) => {
    if (decliningId) return;
    setDecliningId(ev.id);
    try {
      const res = await fetch(`/api/calendar/events/${ev.id}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'declined', targetProfileId: profileId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not decline');
      showSuccess('Declined', 'The organizer will see the change.');
      refetchCalendar();
    } catch (err) {
      showError('Something went wrong', err instanceof Error ? err.message : 'Please try again');
    } finally {
      setDecliningId(null);
    }
  };

  const refetchFans = useCallback(async () => {
    try {
      const [reqRes, fanRes] = await Promise.all([
        fetch(`/api/followers?type=requests&profileId=${profileId}`),
        fetch(`/api/followers?type=followers&profileId=${profileId}`),
      ]);
      const reqData = await reqRes.json().catch(() => ({}));
      const fanData = await fanRes.json().catch(() => ({}));
      if (reqRes.ok) setFollowRequests(reqData.requests ?? []);
      if (fanRes.ok) setFans(fanData.followers ?? []);
    } catch {
      // informational section — never break the page
    }
  }, [profileId]);

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
        if (!res.ok) throw new Error(data.error || 'Could not load');
        if (cancelled) return;
        const found = (data.athletes ?? []).find((a: ConsoleAthlete) => a.id === profileId) ?? null;
        setAthlete(found);
        setLoadError(false);
      } catch {
        if (!cancelled) { setAthlete(null); setLoadError(true); }
      } finally {
        if (!cancelled) setState('ready');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, profileId, retryKey]);

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

  useEffect(() => {
    if (!user || !profileId) return;
    // Async hop (house pattern) — keeps set-state-in-effect honest about no
    // synchronous setState on the effect path.
    (async () => {
      await Promise.all([refetchFans(), refetchTags(), refetchCalendar()]);
    })();
  }, [user, profileId, refetchFans, refetchTags, refetchCalendar]);

  const openEditProfile = async () => {
    if (editLoading) return;
    setEditLoading(true);
    try {
      const res = await fetch(`/api/profile?id=${profileId}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.profile) throw new Error(data.error || 'Could not load the profile');
      setChildProfile(data.profile as Profile);
      setEditOpen(true);
    } catch (err) {
      showError('Something went wrong', err instanceof Error ? err.message : 'Please try again');
    } finally {
      setEditLoading(false);
    }
  };

  const removeTag = async () => {
    if (!removeTagTarget || removingTag) return;
    setRemovingTag(true);
    try {
      const res = await fetch(`/api/tags?tagId=${removeTagTarget.id}`, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not remove this tag');
      showSuccess('Tag removed');
      setRemoveTagTarget(null);
      refetchTags();
    } catch (err) {
      showError('Something went wrong', err instanceof Error ? err.message : 'Please try again');
    } finally {
      setRemovingTag(false);
    }
  };

  const decideFollowRequest = async (row: FollowRequestRow, action: 'accept' | 'reject') => {
    if (followBusy) return;
    setFollowBusy(row.id);
    try {
      const res = await fetch('/api/followers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, followId: row.id, profileId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not update the request');
      showSuccess(action === 'accept' ? 'Request approved' : 'Request declined');
      refetchFans();
    } catch (err) {
      showError('Something went wrong', err instanceof Error ? err.message : 'Please try again');
    } finally {
      setFollowBusy(null);
    }
  };

  const removeFan = async () => {
    if (!removeFanTarget || removingFan) return;
    setRemovingFan(true);
    try {
      const res = await fetch('/api/follow', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'remove_fan',
          fanId: removeFanTarget.follower.id,
          targetProfileId: profileId,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not remove this fan');
      showSuccess('Fan removed');
      setRemoveFanTarget(null);
      refetchFans();
    } catch (err) {
      showError('Something went wrong', err instanceof Error ? err.message : 'Please try again');
    } finally {
      setRemovingFan(false);
    }
  };

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

  // Same typed-confirm contract as the credentials page's danger zone: the
  // server re-checks confirmHandle, this gate just keeps the button honest.
  const expectedDeleteConfirm = (athlete?.handle || athlete?.first_name || '').toLowerCase();
  const deleteConfirmMatches =
    !!expectedDeleteConfirm &&
    deleteConfirm.trim().toLowerCase().replace(/^@/, '') === expectedDeleteConfirm;

  const handleDelete = async () => {
    setDeleteError('');
    setDeleteBusy(true);
    try {
      const res = await fetch(`/api/guardian/athletes/${profileId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmHandle: deleteConfirm }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setDeleteError(data.error || 'Could not delete the profile.'); return; }
      await refreshManagedProfiles();
      showSuccess('Deletion scheduled', 'The profile is hidden now and permanently deleted in 30 days. Restore it from the console until then.');
      router.replace('/app/guardian');
    } catch {
      setDeleteError('Could not delete the profile. Please try again.');
    } finally {
      setDeleteBusy(false);
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
        ) : loadError ? (
          <div className="bg-surface border border-border rounded-lg p-6 text-center">
            <h1 className="text-h3 font-bold text-primary mb-2">Couldn&apos;t load this athlete</h1>
            <p role="alert" className="text-sm text-tertiary mb-4">
              Something went wrong on our side — your athletes are unaffected.
            </p>
            <button
              type="button"
              onClick={() => { setState('loading'); setRetryKey(k => k + 1); }}
              className="inline-flex items-center gap-2 px-4 py-2 min-h-[44px] bg-brand text-white rounded-lg font-semibold hover:bg-brand-hover"
            >
              <i className="fas fa-rotate-right text-xs"></i>
              Try again
            </button>
          </div>
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
                  <div className="flex flex-wrap items-center gap-x-4">
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
                    {/* Capture sibling (capture-everywhere round): the
                        guardian photographs the athlete, so rear camera.
                        Broad accept on purpose — capture + narrow MIME is
                        unreliable on Android; the upload route re-checks. */}
                    <label className={`inline-flex items-center gap-1.5 mt-1 text-xs font-semibold cursor-pointer min-h-[32px] ${avatarBusy ? 'text-muted' : 'text-brand-fg-strong hover:text-violet-800 dark:hover:text-violet-300'}`}>
                      <i className="fas fa-camera text-[11px]" aria-hidden="true"></i>
                      Take photo
                      <input
                        type="file"
                        accept="image/*"
                        capture="environment"
                        className="sr-only"
                        disabled={avatarBusy}
                        onChange={e => {
                          const f = e.target.files?.[0];
                          if (f) uploadAthleteAvatar(f);
                          e.target.value = '';
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      onClick={openEditProfile}
                      disabled={editLoading}
                      className={`inline-flex items-center gap-1.5 mt-1 text-xs font-semibold min-h-[32px] ${editLoading ? 'text-muted' : 'text-brand-fg-strong hover:text-violet-800 dark:hover:text-violet-300'}`}
                    >
                      <i className={`fas ${editLoading ? 'fa-spinner fa-spin' : 'fa-pen'} text-[11px]`} aria-hidden="true"></i>
                      Edit profile
                    </button>
                  </div>
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
                {/* Setup checklist (Round J): disappears once complete. */}
                {(() => {
                  const steps = buildSetupChecklist(athlete.consentState, athlete.hasLogin, athlete.id);
                  if (!steps) return null;
                  return (
                    <section className="bg-brand-soft border border-violet-200 dark:border-violet-800 rounded-lg p-5 mb-4">
                      <h2 className="text-base font-bold text-violet-900 dark:text-violet-200 mb-3">
                        Finish setting up
                      </h2>
                      <ul className="space-y-2">
                        {steps.map(step => (
                          <li key={step.key} className="flex items-center gap-2.5 text-sm">
                            <i
                              className={`fas ${
                                step.state === 'done'
                                  ? 'fa-circle-check text-green-600 dark:text-green-400'
                                  : step.state === 'waiting'
                                  ? 'fa-clock text-amber-600 dark:text-amber-400'
                                  : 'fa-circle text-violet-300 dark:text-violet-700'
                              }`}
                              aria-hidden="true"
                            ></i>
                            {step.href && step.state !== 'done' ? (
                              <Link
                                href={step.href}
                                className="text-violet-900 dark:text-violet-200 font-medium hover:underline min-h-[32px] inline-flex items-center"
                              >
                                {step.label}
                              </Link>
                            ) : (
                              <span className={step.state === 'done' ? 'text-tertiary' : 'text-violet-900 dark:text-violet-200'}>
                                {step.label}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })()}

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

                {/* Fans (Round G): either the athlete or a guardian decides */}
                <section className="bg-surface border border-border rounded-lg p-5 mb-4">
                  <h2 className="text-base font-bold text-primary mb-1">Fans</h2>
                  <p className="text-xs text-tertiary mb-4">
                    Who follows {athlete.first_name || 'this athlete'}. You and they can both
                    approve requests; only you can remove a fan.
                  </p>

                  {followRequests.length > 0 && (
                    <>
                      <h3 className="text-sm font-semibold text-secondary mb-2">
                        Waiting for approval
                      </h3>
                      <ul className="space-y-2 mb-5">
                        {followRequests.map(row => {
                          const name = formatDisplayName(
                            row.follower.first_name, row.follower.middle_name,
                            row.follower.last_name, row.follower.full_name
                          );
                          return (
                            <li key={row.id} className="flex items-center gap-3 border border-border rounded-lg p-3">
                              <div className="relative w-9 h-9 rounded-full overflow-hidden bg-violet-100 dark:bg-violet-950/60 flex items-center justify-center shrink-0">
                                {row.follower.avatar_url ? (
                                  <Image
                                    src={row.follower.avatar_url}
                                    alt=""
                                    fill
                                    sizes="36px"
                                    className="object-cover"
                                    unoptimized={!isOptimizableImageSrc(row.follower.avatar_url)}
                                  />
                                ) : (
                                  <span className="text-xs font-semibold text-brand-fg-strong">{getInitials(name)}</span>
                                )}
                              </div>
                              <div className="flex-grow min-w-0">
                                <p className="text-sm font-medium text-primary truncate">{name}</p>
                                {row.follower.handle && (
                                  <p className="text-xs text-muted truncate">@{row.follower.handle}</p>
                                )}
                                {row.message && (
                                  <p className="text-xs text-tertiary truncate">“{row.message}”</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2 shrink-0">
                                <button
                                  type="button"
                                  disabled={followBusy === row.id}
                                  onClick={() => decideFollowRequest(row, 'accept')}
                                  className="px-3 py-2 min-h-[44px] inline-flex items-center bg-brand hover:bg-brand-hover text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                                >
                                  Approve
                                </button>
                                <button
                                  type="button"
                                  disabled={followBusy === row.id}
                                  onClick={() => decideFollowRequest(row, 'reject')}
                                  className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors disabled:opacity-50"
                                >
                                  Decline
                                </button>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </>
                  )}

                  <h3 className="text-sm font-semibold text-secondary mb-2">
                    Current fans{fans.length > 0 ? ` (${fans.length})` : ''}
                  </h3>
                  {fans.length === 0 ? (
                    <p className="text-sm text-muted">No fans yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {fans.map(row => {
                        const name = formatDisplayName(
                          row.follower.first_name, row.follower.middle_name,
                          row.follower.last_name, row.follower.full_name
                        );
                        return (
                          <li key={row.id} className="flex items-center gap-3 border border-border rounded-lg p-3">
                            <div className="relative w-9 h-9 rounded-full overflow-hidden bg-violet-100 dark:bg-violet-950/60 flex items-center justify-center shrink-0">
                              {row.follower.avatar_url ? (
                                <Image
                                  src={row.follower.avatar_url}
                                  alt=""
                                  fill
                                  sizes="36px"
                                  className="object-cover"
                                  unoptimized={!isOptimizableImageSrc(row.follower.avatar_url)}
                                />
                              ) : (
                                <span className="text-xs font-semibold text-brand-fg-strong">{getInitials(name)}</span>
                              )}
                            </div>
                            <div className="flex-grow min-w-0">
                              <p className="text-sm font-medium text-primary truncate">{name}</p>
                              {row.follower.handle && (
                                <p className="text-xs text-muted truncate">@{row.follower.handle}</p>
                              )}
                            </div>
                            <button
                              type="button"
                              onClick={() => setRemoveFanTarget(row)}
                              className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors shrink-0"
                            >
                              Remove
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                {/* Tags (Round H): visibility + veto — see what the child is
                    tagged in, remove any of it. */}
                <section className="bg-surface border border-border rounded-lg p-5 mb-4">
                  <h2 className="text-base font-bold text-primary mb-1">Tags</h2>
                  <p className="text-xs text-tertiary mb-4">
                    Posts {athlete.first_name || 'this athlete'} is tagged in. You&apos;re
                    notified when someone new tags them.
                  </p>
                  {tags.length === 0 ? (
                    <p className="text-sm text-muted">No active tags.</p>
                  ) : (
                    <ul className="space-y-2">
                      {tags.map(tag => {
                        const tagger = tag.created_by
                          ? formatDisplayName(
                              tag.created_by.first_name, tag.created_by.middle_name,
                              tag.created_by.last_name, tag.created_by.full_name
                            )
                          : 'Someone';
                        return (
                          <li key={tag.id} className="flex items-center gap-3 border border-border rounded-lg p-3">
                            <div className="flex-grow min-w-0">
                              <p className="text-sm font-medium text-primary truncate">
                                Tagged by {tagger}
                              </p>
                              <p className="text-xs text-muted">
                                {new Date(tag.created_at).toLocaleDateString()}
                              </p>
                            </div>
                            <Link
                              href={`/feed?post=${tag.post_id}`}
                              className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors shrink-0"
                            >
                              View post
                            </Link>
                            <button
                              type="button"
                              onClick={() => setRemoveTagTarget(tag)}
                              className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors shrink-0"
                            >
                              Remove
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </section>

                {/* Contacts roster (Wave 3): who they talk to — before the
                    block list, so the narrative reads "who → who's blocked". */}
                <ContactsSection
                  profileId={athlete.id}
                  subjectName={athlete.first_name || 'this athlete'}
                  highlightId={highlightContactId}
                />

                {/* Blocked users (Round I): per-contact protection */}
                <section className="bg-surface border border-border rounded-lg p-5 mb-4">
                  <h2 className="text-base font-bold text-primary mb-1">Blocked users</h2>
                  <p className="text-xs text-tertiary mb-4">
                    People blocked here can&apos;t message {athlete.first_name || 'this athlete'};
                    blocking also closes any conversation they had.
                  </p>
                  <BlockedUsersList
                    profileId={athlete.id}
                    canAdd
                    subjectName={athlete.first_name || 'this athlete'}
                  />
                </section>

                {/* Calendar (Round I): read-only schedule + decline */}
                {FEATURE_FLAGS.FEATURE_CALENDAR && (
                  <section className="bg-surface border border-border rounded-lg p-5 mb-4">
                    <h2 className="text-base font-bold text-primary mb-1">Calendar</h2>
                    <p className="text-xs text-tertiary mb-4">
                      {athlete.first_name || 'This athlete'}&apos;s next two weeks. You&apos;re
                      notified when someone invites them; you can decline for them. Your own
                      calendar sync link includes their events too.
                    </p>
                    {childEvents.length === 0 ? (
                      <p className="text-sm text-muted">Nothing scheduled in the next two weeks.</p>
                    ) : (
                      <ul className="space-y-2">
                        {childEvents.map(ev => (
                          <li key={ev.id} className="flex items-center gap-3 border border-border rounded-lg p-3">
                            <div className="flex-grow min-w-0">
                              <p className="text-sm font-medium text-primary truncate">{ev.title}</p>
                              <p className="text-xs text-muted truncate">
                                {new Date(ev.starts_at).toLocaleString(undefined, {
                                  weekday: 'short', month: 'short', day: 'numeric',
                                  ...(ev.all_day ? {} : { hour: 'numeric', minute: '2-digit' }),
                                })}
                                {ev.location ? ` · ${ev.location}` : ''}
                                {ev.is_organizer
                                  ? ' · organizer'
                                  : ev.my_status === 'invited'
                                  ? ' · invited'
                                  : ev.my_status === 'accepted'
                                  ? ' · going'
                                  : ev.my_status === 'maybe'
                                  ? ' · maybe'
                                  : ''}
                              </p>
                            </div>
                            {!ev.is_organizer && ev.my_status !== 'declined' && (
                              <button
                                type="button"
                                disabled={decliningId === ev.id}
                                onClick={() => declineEvent(ev)}
                                className="px-3 py-2 min-h-[44px] inline-flex items-center border border-border-strong rounded-lg text-sm font-semibold text-secondary hover:bg-surface-muted transition-colors disabled:opacity-50 shrink-0"
                              >
                                {decliningId === ev.id ? 'Declining…' : 'Decline'}
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </section>
                )}

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
                        onClick={() => setCancelInviteTarget({ id: inv.id, email: inv.invited_email })}
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

                {/* Danger zone — the confirm lives HERE now (Round D); this
                    used to link to the credentials screen, of all places. */}
                <section className="border border-red-200 dark:border-red-900 rounded-lg p-5">
                  <h2 className="text-base font-bold text-red-600 dark:text-red-400 mb-1">Danger zone</h2>
                  <p className="text-xs text-tertiary mb-3">
                    Withdrawing consent deletes this profile and all of its
                    content, after a 30-day window in which you can restore it.
                  </p>
                  {!deleteOpen ? (
                    <button
                      type="button"
                      onClick={() => { setDeleteOpen(true); setDeleteConfirm(''); setDeleteError(''); }}
                      className="inline-flex items-center px-3 py-2 min-h-[44px] border border-red-300 dark:border-red-800 rounded-lg text-sm font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/40 transition-colors"
                    >
                      Withdraw consent &amp; delete
                    </button>
                  ) : (
                    <div>
                      <p className="text-sm text-secondary mb-2">
                        This hides {athlete.first_name ?? 'this athlete'}&apos;s profile immediately and
                        permanently deletes the profile, posts, media, and login after 30 days.
                        <span className="font-medium"> You can restore it from the console during that window; after it, deletion cannot be undone.</span>
                      </p>
                      <p className="text-xs text-muted mb-3">
                        Signed consent records are retained as required for compliance.
                      </p>
                      {deleteError && (
                        <div role="alert" className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm mb-3">
                          {deleteError}
                        </div>
                      )}
                      <label htmlFor="delete-confirm" className="block text-sm font-medium text-secondary mb-1">
                        Type <span className="font-mono text-red-700 dark:text-red-300">{athlete.handle ?? athlete.first_name ?? ''}</span> to confirm
                      </label>
                      <input
                        type="text"
                        id="delete-confirm"
                        value={deleteConfirm}
                        onChange={e => setDeleteConfirm(e.target.value)}
                        autoComplete="off"
                        className="w-full px-4 py-3 text-sm text-primary border border-border-strong rounded-md mb-3 bg-surface"
                      />
                      <div className="flex gap-3">
                        <button
                          type="button"
                          onClick={handleDelete}
                          disabled={!deleteConfirmMatches || deleteBusy}
                          className="bg-red-600 text-white px-4 py-2 min-h-[44px] rounded-lg text-sm font-semibold hover:bg-red-700 transition disabled:opacity-50"
                        >
                          {deleteBusy ? <><i className="fas fa-spinner fa-spin mr-2"></i>Deleting…</> : 'Permanently delete'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setDeleteOpen(false)}
                          disabled={deleteBusy}
                          className="border border-border-strong text-secondary px-4 py-2 min-h-[44px] rounded-lg text-sm font-semibold hover:bg-surface-muted transition disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </section>
              </>
            )}
          </>
        )}
      </main>

      <ConfirmModal
        isOpen={cancelInviteTarget !== null}
        title="Cancel this invite?"
        message={`The invite link sent to ${cancelInviteTarget?.email ?? 'this address'} will stop working — if you already shared it, it can't be used. You can always send a new one.`}
        confirmText="Cancel invite"
        cancelText="Keep invite"
        onConfirm={() => {
          if (cancelInviteTarget) void cancelInvite(cancelInviteTarget.id);
          setCancelInviteTarget(null);
        }}
        onCancel={() => setCancelInviteTarget(null)}
      />

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

      <EditProfileTabs
        isOpen={editOpen}
        onClose={() => setEditOpen(false)}
        profile={childProfile}
        targetProfileId={profileId}
        onSave={() => {
          setRetryKey(k => k + 1);
          void refreshChildProfile();
        }}
      />

      <ConfirmModal
        isOpen={!!removeTagTarget}
        title="Remove this tag?"
        message={`${athlete?.first_name || 'Your athlete'} will no longer appear tagged in this post.`}
        confirmText={removingTag ? 'Removing…' : 'Remove'}
        onConfirm={removeTag}
        onCancel={() => setRemoveTagTarget(null)}
      />

      <ConfirmModal
        isOpen={!!removeFanTarget}
        title="Remove this fan?"
        message={`${removeFanTarget ? formatDisplayName(removeFanTarget.follower.first_name, removeFanTarget.follower.middle_name, removeFanTarget.follower.last_name, removeFanTarget.follower.full_name) : ''} will no longer follow ${athlete?.first_name || 'this athlete'}. They can send a new request in the future.`}
        confirmText={removingFan ? 'Removing…' : 'Remove'}
        onConfirm={removeFan}
        onCancel={() => setRemoveFanTarget(null)}
      />
    </div>
  );
}
