'use client';

import Link from 'next/link';
import LazyImage from '@/components/LazyImage';
import { formatDisplayName, getInitials } from '@/lib/formatters';
import { ROSTER_CHIP_LABELS, type MemberRow } from './types';
import type { OrgPageController } from './useOrgPage';

// The Members card — a pure move of the page twins' inline block (R1, Sep 8
// 2026), markup verbatim: every button label here is an e2e contract
// (managers, owners, roster-offer, roster-import specs).
interface OrgMembersListProps {
  members: MemberRow[];
  memberCount: number;
  canManage: boolean;
  isOwner: boolean;
  viewerId: string | undefined;
  actions: OrgPageController['actions'];
  dialogs: OrgPageController['dialogs'];
}

export default function OrgMembersList({
  members,
  memberCount,
  canManage,
  isOwner,
  viewerId,
  actions,
  dialogs,
}: OrgMembersListProps) {
  const { changeRole, inviteToRoster, cancelRosterInvite, remintClaimLink } = actions;
  const { claimLinks, setConfirmStepDown, setPromoteTarget, setRosterRemoveTarget, setRemoveTarget } = dialogs;

  return (
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
                  href={viewerId === member.profile_id ? '/athlete' : `/athlete/${member.profile_id}`}
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
                {/* Role controls are OWNER-only (managers hold powers,
                    they don't mint peers). One-click and reversible, so
                    no confirm — that stays on the destructive remove.
                    Owner rows deliberately fall through the manager
                    controls (0.8): owners never demote each other. */}
                {isOwner && member.role === 'owner' && member.profile_id === viewerId && (
                  <button
                    type="button"
                    onClick={() => setConfirmStepDown(true)}
                    className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors shrink-0"
                  >
                    Step down as owner
                  </button>
                )}
                {isOwner && member.role !== 'owner' && member.profile_id !== viewerId && (
                  <button
                    type="button"
                    onClick={() => setPromoteTarget(member)}
                    className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors shrink-0"
                  >
                    Make owner
                  </button>
                )}
                {isOwner && member.role === 'member' && member.profile_id !== viewerId && (
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
                {canManage && !member.roster && member.profile_id !== viewerId && (
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
                {canManage && member.roster === 'active' && member.profile_id !== viewerId && (
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
                {canManage && member.role === 'member' && member.profile_id !== viewerId && (
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
  );
}
