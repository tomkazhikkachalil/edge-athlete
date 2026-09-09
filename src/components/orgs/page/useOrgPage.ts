'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useToast } from '@/components/Toast';
import { SIDE_COPY } from './side-copy';
import type { MemberRow, OrgPageResponse, OrgSide } from './types';

// The org page's data + every mutation, lifted out of the two page twins in
// R1 of the Org Pages Program (Sep 8 2026). Behaviour is the twins' verbatim:
// one payload fetch keyed on [side, orgId, reloadKey] with the cancelled
// guard, refetch-on-success everywhere (no optimistic updates), toasts scoped
// by side. Feature-local on purpose (next to OrgPage, not src/hooks — that
// directory holds generic hooks).
export function useOrgPage(side: OrgSide, orgId: string) {
  const copy = SIDE_COPY[side];
  const { user, profile: viewerProfile } = useAuth();
  const { showError, showSuccess } = useToast();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [data, setData] = useState<OrgPageResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);
  // Leaving is not a toggle-tap decision (dummy-proofing round): the DELETE
  // drops the member row INCLUDING a manager role, and only the owner can
  // hand that back. Joining stays one-tap (harmlessly reversible).
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Roster (0.3): removal and decline both ERASE the offer trail (re-invite
  // required), so they confirm; invite and cancel-invite are one-tap.
  const [rosterRemoveTarget, setRosterRemoveTarget] = useState<MemberRow | null>(null);
  const [confirmDeclineRoster, setConfirmDeclineRoster] = useState(false);
  // Phase 4 R4: the photo-consent checkbox on the accept banner. Only
  // rendered (and only sent) for unsupervised viewers — a supervised
  // athlete's answer would be ignored server-side (guardian-only), and
  // the guardian queue asks instead.
  const [photoConsentChecked, setPhotoConsentChecked] = useState(false);
  // Owners (0.8): promote is irreversible-by-others (no coup — owners only
  // step down themselves), so both actions confirm.
  const [promoteTarget, setPromoteTarget] = useState<MemberRow | null>(null);
  // Re-minted claim links (R3), keyed by profile_id — session-local display
  // only; the server deleted the old invite when it minted this one.
  const [claimLinks, setClaimLinks] = useState<Record<string, string>>({});
  const [confirmStepDown, setConfirmStepDown] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // Set inside the fetch effect once a payload has landed; read there too —
  // never during render (the refs rule) and never an effect dep (which would
  // refetch on every payload).
  const loadedRef = useRef(false);

  const base = `/api/${copy.plural}/${encodeURIComponent(orgId)}`;

  useEffect(() => {
    // cancelled guard: navigating /league/a → /league/b keeps this mounted.
    let cancelled = false;
    (async () => {
      if (!orgId) return;
      try {
        // R3: the spinner is for the FIRST load only. A refresh after a
        // mutation updates the payload in place — the twins used to flash
        // the spinner and remount the page, which was merely ugly; with the
        // sections behind LargerWindows it would close the window the
        // mutation was made in.
        if (!loadedRef.current) setLoading(true);
        const response = await fetch(`/api/${copy.plural}/${encodeURIComponent(orgId)}`);
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setNotFound(true);
          return;
        }
        setNotFound(false);
        setData(body as OrgPageResponse);
        loadedRef.current = true;
      } catch (e) {
        if (cancelled) return;
        console.error(`Failed to load ${copy.noun}:`, e);
        setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [copy.plural, copy.noun, orgId, reloadKey]);

  const refresh = useCallback(() => setReloadKey(k => k + 1), []);

  const toggleMembership = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`${base}/members`, {
        method: 'POST',
      });
      const body = await response.json();
      if (!response.ok) {
        showError(copy.label, body.error || 'Something went wrong');
        return;
      }
      showSuccess(
        copy.label,
        body.action === 'joined'
          ? `You joined the ${copy.noun}`
          : body.action === 'requested'
            ? 'Request sent — a manager will approve it'
            : body.action === 'request_cancelled'
              ? 'Request withdrawn'
              : `You left the ${copy.noun}`
      );
      refresh();
    } catch (e) {
      console.error('Membership toggle failed:', e);
      showError(copy.label, 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (target: MemberRow, role: 'manager' | 'member') => {
    try {
      const response = await fetch(
        `${base}/members?profileId=${encodeURIComponent(target.profile_id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        }
      );
      const body = await response.json();
      if (!response.ok) {
        showError(copy.label, body.error || 'Failed to change role');
        return;
      }
      showSuccess(copy.label, role === 'manager' ? 'Manager added' : 'Manager removed');
      refresh();
    } catch (e) {
      console.error('Role change failed:', e);
      showError(copy.label, 'Failed to change role');
    }
  };

  // Owner actions (0.8). Transfer = promote, then the old owner steps down.
  const promoteOwner = async (target: MemberRow) => {
    try {
      const response = await fetch(
        `${base}/owners?profileId=${encodeURIComponent(target.profile_id)}`,
        { method: 'POST' }
      );
      const body = await response.json();
      if (!response.ok) {
        showError(copy.label, body.error || 'Failed to add the owner');
        return;
      }
      showSuccess(copy.label, 'Owner added');
      refresh();
    } catch (e) {
      console.error('Owner promote failed:', e);
      showError(copy.label, 'Failed to add the owner');
    }
  };

  const stepDownOwner = async () => {
    try {
      const response = await fetch(`${base}/owners`, {
        method: 'DELETE',
      });
      const body = await response.json();
      if (!response.ok) {
        showError(copy.label, body.error || 'Failed to step down');
        return;
      }
      showSuccess(copy.label, 'You stepped down');
      refresh();
    } catch (e) {
      console.error('Owner step-down failed:', e);
      showError(copy.label, 'Failed to step down');
    }
  };

  // Roster actions (0.3). All refetch on success — no optimistic updates.
  const rosterAction = async (
    method: 'POST' | 'PATCH' | 'DELETE',
    profileId: string | null,
    successMessage: string,
    failMessage: string
  ) => {
    try {
      const qs = profileId ? `?profileId=${encodeURIComponent(profileId)}` : '';
      const response = await fetch(`${base}/roster${qs}`, {
        method,
        ...(method === 'PATCH'
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                action: 'accept',
                ...(viewerProfile?.supervision_state !== 'supervised'
                  ? { photoConsent: photoConsentChecked }
                  : {}),
              }),
            }
          : {}),
      });
      const body = await response.json();
      if (!response.ok) {
        showError(copy.label, body.error || failMessage);
        return;
      }
      showSuccess(copy.label, successMessage);
      refresh();
    } catch (e) {
      console.error('Roster action failed:', e);
      showError(copy.label, failMessage);
    }
  };

  const inviteToRoster = (target: MemberRow) =>
    rosterAction('POST', target.profile_id, 'Roster invitation sent', 'Failed to send the invitation');
  const cancelRosterInvite = (target: MemberRow) =>
    rosterAction('DELETE', target.profile_id, 'Invitation cancelled', 'Failed to cancel the invitation');
  const removeFromRoster = (target: MemberRow) =>
    rosterAction('DELETE', target.profile_id, 'Removed from the roster', 'Failed to update the roster');
  const acceptRoster = () =>
    rosterAction('PATCH', null, "You're on the roster", 'Failed to accept the invitation');
  const declineRoster = () =>
    rosterAction('DELETE', null, 'Invitation declined', 'Failed to decline the invitation');
  // R3: a member counts themselves in (adult → active; supervised → the
  // guardian is asked). The join link is what the console shares too.
  const countMyRounds = async () => {
    try {
      const response = await fetch(`${base}/roster`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ self: true }),
      });
      const body = (await response.json().catch(() => ({}))) as { action?: string; error?: string };
      if (!response.ok) {
        showError(copy.label, body.error || 'Could not join the roster');
        return;
      }
      showSuccess(
        copy.label,
        body.action === 'guardian_asked'
          ? 'Your guardian has been asked to confirm'
          : `Your rounds now count in ${copy.noun} leagues`
      );
      refresh();
    } catch {
      showError(copy.label, 'Could not join the roster');
    }
  };
  const shareJoinLink = async () => {
    const url = `${window.location.origin}/join/${side}/${orgId}`;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: `Join ${data?.[side]?.name ?? 'us'}`, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      showSuccess(copy.label, 'Join link copied');
    } catch {
      /* dismissed */
    }
  };

  // Re-mint a claim link for an unclaimed stub (R3): the import report is
  // the only other place the URL ever appeared, and it may be long gone.
  const remintClaimLink = async (target: MemberRow) => {
    try {
      const response = await fetch(`${base}/roster-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remintProfileId: target.profile_id }),
      });
      const body = await response.json();
      if (!response.ok) {
        showError(copy.label, body.error || 'Failed to create the claim link');
        return;
      }
      setClaimLinks(prev => ({ ...prev, [target.profile_id]: body.claimUrl }));
    } catch (e) {
      console.error('Claim re-mint failed:', e);
      showError(copy.label, 'Failed to create the claim link');
    }
  };

  const removeMember = async (target: MemberRow) => {
    try {
      const response = await fetch(
        `${base}/members?profileId=${encodeURIComponent(target.profile_id)}`,
        { method: 'DELETE' }
      );
      const body = await response.json();
      if (!response.ok) {
        showError(copy.label, body.error || 'Failed to remove member');
        return;
      }
      showSuccess(copy.label, 'Member removed');
      refresh();
    } catch (e) {
      console.error('Remove member failed:', e);
      showError(copy.label, 'Failed to remove member');
    } finally {
      setRemoveTarget(null);
    }
  };

  return {
    user,
    viewerProfile,
    loading,
    notFound,
    data,
    busy,
    refresh,
    actions: {
      toggleMembership,
      changeRole,
      promoteOwner,
      stepDownOwner,
      inviteToRoster,
      cancelRosterInvite,
      removeFromRoster,
      acceptRoster,
      declineRoster,
      countMyRounds,
      shareJoinLink,
      remintClaimLink,
      removeMember,
    },
    dialogs: {
      editOpen, setEditOpen,
      removeTarget, setRemoveTarget,
      confirmLeave, setConfirmLeave,
      rosterRemoveTarget, setRosterRemoveTarget,
      confirmDeclineRoster, setConfirmDeclineRoster,
      photoConsentChecked, setPhotoConsentChecked,
      promoteTarget, setPromoteTarget,
      claimLinks,
      confirmStepDown, setConfirmStepDown,
    },
  };
}

export type OrgPageController = ReturnType<typeof useOrgPage>;
