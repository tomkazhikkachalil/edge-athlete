'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import LazyImage from '@/components/LazyImage';
import ConfirmModal from '@/components/ConfirmModal';
import LeagueEditModal from '@/components/leagues/LeagueEditModal';
import AffiliationSection from '@/components/affiliations/AffiliationSection';
import OrgUpcomingEvents from '@/components/affiliations/OrgUpcomingEvents';
import OrgRecentActivity from '@/components/affiliations/OrgRecentActivity';
import { useToast } from '@/components/Toast';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { formatPlace, GEO_ATTRIBUTION } from '@/lib/geo/regions';
import { MapPin, Trophy, Users } from 'lucide-react';

// The first non-profile entity with a public page (clubs followed in 117).
// Search rows (⌘K) link here — no page, no link is the rule.

export interface LeagueInfo {
  id: string;
  name: string;
  description: string | null;
  sport_key: string;
  owner_profile_id: string | null;
  place_id: string | null;
  city: string | null;
  region: string | null;
  region_code: string | null;
  country: string | null;
  country_code: string | null;
  lat: number | null;
  lng: number | null;
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
}

interface LeagueResponse {
  league: LeagueInfo;
  memberCount: number;
  members: MemberRow[];
  viewerRole: string | null;
}

export default function LeaguePage() {
  const params = useParams();
  const leagueId = params.id as string;
  const { user } = useAuth();
  const { showError, showSuccess } = useToast();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [data, setData] = useState<LeagueResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);
  // Leaving is not a toggle-tap decision (dummy-proofing round): the DELETE
  // drops the member row INCLUDING a manager role, and only the owner can
  // hand that back. Joining stays one-tap (harmlessly reversible).
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    // cancelled guard: navigating /league/a → /league/b keeps this mounted.
    let cancelled = false;
    (async () => {
      if (!leagueId) return;
      try {
        setLoading(true);
        const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}`);
        const body = await response.json();
        if (cancelled) return;
        if (!response.ok) {
          setNotFound(true);
          return;
        }
        setNotFound(false);
        setData(body as LeagueResponse);
      } catch (e) {
        if (cancelled) return;
        console.error('Failed to load league:', e);
        setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [leagueId, reloadKey]);

  const refresh = useCallback(() => setReloadKey(k => k + 1), []);

  const toggleMembership = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/members`, {
        method: 'POST',
      });
      const body = await response.json();
      if (!response.ok) {
        showError('League', body.error || 'Something went wrong');
        return;
      }
      showSuccess('League', body.action === 'joined' ? 'You joined the league' : 'You left the league');
      refresh();
    } catch (e) {
      console.error('Membership toggle failed:', e);
      showError('League', 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const changeRole = async (target: MemberRow, role: 'manager' | 'member') => {
    try {
      const response = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/members?profileId=${encodeURIComponent(target.profile_id)}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ role }),
        }
      );
      const body = await response.json();
      if (!response.ok) {
        showError('League', body.error || 'Failed to change role');
        return;
      }
      showSuccess('League', role === 'manager' ? 'Manager added' : 'Manager removed');
      refresh();
    } catch (e) {
      console.error('Role change failed:', e);
      showError('League', 'Failed to change role');
    }
  };

  const removeMember = async (target: MemberRow) => {
    try {
      const response = await fetch(
        `/api/leagues/${encodeURIComponent(leagueId)}/members?profileId=${encodeURIComponent(target.profile_id)}`,
        { method: 'DELETE' }
      );
      const body = await response.json();
      if (!response.ok) {
        showError('League', body.error || 'Failed to remove member');
        return;
      }
      showSuccess('League', 'Member removed');
      refresh();
    } catch (e) {
      console.error('Remove member failed:', e);
      showError('League', 'Failed to remove member');
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
            <p className="mt-3 text-tertiary">Loading league...</p>
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
              <Trophy className="w-8 h-8 text-faint" />
            </div>
            <h1 className="text-2xl font-bold text-primary mb-2">League Not Found</h1>
            <p className="text-tertiary mb-6">This league does not exist or is no longer available.</p>
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

  const { league, memberCount, members, viewerRole } = data;
  const sportLabel =
    SPORT_REGISTRY[league.sport_key as keyof typeof SPORT_REGISTRY]?.display_name ?? league.sport_key;
  const placeLine = formatPlace({ city: league.city, region: league.region, country: league.country });
  const canManage =
    viewerRole === 'owner' || viewerRole === 'manager' || (!!user && user.id === league.owner_profile_id);
  const isOwner = viewerRole === 'owner' || (!!user && user.id === league.owner_profile_id);

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        <div className="bg-surface rounded-xl shadow-sm border border-border overflow-hidden">
          <div className="h-20 sm:h-24 bg-gradient-to-r from-violet-500 to-violet-600" />
          <div className="px-4 sm:px-6 py-5">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-primary break-words">{league.name}</h1>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2 text-sm text-tertiary">
                  <span className="inline-flex items-center gap-1">
                    <Trophy className="w-4 h-4" />
                    {sportLabel}
                  </span>
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
                {league.description && (
                  <p className="mt-3 text-secondary max-w-xl whitespace-pre-wrap">{league.description}</p>
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
                      {viewerRole ? 'Leave league' : 'Join league'}
                    </button>
                  )
                )}
                {canManage && (
                  <button
                    type="button"
                    onClick={() => setEditOpen(true)}
                    className="px-4 py-2 text-sm min-h-[40px] rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                  >
                    Edit league
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Members */}
        <div className="mt-6 bg-surface rounded-xl shadow-sm border border-border p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-primary mb-4">Members</h2>
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
                  <li key={member.profile_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-surface-muted">
                    <Link
                      href={user?.id === member.profile_id ? '/athlete' : `/athlete/${member.profile_id}`}
                      className="flex items-center gap-3 flex-1 min-w-0"
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
                        {member.role !== 'member' && (
                          <p className="text-xs text-brand-fg capitalize">{member.role}</p>
                        )}
                      </div>
                    </Link>
                    {/* Role controls are OWNER-only (managers hold powers,
                        they don't mint peers). One-click and reversible, so
                        no confirm — that stays on the destructive remove. */}
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
                  </li>
                );
              })}
            </ul>
          )}
          {memberCount > members.length && (
            <p className="mt-3 text-xs text-muted">Showing {members.length} of {memberCount} members.</p>
          )}
        </div>

        <OrgUpcomingEvents side="league" orgId={league.id} />

        <OrgRecentActivity side="league" orgId={league.id} />

        <AffiliationSection side="league" orgId={league.id} />

        {/* GeoNames attribution — rendered only when place-derived fields do
            (docs/SEARCH.md). */}
        {placeLine && (
          <div className="mt-4 px-1 text-[10px] text-faint">{GEO_ATTRIBUTION}</div>
        )}
      </div>

      {editOpen && (
        <LeagueEditModal
          league={league}
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
            ? `Remove ${formatDisplayName(removeTarget.profile.first_name, null, removeTarget.profile.last_name, removeTarget.profile.full_name)} from ${league.name}?`
            : `Remove this member from ${league.name}?`
        }
        confirmText="Remove"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={() => removeTarget && removeMember(removeTarget)}
        onCancel={() => setRemoveTarget(null)}
      />

      <ConfirmModal
        isOpen={confirmLeave}
        title="Leave this league?"
        message={
          viewerRole === 'manager'
            ? `You'll lose your manager role — only the owner can restore it. You can rejoin as a member anytime.`
            : `You can rejoin anytime.`
        }
        confirmText="Leave"
        cancelText="Stay"
        onConfirm={() => {
          setConfirmLeave(false);
          void toggleMembership();
        }}
        onCancel={() => setConfirmLeave(false)}
      />
    </div>
  );
}
