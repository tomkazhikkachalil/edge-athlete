'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import StaffInviteModal, { type InviteScopeOption } from './StaffInviteModal';
import { buildHierarchy, defaultOpenSeasonId, type HierarchyPerson, type HierarchySeasonInput, type HierarchyTeamInput } from '@/lib/orgs/hierarchy';
import { SECTION_LABELS } from '@/lib/orgs/staff-validate';

// ── Hierarchy & people (org staff program, round 5) ─────────────────────────
// The org as a tree — org → seasons → divisions → entered teams (+ teams
// not yet entered) — with the people who hold authority on each node and,
// for OWNERS, an Invite button on every node that opens the invite modal
// with that node as the scope. Open invites list at the top (owner-only,
// revocable). A league's affiliated clubs are read-only leaves: a league
// never grants roles inside a club (masterplan §5). Data: the console's
// structure aggregate (props) + /staff (+ /clubs for leagues).
//
// 375px: one column, every level a <details>, chips wrap, 44px targets.

interface Props {
  side: 'league' | 'club';
  orgId: string;
  seasons: HierarchySeasonInput[];
  teams: HierarchyTeamInput[];
  /** Owners invite / revoke; everyone in the console sees the tree. */
  isOwner: boolean;
  onError: (message: string) => void;
}

interface OpenInvite {
  id: string;
  invitedEmail: string;
  role: 'admin' | 'staff';
  sections: string[] | null;
  scopeType: 'org' | 'division' | 'team';
  scopeId: string | null;
  expiresAt: string;
}

interface AffiliatedClub {
  id: string;
  name: string;
}

const ROLE_LABEL: Record<HierarchyPerson['role'], string> = { owner: 'Owner', manager: 'Manager', admin: 'Admin', staff: 'Staff' };

function grantLine(p: { role: string; sections: string[] | null }): string {
  if (p.role !== 'staff') return ROLE_LABEL[p.role as HierarchyPerson['role']] ?? p.role;
  return (p.sections ?? []).map(s => SECTION_LABELS[s as keyof typeof SECTION_LABELS] ?? s).join(', ') || 'Staff';
}

// Module-level (react-hooks/static-components): both take what they need.
function PeopleChips({ list, node, isOwner, busy, onRevoke }: {
  list: HierarchyPerson[];
  node: string;
  isOwner: boolean;
  busy: string | null;
  onRevoke: (p: HierarchyPerson) => void;
}) {
  return (
    <ul className="flex flex-wrap gap-2 mt-2" aria-label={`People on ${node}`}>
      {list.map(p => (
        <li key={p.rowId} className="inline-flex items-center gap-2 max-w-full rounded-full bg-surface-sunken px-3 py-1 text-xs text-primary">
          <span className="font-semibold truncate">{p.name}</span>
          <span className="text-tertiary truncate">{grantLine(p)}</span>
          {isOwner && (p.role === 'admin' || p.role === 'staff') && (
            <button
              type="button"
              disabled={busy === p.rowId}
              onClick={() => onRevoke(p)}
              aria-label={`Revoke ${p.name}`}
              className="ea-interactive -my-1 -mr-2 min-h-[32px] min-w-[32px] rounded-full text-muted hover:text-red-600"
            >
              <i className="fas fa-times" aria-hidden="true"></i>
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function InviteButton({ scope, isOwner, onOpen }: { scope: InviteScopeOption | null; isOwner: boolean; onOpen: (scope: InviteScopeOption | null) => void }) {
  if (!isOwner) return null;
  return (
    <button
      type="button"
      onClick={() => onOpen(scope)}
      className="ea-interactive inline-flex items-center gap-2 min-h-[44px] sm:min-h-[36px] px-3 rounded-lg border border-border-strong text-sm font-medium text-brand-fg w-full sm:w-auto justify-center"
    >
      <i className="fas fa-user-plus" aria-hidden="true"></i>
      Invite
    </button>
  );
}

export default function HierarchySection({ side, orgId, seasons, teams, isOwner, onError }: Props) {
  const plural = side === 'league' ? 'leagues' : 'clubs';
  const [people, setPeople] = useState<HierarchyPerson[]>([]);
  const [invites, setInvites] = useState<OpenInvite[]>([]);
  const [clubs, setClubs] = useState<AffiliatedClub[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [inviteScope, setInviteScope] = useState<InviteScopeOption | null | 'closed'>('closed');
  const [busy, setBusy] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const res = await fetch(`/api/${plural}/${orgId}/staff`);
      if (res.ok) {
        const data = (await res.json()) as { staff?: HierarchyPerson[]; invites?: OpenInvite[] };
        setPeople(data.staff ?? []);
        setInvites(data.invites ?? []);
      }
    } catch {
      /* the tree renders without people */
    } finally {
      setLoaded(true);
    }
  }, [plural, orgId]);

  // Effect + macrotask (the RegistrationSteps precedent): the loads set
  // state in a deferred callback, never in the effect body
  // (react-hooks/set-state-in-effect).
  useEffect(() => {
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload]);

  // A league's affiliated clubs as read-only leaves (set-state-in-effect:
  // the fetch lives in a callback like reload, the effect only calls it).
  const loadClubs = useCallback(async () => {
    if (side !== 'league') return;
    try {
      const res = await fetch(`/api/leagues/${orgId}/clubs`);
      if (!res.ok) return;
      const data = (await res.json()) as { active?: Array<{ club_id: string; org: { id: string; name: string } | null }> };
      setClubs((data.active ?? []).filter(r => r.org).map(r => ({ id: r.org!.id, name: r.org!.name })));
    } catch {
      /* no leaves */
    }
  }, [side, orgId]);

  useEffect(() => {
    const t = setTimeout(() => void loadClubs(), 0);
    return () => clearTimeout(t);
  }, [loadClubs]);

  const tree = buildHierarchy(seasons, teams, people);
  const openSeason = defaultOpenSeasonId(tree.seasons);
  const scopeOptions: InviteScopeOption[] = [
    ...tree.seasons.flatMap(s => s.divisions.map(d => ({ type: 'division' as const, id: d.id, name: s.archived ? `${d.name} (${s.label})` : d.name }))),
    ...teams.filter(t => t.status !== 'archived').map(t => ({ type: 'team' as const, id: t.id, name: t.display_name || t.name })),
  ];
  const scopeName = (inv: OpenInvite) =>
    inv.scopeType === 'org' ? `the whole ${side}` : (scopeOptions.find(o => o.type === inv.scopeType && o.id === inv.scopeId)?.name ?? inv.scopeType);

  const revoke = async (p: HierarchyPerson) => {
    setBusy(p.rowId);
    try {
      const res = await fetch(`/api/${plural}/${orgId}/staff/${p.rowId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not revoke');
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not revoke');
    } finally {
      setBusy(null);
    }
  };
  const revokeInvite = async (inv: OpenInvite) => {
    setBusy(inv.id);
    try {
      const res = await fetch(`/api/${plural}/${orgId}/staff/invites/${inv.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not revoke');
      await reload();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not revoke');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section id="hierarchy" aria-label="Hierarchy & people" className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-1">
        <div>
          <h2 className="text-lg font-semibold text-primary mb-1">Hierarchy &amp; people</h2>
          <p className="text-sm text-tertiary">
            Who runs what. {isOwner ? 'Invite someone on any node — they get the sections you pick there, and nothing else.' : 'Owners invite people from here.'}
          </p>
        </div>
        <InviteButton scope={null} isOwner={isOwner} onOpen={setInviteScope} />
      </div>

      {isOwner && invites.length > 0 && (
        <div className="mt-4 rounded-lg border border-border-subtle p-3">
          <h3 className="text-sm font-semibold text-secondary mb-2">Open invites</h3>
          <ul className="space-y-2">
            {invites.map(inv => (
              <li key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-medium text-primary break-all">{inv.invitedEmail}</span>
                <span className="text-tertiary">{grantLine(inv)} · {scopeName(inv)}</span>
                <button type="button" disabled={busy === inv.id} onClick={() => void revokeInvite(inv)} className="ea-interactive min-h-[44px] sm:min-h-[32px] px-2 text-xs font-medium text-red-600 rounded">
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4 space-y-3">
        <div className="rounded-lg border border-border p-3" data-node="org">
          <div className="flex items-center gap-2">
            <i className={`fas ${side === 'league' ? 'fa-trophy' : 'fa-building'} text-brand-fg`} aria-hidden="true"></i>
            <span className="font-semibold text-primary">Whole {side}</span>
          </div>
          {loaded && tree.orgPeople.length === 0 ? (
            <p className="text-xs text-muted mt-2">No one yet.</p>
          ) : (
            <PeopleChips list={tree.orgPeople} node={`the whole ${side}`} isOwner={isOwner} busy={busy} onRevoke={p => void revoke(p)} />
          )}
        </div>

        {tree.seasons.map(season => (
          <details key={season.id} open={season.id === openSeason} className="rounded-lg border border-border p-3" data-node={`season:${season.id}`}>
            <summary className="cursor-pointer min-h-[44px] flex items-center gap-2 font-semibold text-primary">
              <i className="fas fa-calendar text-brand-fg" aria-hidden="true"></i>
              {season.label}
              {season.archived && <span className="text-xs font-normal text-muted">archived</span>}
              <span className="text-xs font-normal text-tertiary ml-auto">{season.divisions.length} division{season.divisions.length === 1 ? '' : 's'}</span>
            </summary>
            <div className="mt-2 space-y-2 pl-2 sm:pl-4 border-l border-border-subtle">
              {season.divisions.length === 0 && <p className="text-xs text-muted">No divisions in this season.</p>}
              {season.divisions.map(d => (
                <details key={d.id} open className="rounded-lg bg-surface-sunken/40 p-3" data-node={`division:${d.id}`}>
                  <summary className="cursor-pointer min-h-[44px] flex flex-wrap items-center gap-2 font-medium text-primary">
                    <i className="fas fa-layer-group text-brand-fg" aria-hidden="true"></i>
                    {d.name}
                    <span className="text-xs font-normal text-tertiary">{d.teams.length} team{d.teams.length === 1 ? '' : 's'}</span>
                  </summary>
                  <PeopleChips list={d.people} node={d.name} isOwner={isOwner} busy={busy} onRevoke={p => void revoke(p)} />
                  <div className="mt-2">
                    <InviteButton scope={{ type: 'division', id: d.id, name: d.name }} isOwner={isOwner} onOpen={setInviteScope} />
                  </div>
                  <ul className="mt-2 space-y-2 pl-2 sm:pl-4 border-l border-border-subtle">
                    {d.teams.map(t => (
                      <li key={t.id} className="rounded-lg border border-border-subtle p-2" data-node={`team:${t.id}`}>
                        <div className="flex flex-wrap items-center gap-2">
                          <i className="fas fa-people-group text-brand-fg" aria-hidden="true"></i>
                          <span className="text-sm font-medium text-primary">{t.name}</span>
                        </div>
                        <PeopleChips list={t.people} node={t.name} isOwner={isOwner} busy={busy} onRevoke={p => void revoke(p)} />
                        <div className="mt-2">
                          <InviteButton scope={{ type: 'team', id: t.id, name: t.name }} isOwner={isOwner} onOpen={setInviteScope} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
            </div>
          </details>
        ))}

        {tree.unassignedTeams.length > 0 && (
          <details className="rounded-lg border border-border p-3" data-node="unassigned">
            <summary className="cursor-pointer min-h-[44px] flex items-center gap-2 font-semibold text-primary">
              <i className="fas fa-people-group text-brand-fg" aria-hidden="true"></i>
              Teams not in a division
              <span className="text-xs font-normal text-tertiary ml-auto">{tree.unassignedTeams.length}</span>
            </summary>
            <ul className="mt-2 space-y-2">
              {tree.unassignedTeams.map(t => (
                <li key={t.id} className="rounded-lg border border-border-subtle p-2" data-node={`team:${t.id}`}>
                  <span className="text-sm font-medium text-primary">{t.name}</span>
                  <PeopleChips list={t.people} node={t.name} isOwner={isOwner} busy={busy} onRevoke={p => void revoke(p)} />
                  <div className="mt-2">
                    <InviteButton scope={{ type: 'team', id: t.id, name: t.name }} isOwner={isOwner} onOpen={setInviteScope} />
                  </div>
                </li>
              ))}
            </ul>
          </details>
        )}

        {side === 'league' && clubs.length > 0 && (
          <details className="rounded-lg border border-border p-3" data-node="clubs">
            <summary className="cursor-pointer min-h-[44px] flex items-center gap-2 font-semibold text-primary">
              <i className="fas fa-building text-brand-fg" aria-hidden="true"></i>
              Affiliated clubs
              <span className="text-xs font-normal text-tertiary ml-auto">{clubs.length}</span>
            </summary>
            <p className="text-xs text-muted mt-1">Managed by each club — a league never grants roles inside a club.</p>
            <ul className="mt-2 space-y-1">
              {clubs.map(c => (
                <li key={c.id}>
                  <Link href={`/club/${c.id}`} className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium min-h-[44px] inline-flex items-center">
                    {c.name} →
                  </Link>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {inviteScope !== 'closed' && (
        <StaffInviteModal
          side={side}
          orgId={orgId}
          seasons={tree.seasons.filter(s => !s.archived).map(s => ({ id: s.id, label: s.label }))}
          scopeOptions={scopeOptions}
          initialScope={inviteScope}
          onClose={() => setInviteScope('closed')}
          onInvited={() => void reload()}
        />
      )}
    </section>
  );
}
