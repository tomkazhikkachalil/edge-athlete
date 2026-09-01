'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import LazyImage from '@/components/LazyImage';
import ConfirmModal from '@/components/ConfirmModal';
import ClubEditModal from '@/components/clubs/ClubEditModal';
import AffiliationSection from '@/components/affiliations/AffiliationSection';
import OrgUpcomingEvents from '@/components/affiliations/OrgUpcomingEvents';
import OrgStandings from '@/components/orgs/OrgStandings';
import OrgRecentActivity from '@/components/affiliations/OrgRecentActivity';
import { useToast } from '@/components/Toast';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { formatPlace, GEO_ATTRIBUTION } from '@/lib/geo/regions';
import { MapPin, Building2, Trophy, Users } from 'lucide-react';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';

// The club page (117) — mirror of /league/[id], minus sport: clubs are
// multi-sport facilities by decision. Shipping this page is what makes the
// ⌘K club rows navigable (no page, no link).

// Phase 5 (mig 161): the widened roster lifecycle. 'pending'/'active' keep
// the invite-flow chips; the four registration statuses get read-only chips
// here (the registration workflow itself lives on the registrar screen).
type RosterChipStatus =
  | 'pending'
  | 'active'
  | 'registered'
  | 'evaluating'
  | 'placed'
  | 'released';

const ROSTER_CHIP_LABELS: Record<RosterChipStatus, string> = {
  pending: 'Roster invited',
  active: 'Roster',
  registered: 'Registered',
  evaluating: 'In evaluation',
  placed: 'Placed',
  released: 'Released',
};

export interface ClubInfo {
  id: string;
  name: string;
  description: string | null;
  owner_profile_id: string | null;
  place_id: string | null;
  city: string | null;
  region: string | null;
  region_code: string | null;
  country: string | null;
  country_code: string | null;
  lat: number | null;
  lng: number | null;
  /** Legacy free-text location (001) — the display fallback. */
  location: string | null;
  created_at: string;
}

interface MemberProfile {
  id: string;
  handle: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  avatar_url: string | null;
}

interface MemberRow {
  profile_id: string;
  role: string;
  joined_at: string;
  profile: MemberProfile | null;
  roster: RosterChipStatus | null;
  /** Phase 4 R4 — managers only (redacted to null otherwise). */
  photoConsent?: boolean | null;
  /** R3: unclaimed roster stub — server-derived, manager-redacted. */
  unclaimed?: boolean;
}

interface ClubResponse {
  club: ClubInfo;
  /** 0.6b: derived sports (distinct division sports; [] until structure exists). */
  sports?: string[];
  memberCount: number;
  members: MemberRow[];
  viewerRole: string | null;
  viewerRoster: RosterChipStatus | null;
}

export default function ClubPage() {
  const params = useParams();
  const clubId = params.id as string;
  const { user, profile: viewerProfile } = useAuth();
  const { showError, showSuccess } = useToast();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [data, setData] = useState<ClubResponse | null>(null);
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
  const [confirmStepDown, setConfirmStepDown] = useState(false);
  // Re-minted claim links (R3), keyed by profile_id — session-local display
  // only; the server deleted the old invite when it minted this one.
  const [claimLinks, setClaimLinks] = useState<Record<string, string>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!clubId) return;
      try {
        setLoading(true);
        const response = await fetch(`/api/clubs/${encodeURIComponent(clubId)}`);
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setNotFound(true);
          return;
        }
        setNotFound(false);
        setData(body as ClubResponse);
      } catch (e) {
        if (cancelled) return;
        console.error('Failed to load club:', e);
        setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [clubId, reloadKey]);

  const refresh = useCallback(() => setReloadKey(k => k + 1), []);

  const toggleMembership = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/clubs/${encodeURIComponent(clubId)}/members`, {
        method: 'POST',
      });
      const body = await response.json();
      if (!response.ok) {
        showError('Club', body.error || 'Something went wrong');
        return;
      }
      showSuccess('Club', body.action === 'joined' ? 'You joined the club' : 'You left the club');
      refresh();
    } catch (e) {
      console.error('Membership toggle failed:', e);
      showError('Club', 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (target: MemberRow, role: 'manager' | 'member') => {
    try {
      const response = await fetch(
        `/api/clubs/${encodeURIComponent(clubId)}/members?profileId=${encodeURIComponent(target.profile_id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        }
      );
      const body = await response.json();
      if (!response.ok) {
        showError('Club', body.error || 'Failed to change role');
        return;
      }
      showSuccess('Club', role === 'manager' ? 'Manager added' : 'Manager removed');
      refresh();
    } catch (e) {
      console.error('Role change failed:', e);
      showError('Club', 'Failed to change role');
    }
  };

  // Owner actions (0.8). Transfer = promote, then the old owner steps down.
  const promoteOwner = async (target: MemberRow) => {
    try {
      const response = await fetch(
        `/api/clubs/${encodeURIComponent(clubId)}/owners?profileId=${encodeURIComponent(target.profile_id)}`,
        { method: 'POST' }
      );
      const body = await response.json();
      if (!response.ok) {
        showError('Club', body.error || 'Failed to add the owner');
        return;
      }
      showSuccess('Club', 'Owner added');
      refresh();
    } catch (e) {
      console.error('Owner promote failed:', e);
      showError('Club', 'Failed to add the owner');
    }
  };

  const stepDownOwner = async () => {
    try {
      const response = await fetch(`/api/clubs/${encodeURIComponent(clubId)}/owners`, {
        method: 'DELETE',
      });
      const body = await response.json();
      if (!response.ok) {
        showError('Club', body.error || 'Failed to step down');
        return;
      }
      showSuccess('Club', 'You stepped down');
      refresh();
    } catch (e) {
      console.error('Owner step-down failed:', e);
      showError('Club', 'Failed to step down');
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
      const response = await fetch(`/api/clubs/${encodeURIComponent(clubId)}/roster${qs}`, {
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
        showError('Club', body.error || failMessage);
        return;
      }
      showSuccess('Club', successMessage);
      refresh();
    } catch (e) {
      console.error('Roster action failed:', e);
      showError('Club', failMessage);
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

  // Re-mint a claim link for an unclaimed stub (R3): the import report is
  // the only other place the URL ever appeared, and it may be long gone.
  const remintClaimLink = async (target: MemberRow) => {
    try {
      const response = await fetch(`/api/clubs/${encodeURIComponent(clubId)}/roster-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remintProfileId: target.profile_id }),
      });
      const body = await response.json();
      if (!response.ok) {
        showError('Club', body.error || 'Failed to create the claim link');
        return;
      }
      setClaimLinks(prev => ({ ...prev, [target.profile_id]: body.claimUrl }));
    } catch (e) {
      console.error('Claim re-mint failed:', e);
      showError('Club', 'Failed to create the claim link');
    }
  };

  const removeMember = async (target: MemberRow) => {
    try {
      const response = await fetch(
        `/api/clubs/${encodeURIComponent(clubId)}/members?profileId=${encodeURIComponent(target.profile_id)}`,
        { method: 'DELETE' }
      );
      const body = await response.json();
      if (!response.ok) {
        showError('Club', body.error || 'Failed to remove member');
        return;
      }
      showSuccess('Club', 'Member removed');
      refresh();
    } catch (e) {
      console.error('Remove member failed:', e);
      showError('Club', 'Failed to remove member');
    } finally {
      setRemoveTarget(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand mx-auto"></div>
            <p className="mt-3 text-tertiary">Loading club...</p>
          </div>
        </div>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center max-w-md mx-auto px-4">
            <div className="w-16 h-16 bg-surface-sunken rounded-full flex items-center justify-center mx-auto mb-4">
              <Building2 className="w-8 h-8 text-faint" />
            </div>
            <h1 className="text-2xl font-bold text-primary mb-2">Club Not Found</h1>
            <p className="text-tertiary mb-6">This club does not exist or is no longer available.</p>
            <Link
              href="/feed"
              className="inline-flex items-center px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand-hover transition-colors"
            >
              Back to Feed
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const { club, memberCount, members, viewerRole, viewerRoster } = data;
  // Derived sports (0.6b) — purely additive: a structureless club shows no
  // sport chip at all, exactly as before.
  const sportLabels = (data.sports ?? []).map(
    key => SPORT_REGISTRY[key as keyof typeof SPORT_REGISTRY]?.display_name ?? key
  );
  const placeLine =
    formatPlace({ city: club.city, region: club.region, country: club.country }) || club.location;
  const canManage =
    viewerRole === 'owner' || viewerRole === 'manager' || (!!user && user.id === club.owner_profile_id);
  const isOwner = viewerRole === 'owner' || (!!user && user.id === club.owner_profile_id);

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <div className="bg-surface rounded-xl shadow-sm border border-border overflow-hidden">
          <div className="h-20 sm:h-24 bg-gradient-to-r from-violet-500 to-violet-600" />
          <div className="px-4 sm:px-6 py-5">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-primary break-words">{club.name}</h1>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-tertiary">
                  {sportLabels.length > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Trophy className="w-4 h-4" />
                      {sportLabels.join(' · ')}
                    </span>
                  )}
                  {placeLine && (
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="w-4 h-4" />
                      {placeLine}
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <Users className="w-4 h-4" />
                    {memberCount} {memberCount === 1 ? 'member' : 'members'}
                  </span>
                </div>
                {club.description && (
                  <p className="mt-3 text-secondary max-w-xl whitespace-pre-wrap">{club.description}</p>
                )}
              </div>

              <div className="flex flex-col items-start sm:items-end gap-2 shrink-0">
                {user && (
                  viewerRole === 'owner' ? (
                    <button
                      type="button"
                      disabled
                      className="px-4 py-2 text-sm min-h-[40px] rounded-lg bg-surface-sunken text-muted cursor-default"
                    >
                      Owner
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => (viewerRole ? setConfirmLeave(true) : toggleMembership())}
                      disabled={busy}
                      className={`px-4 py-2 text-sm min-h-[40px] rounded-lg font-medium transition-colors disabled:opacity-60 ${
                        viewerRole
                          ? 'border border-border-strong text-secondary hover:bg-surface-sunken'
                          : 'bg-brand text-white hover:bg-brand-hover'
                      }`}
                    >
                      {viewerRole ? 'Leave club' : 'Join club'}
                    </button>
                  )
                )}
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setEditOpen(true)}
                    className="px-4 py-2 text-sm min-h-[40px] rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                  >
                    Edit club
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Roster invitation banner (0.3) */}
        {viewerRoster === 'pending' && (
          <div className="mt-6 bg-surface rounded-xl shadow-sm border border-brand p-4 sm:p-6">
            <p className="font-medium text-primary">
              You&apos;ve been invited to the {club.name} roster
            </p>
            <p className="mt-1 text-sm text-secondary">
              Roster membership is the real record — it&apos;s what future stats and schedules attach to.
            </p>
            {viewerProfile?.supervision_state === 'supervised' ? (
              <p className="mt-1 text-xs text-muted">
                Your guardian can also approve this from their console.
              </p>
            ) : (
              <label className="mt-2 flex items-start gap-2 text-sm text-secondary">
                <input
                  type="checkbox"
                  checked={photoConsentChecked}
                  onChange={e => setPhotoConsentChecked(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Allow this organization to publish photos I&apos;m tagged in on its
                  public site. You can change this anytime.
                </span>
              </label>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void acceptRoster()}
                className="px-4 py-2 text-sm min-h-[40px] rounded-lg bg-brand text-white hover:bg-brand-hover font-medium transition-colors"
              >
                Accept
              </button>
              <button
                type="button"
                onClick={() => setConfirmDeclineRoster(true)}
                className="px-4 py-2 text-sm min-h-[40px] rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
              >
                Decline
              </button>
            </div>
          </div>
        )}

        {/* Members */}
        <div className="mt-6 bg-surface rounded-xl shadow-sm border border-border p-4 sm:p-6">
          <h2 id="members" className="text-lg font-semibold text-primary mb-4">Members</h2>
          {members.length === 0 ? (
            <p className="text-tertiary text-sm">No members yet.</p>
          ) : (
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {members.map(member => {
                const profile = member.profile;
                const name = profile
                  ? formatDisplayName(profile.first_name, null, profile.last_name, profile.full_name)
                  : 'Unknown athlete';
                return (
                  <li key={member.profile_id} className="flex flex-wrap items-center gap-3 p-2 rounded-lg hover:bg-surface-muted">
                    <Link
                      href={user?.id === member.profile_id ? '/athlete' : `/athlete/${member.profile_id}`}
                      className="flex items-center gap-3 grow basis-48 min-w-0"
                    >
                      {profile?.avatar_url ? (
                        <LazyImage
                          src={profile.avatar_url}
                          alt={name}
                          className="w-10 h-10 rounded-full object-cover"
                        />
                      ) : (
                        <div className="w-10 h-10 bg-gradient-to-br from-violet-500 to-violet-600 rounded-full flex items-center justify-center shrink-0">
                          <span className="text-white text-sm font-semibold">{getInitials(name)}</span>
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-primary truncate">{name}</p>
                        {(member.role !== 'member' || member.roster || member.unclaimed) && (
                          <p className="text-xs">
                            {member.role !== 'member' && (
                              <span className="text-brand-fg capitalize">{member.role}</span>
                            )}
                            {member.role !== 'member' && member.roster && <span className="text-muted"> · </span>}
                            {member.roster && member.roster !== 'pending' && (
                              <span className={member.roster === 'released' ? 'text-muted' : 'text-brand-fg'}>
                                {ROSTER_CHIP_LABELS[member.roster]}
                              </span>
                            )}
                            {canManage && member.roster && ['active', 'registered', 'evaluating', 'placed'].includes(member.roster) && (
                              <span className="text-muted">
                                {' · '}
                                {member.photoConsent === true
                                  ? 'Photos allowed'
                                  : member.photoConsent === false
                                  ? 'Photos declined'
                                  : 'Photos not asked'}
                              </span>
                            )}
                            {member.roster === 'pending' && (
                              <span className="text-muted">{ROSTER_CHIP_LABELS.pending}</span>
                            )}
                            {member.unclaimed && (
                              <span className="text-muted">
                                {(member.role !== 'member' || member.roster) ? ' · ' : ''}Unclaimed
                              </span>
                            )}
                          </p>
                        )}
                      </div>
                    </Link>
                    {/* Role controls are OWNER-only; reversible one-click, so
                        no confirm — that stays on the destructive remove.
                        Owner rows deliberately fall through the manager
                        controls (0.8): owners never demote each other. */}
                    {isOwner && member.role === 'owner' && member.profile_id === user?.id && (
                      <button
                        type="button"
                        onClick={() => setConfirmStepDown(true)}
                        className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors shrink-0"
                      >
                        Step down as owner
                      </button>
                    )}
                    {isOwner && member.role !== 'owner' && member.profile_id !== user?.id && (
                      <button
                        type="button"
                        onClick={() => setPromoteTarget(member)}
                        className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors shrink-0"
                      >
                        Make owner
                      </button>
                    )}
                    {isOwner && member.role === 'member' && member.profile_id !== user?.id && (
                      <button
                        type="button"
                        onClick={() => changeRole(member, 'manager')}
                        className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors shrink-0"
                      >
                        Make manager
                      </button>
                    )}
                    {isOwner && member.role === 'manager' && (
                      <button
                        type="button"
                        onClick={() => changeRole(member, 'member')}
                        className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors shrink-0"
                      >
                        Remove manager
                      </button>
                    )}
                    {/* Roster controls (0.3): invite/cancel are one-tap and
                        reversible; removal from an ACTIVE roster confirms. */}
                    {canManage && !member.roster && member.profile_id !== user?.id && (
                      <button
                        type="button"
                        onClick={() => void inviteToRoster(member)}
                        className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors shrink-0"
                      >
                        Invite to roster
                      </button>
                    )}
                    {canManage && member.roster === 'pending' && (
                      <button
                        type="button"
                        onClick={() => void cancelRosterInvite(member)}
                        className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors shrink-0"
                      >
                        Cancel invite
                      </button>
                    )}
                    {canManage && member.roster === 'active' && member.profile_id !== user?.id && (
                      <button
                        type="button"
                        onClick={() => setRosterRemoveTarget(member)}
                        className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors shrink-0"
                      >
                        Remove from roster
                      </button>
                    )}
                    {canManage && member.unclaimed && (
                      <button
                        type="button"
                        onClick={() => void remintClaimLink(member)}
                        className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors shrink-0"
                      >
                        New claim link
                      </button>
                    )}
                    {canManage && member.role === 'member' && member.profile_id !== user?.id && (
                      <button
                        type="button"
                        onClick={() => setRemoveTarget(member)}
                        aria-label={`Remove ${name}`}
                        className="ea-icon-btn inline-flex items-center justify-center shrink-0 text-muted hover:text-red-600"
                      >
                        <i className="fas fa-times" aria-hidden="true"></i>
                      </button>
                    )}
                    {claimLinks[member.profile_id] && (
                      <span className="w-full flex items-center gap-2">
                        <input
                          type="text"
                          readOnly
                          value={claimLinks[member.profile_id]}
                          onFocus={e => e.currentTarget.select()}
                          aria-label={`Claim link for ${name}`}
                          className="grow basis-48 min-w-0 px-2 py-1 border border-border rounded-md text-[11px] text-muted"
                        />
                        <button
                          type="button"
                          onClick={() => void navigator.clipboard.writeText(claimLinks[member.profile_id])}
                          className="px-2 py-1 min-h-[32px] rounded-md border border-border-strong text-secondary hover:bg-surface-sunken"
                        >
                          Copy
                        </button>
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {memberCount > members.length && (
            <p className="mt-3 text-xs text-muted">Showing {members.length} of {memberCount} members.</p>
          )}
        </div>

        <OrgStandings side="club" orgId={club.id} />

        <OrgUpcomingEvents side="club" orgId={club.id} />

        <OrgRecentActivity side="club" orgId={club.id} />

        <AffiliationSection side="club" orgId={club.id} />

        {formatPlace({ city: club.city, region: club.region, country: club.country }) && (
          <div className="mt-4 px-1 text-[10px] text-faint">{GEO_ATTRIBUTION}</div>
        )}
      </div>

      {editOpen && (
        <ClubEditModal
          club={club}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            refresh();
          }}
        />
      )}

      <ConfirmModal
        isOpen={removeTarget !== null}
        title="Remove member"
        message={
          removeTarget?.profile
            ? `Remove ${formatDisplayName(removeTarget.profile.first_name, null, removeTarget.profile.last_name, removeTarget.profile.full_name)} from ${club.name}?`
            : `Remove this member from ${club.name}?`
        }
        confirmText="Remove"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={() => removeTarget && removeMember(removeTarget)}
        onCancel={() => setRemoveTarget(null)}
      />

      <ConfirmModal
        isOpen={confirmLeave}
        title="Leave this club?"
        message={
          (viewerRole === 'manager'
            ? `You'll lose your manager role — only the owner can restore it. You can rejoin as a member anytime.`
            : `You can rejoin anytime.`) +
          (viewerRoster === 'active' ? ` You'll also leave the roster.` : '')
        }
        confirmText="Leave"
        cancelText="Stay"
        onConfirm={() => {
          setConfirmLeave(false);
          void toggleMembership();
        }}
        onCancel={() => setConfirmLeave(false)}
      />

      <ConfirmModal
        isOpen={!!rosterRemoveTarget}
        title="Remove from the roster?"
        message="They stay a member of the club, but their roster spot is removed. Re-inviting needs a new invitation."
        confirmText="Remove"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={() => {
          const target = rosterRemoveTarget;
          setRosterRemoveTarget(null);
          if (target) void removeFromRoster(target);
        }}
        onCancel={() => setRosterRemoveTarget(null)}
      />

      <ConfirmModal
        isOpen={!!promoteTarget}
        title={`Make ${promoteTarget?.profile ? formatDisplayName(promoteTarget.profile.first_name, null, promoteTarget.profile.last_name, promoteTarget.profile.full_name) : 'this member'} an owner?`}
        message="They'll be able to manage everything, including owners. You can't undo this — owners can't demote each other; only they can step down."
        confirmText="Make owner"
        onConfirm={() => {
          const target = promoteTarget;
          setPromoteTarget(null);
          if (target) void promoteOwner(target);
        }}
        onCancel={() => setPromoteTarget(null)}
      />

      <ConfirmModal
        isOpen={confirmStepDown}
        title="Step down as owner?"
        message="You'll become a manager. Only another owner can make you an owner again."
        confirmText="Step down"
        onConfirm={() => {
          setConfirmStepDown(false);
          void stepDownOwner();
        }}
        onCancel={() => setConfirmStepDown(false)}
      />

      <ConfirmModal
        isOpen={confirmDeclineRoster}
        title="Decline the roster invitation?"
        message="The invitation is removed — a manager would need to invite you again."
        confirmText="Decline"
        cancelText="Keep it"
        onConfirm={() => {
          setConfirmDeclineRoster(false);
          void declineRoster();
        }}
        onCancel={() => setConfirmDeclineRoster(false)}
      />
    </div>
  );
}
