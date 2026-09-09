'use client';

import { useParams } from 'next/navigation';
import Link from 'next/link';
import AppHeader from '@/components/AppHeader';
import ConfirmModal from '@/components/ConfirmModal';
import LeagueEditModal from '@/components/leagues/LeagueEditModal';
import ClubEditModal from '@/components/clubs/ClubEditModal';
import AffiliationSection from '@/components/affiliations/AffiliationSection';
import ParentLeaguesSection from '@/components/affiliations/ParentLeaguesSection';
import OrgUpcomingEvents from '@/components/affiliations/OrgUpcomingEvents';
import OrgStandings from '@/components/orgs/OrgStandings';
import OrgAnnouncementsCard from '@/components/orgs/OrgAnnouncementsCard';
import OrgNewsCard from '@/components/orgs/OrgNewsCard';
import RoundPhotoConsentSwitch from '@/components/orgs/RoundPhotoConsentSwitch';
import GolfYourWeek from '@/components/orgs/GolfYourWeek';
import OrgVenues from '@/components/orgs/OrgVenues';
import OrgRecentActivity from '@/components/affiliations/OrgRecentActivity';
import { formatDisplayName } from '@/lib/formatters';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { formatPlace, GEO_ATTRIBUTION } from '@/lib/geo/regions';
import { Building2, Trophy } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useTheme } from '@/lib/use-theme';
import OrgHero from './OrgHero';
import OrgMembersList from './OrgMembersList';
import { SIDE_COPY } from './side-copy';
import { useOrgPage } from './useOrgPage';
import type { ClubInfo, LeagueInfo, OrgSide } from './types';

// The in-app org page, shared by /league/[id] and /club/[id] since R1 of the
// Org Pages Program (Sep 8 2026) folded the two ~980-line twins. Everything
// below is their markup verbatim, parametrised by `side`; the only genuine
// per-side differences are literal `side` checks: the league↔league chain
// section, the sport chip (a club has NO sport_key — mig 117 — and shows the
// chip only when derived sports exist), the club's legacy `location`
// fallback, the not-found glyph, and which edit modal opens.
//
// R2 (Org Pages Program): the page root carries the in-app dialect scope
// (`org-app-scope` — bubble shadows + spring; never the brand family) and
// the org's accent pair as inline vars from the validated brand payload,
// and the hero is OrgHero (logo tile, hero photo or accent band).
//
// Search rows (⌘K) link here — no page, no link is the rule.
export default function OrgPage({ side }: { side: OrgSide }) {
  const params = useParams();
  const orgId = params.id as string;
  const copy = SIDE_COPY[side];
  const { theme } = useTheme();
  const { user, viewerProfile, loading, notFound, data, busy, refresh, actions, dialogs } =
    useOrgPage(side, orgId);
  const {
    toggleMembership,
    promoteOwner,
    stepDownOwner,
    removeFromRoster,
    acceptRoster,
    declineRoster,
    countMyRounds,
    shareJoinLink,
    removeMember,
  } = actions;
  const {
    editOpen, setEditOpen,
    removeTarget, setRemoveTarget,
    confirmLeave, setConfirmLeave,
    rosterRemoveTarget, setRosterRemoveTarget,
    confirmDeclineRoster, setConfirmDeclineRoster,
    photoConsentChecked, setPhotoConsentChecked,
    promoteTarget, setPromoteTarget,
    confirmStepDown, setConfirmStepDown,
  } = dialogs;

  if (loading) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand mx-auto"></div>
            <p className="mt-3 text-tertiary">Loading {copy.noun}...</p>
          </div>
        </div>
      </div>
    );
  }

  const org = data?.[side];
  if (notFound || !data || !org) {
    const NotFoundGlyph = side === 'league' ? Trophy : Building2;
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center max-w-md mx-auto px-4">
            <div className="w-16 h-16 bg-surface-sunken rounded-full flex items-center justify-center mx-auto mb-4">
              <NotFoundGlyph className="w-8 h-8 text-faint" />
            </div>
            <h1 className="text-2xl font-bold text-primary mb-2">{copy.label} Not Found</h1>
            <p className="text-tertiary mb-6">This {copy.noun} does not exist or is no longer available.</p>
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

  const { memberCount, members, viewerRole, viewerRoster } = data;
  const viewerRegistration = data.viewerRegistration ?? { windowOpen: false, current: null };
  // Derived sports (0.6b). League: cached-primary first, older payloads fall
  // back to the single cached sport. Club: purely additive — a structureless
  // club shows no sport chip at all.
  const sportKeys =
    side === 'league'
      ? data.sports?.length
        ? data.sports
        : [(org as LeagueInfo).sport_key]
      : (data.sports ?? []);
  const sportLabels = sportKeys.map(
    key => SPORT_REGISTRY[key as keyof typeof SPORT_REGISTRY]?.display_name ?? key
  );
  const geoPlace = formatPlace({ city: org.city, region: org.region, country: org.country });
  const placeLine = side === 'club' ? geoPlace || (org as ClubInfo).location : geoPlace;
  const canManage =
    viewerRole === 'owner' || viewerRole === 'manager' || (!!user && user.id === org.owner_profile_id);
  const isOwner = viewerRole === 'owner' || (!!user && user.id === org.owner_profile_id);
  const brand = data.brand ?? null;
  // The accent pair reaches CSS only through buildOrgBrand → parseThemeTokens
  // (the strict hex check is the inline-style injection defense). No accent
  // → the scope's violet defaults, i.e. the pre-R2 strip.
  const accentVars = brand?.accent
    ? ({
        '--org-accent': brand.accent.fill,
        '--org-accent-strong': brand.accent.fillStrong,
        '--org-accent-fg': theme === 'dark' ? brand.accent.fgDark : brand.accent.fgLight,
      } as CSSProperties)
    : undefined;

  return (
    <div className="min-h-screen bg-canvas org-app-scope" style={accentVars}>
      <AppHeader showSearch={false} />

      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6">
        {data.pending && (
          <div
            role="status"
            className="mb-4 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-4 py-3 text-sm"
          >
            <p className="font-medium text-primary">Listing under review</p>
            <p className="text-secondary mt-0.5">
              Your {copy.noun} is live — anyone with the link can join. It appears in the directory and search once an Edge Athlete admin approves the listing.
            </p>
            <Link href={`/app/org/${side}/${org.id}`} className="inline-block mt-1 text-brand-fg font-medium hover:text-brand-fg-strong">
              Open your console →
            </Link>
          </div>
        )}
        <OrgHero
          side={side}
          org={org}
          brand={brand}
          sportLabels={sportLabels}
          showSportChip={side === 'league' || sportLabels.length > 0}
          placeLine={placeLine}
          memberCount={memberCount}
          signedIn={!!user}
          viewerRole={viewerRole}
          viewerRequestPending={!!data.viewerRequestPending}
          joinPolicy={data.joinPolicy}
          publishedSubdomain={data.site?.subdomain ?? null}
          canManage={canManage}
          isOwner={isOwner}
          busy={busy}
          onJoinOrLeave={() => (viewerRole ? setConfirmLeave(true) : void toggleMembership())}
          onEdit={() => setEditOpen(true)}
          onShareJoinLink={() => void shareJoinLink()}
        />

        {/* Registration banner (phase 5 R3): the family-facing state of
            the season workflow — CTA while a window is open, then the
            lifecycle as it advances. Never rendered alongside the roster
            invite banner in practice (invite-wins blocks stacking). */}
        {viewerRegistration.current ? (
          <div className="mt-6 bg-surface rounded-xl shadow-sm border border-brand p-4 sm:p-6">
            <p className="font-medium text-primary">
              {viewerRegistration.current.status === 'registered'
                ? 'Registration received — placement pending'
                : viewerRegistration.current.status === 'evaluating'
                ? 'Registration in evaluation'
                : viewerRegistration.current.status === 'placed'
                ? `Placed${viewerRegistration.current.teamName ? ` on ${viewerRegistration.current.teamName}` : ''}`
                : viewerRegistration.current.status === 'released'
                ? 'Released from this season’s roster'
                : 'Registered'}
            </p>
            <p className="mt-1 text-sm text-secondary">
              {viewerRegistration.current.status === 'placed'
                ? 'You’re on this season’s roster — schedules and stats attach here.'
                : viewerRegistration.current.status === 'released'
                ? 'Contact the organization if this looks wrong.'
                : 'The organization will place registrations onto teams.'}
            </p>
          </div>
        ) : viewerRegistration.windowOpen && user ? (
          <div className="mt-6 bg-surface rounded-xl shadow-sm border border-brand p-4 sm:p-6">
            <p className="font-medium text-primary">Registration is open</p>
            <p className="mt-1 text-sm text-secondary">
              Register yourself or your athletes for the season — it takes a couple of minutes.
            </p>
            <Link
              href={`/register/${side}/${orgId}`}
              className="mt-3 inline-flex px-4 py-2 text-sm min-h-[40px] items-center rounded-lg bg-brand text-white hover:bg-brand-hover font-medium transition-colors"
            >
              Register
            </Link>
          </div>
        ) : null}

        {/* R3: count my rounds — a member who isn't on the roster yet. */}
        {user && viewerRole && viewerRole !== 'owner' && !viewerRoster && (
          <div className="mt-6 bg-surface rounded-xl shadow-sm border border-border p-4 sm:p-6" data-self-roster="offer">
            <p className="font-medium text-primary">{`Count your rounds in ${org.name} leagues`}</p>
            <p className="mt-1 text-sm text-secondary">
              {viewerProfile?.supervision_state === 'supervised'
                ? 'Your guardian will be asked to confirm your roster spot.'
                : 'Puts you on the roster so your posted rounds count. You can leave any time.'}
            </p>
            <button
              type="button"
              onClick={() => void countMyRounds()}
              className="mt-3 px-4 py-2 text-sm min-h-[44px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
            >
              {viewerProfile?.supervision_state === 'supervised' ? 'Ask my guardian' : 'Count my rounds'}
            </button>
          </div>
        )}
        {/* Roster invitation banner (0.3) */}
        {viewerRoster === 'pending' && (
          <div className="mt-6 bg-surface rounded-xl shadow-sm border border-brand p-4 sm:p-6">
            <p className="font-medium text-primary">
              You&apos;ve been invited to the {org.name} roster
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
        <OrgMembersList
          members={members}
          memberCount={memberCount}
          canManage={canManage}
          isOwner={isOwner}
          viewerId={user?.id}
          actions={actions}
          dialogs={dialogs}
        />

        <GolfYourWeek side={side} orgId={org.id} />

        {/* N3: the announcement archive — members read every notice here. */}
        {/* Program 11 L2: members read every published post (incl. members-only). */}
        <OrgNewsCard side={side} orgId={org.id} isMember={!!viewerRole || isOwner} />
        <OrgAnnouncementsCard side={side} orgId={org.id} isMember={!!viewerRole || isOwner} />
        {/* Program 12: the member's own round-photo switch (M2's policy, both sides). */}
        {viewerRole && <RoundPhotoConsentSwitch side={side} orgId={org.id} />}

        <OrgStandings side={side} orgId={org.id} scope={data.visibility === 'private' && viewerRole ? 'mine' : 'public'} />

        <OrgVenues side={side} orgId={org.id} />

        <OrgUpcomingEvents side={side} orgId={org.id} />

        <OrgRecentActivity side={side} orgId={org.id} />

        <AffiliationSection side={side} orgId={org.id} />

        {/* Phase 6 R3: the league↔league chain (mig 167) — leagues only. */}
        {side === 'league' && <ParentLeaguesSection leagueId={org.id} />}

        {/* GeoNames attribution — rendered only when place-derived fields do
            (docs/SEARCH.md). The club's legacy `location` fallback is not
            place-derived, so the attribution keys off geoPlace on both sides. */}
        {geoPlace && (
          <div className="mt-4 px-1 text-[10px] text-faint">{GEO_ATTRIBUTION}</div>
        )}
      </div>

      {editOpen && side === 'league' && (
        <LeagueEditModal
          league={org as LeagueInfo}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
            refresh();
          }}
        />
      )}
      {editOpen && side === 'club' && (
        <ClubEditModal
          club={org as ClubInfo}
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
            ? `Remove ${formatDisplayName(removeTarget.profile.first_name, null, removeTarget.profile.last_name, removeTarget.profile.full_name)} from ${org.name}?`
            : `Remove this member from ${org.name}?`
        }
        confirmText="Remove"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={() => removeTarget && removeMember(removeTarget)}
        onCancel={() => setRemoveTarget(null)}
      />

      <ConfirmModal
        isOpen={confirmLeave}
        title={`Leave this ${copy.noun}?`}
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
        message={`They stay a member of the ${copy.noun}, but their roster spot is removed. Re-inviting needs a new invitation.`}
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
