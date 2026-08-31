'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';
import { formatPlace } from '@/lib/geo/regions';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { SUGGEST_DEBOUNCE_MS } from '@/lib/search/typeahead';

// The club↔league affiliation section (118), mounted on BOTH org pages —
// the markup is genuinely symmetric, so one component with a `side` prop.
// Every action refetches the section's GET: server truth, never optimistic.
// Withdraw is quiet (no confirm — it cancels your own pending invite);
// decline and dissolve confirm.

interface AffOrg {
  id: string;
  name: string;
  sport_key?: string | null;
  city?: string | null;
  region?: string | null;
  country?: string | null;
}

type AffiliationType = 'partner_of' | 'member_of' | 'sanctioned_by';

interface AffRow {
  league_id: string;
  club_id: string;
  status: string;
  initiated_by: string;
  created_at: string;
  affiliation_type?: AffiliationType | null;
  org: AffOrg | null;
}

interface AffData {
  active: AffRow[];
  outgoing: AffRow[];
  incoming: AffRow[];
  viewerIsManager: boolean;
}

interface AffiliationSectionProps {
  side: 'league' | 'club';
  orgId: string;
}

export default function AffiliationSection({ side, orgId }: AffiliationSectionProps) {
  const { showSuccess, showError } = useToast();
  const other = side === 'league' ? 'club' : 'league';
  const base = side === 'league' ? `/api/leagues/${orgId}/clubs` : `/api/clubs/${orgId}/leagues`;
  const targetKey = side === 'league' ? 'clubId' : 'leagueId';
  const otherPath = (id: string) => (side === 'league' ? `/club/${id}` : `/league/${id}`);

  const [data, setData] = useState<AffData | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [inviteType, setInviteType] = useState<AffiliationType>('partner_of');
  const [inviteQuery, setInviteQuery] = useState('');
  const [inviteResults, setInviteResults] = useState<AffOrg[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmTarget, setConfirmTarget] = useState<{ kind: 'decline' | 'dissolve'; row: AffRow } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(base);
        if (!response.ok || cancelled) return;
        const body = await response.json();
        if (!cancelled) setData(body as AffData);
      } catch {
        /* section is additive — a failed load renders nothing broken */
      }
    })();
    return () => { cancelled = true; };
  }, [base, reloadKey]);

  // Invite typeahead over the unified search (clear happens in onChange —
  // the set-state-in-effect rule).
  useEffect(() => {
    const q = inviteQuery.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const type = other === 'club' ? 'clubs' : 'leagues';
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=${type}`);
        if (!response.ok || cancelled) return;
        const body = await response.json();
        const rows = (other === 'club' ? body.results?.clubs : body.results?.leagues) ?? [];
        if (!cancelled) setInviteResults(rows.slice(0, 6));
      } catch {
        /* typeahead is best-effort */
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [inviteQuery, other]);

  const refresh = () => setReloadKey(k => k + 1);

  const invite = async (target: AffOrg) => {
    setBusyId(target.id);
    try {
      const response = await fetch(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [targetKey]: target.id, affiliationType: inviteType }),
      });
      const body = await response.json();
      if (!response.ok) {
        showError('Affiliation', body.error || 'Failed to send the invite');
        return;
      }
      showSuccess('Affiliation', `Invite sent to ${target.name}`);
      setInviteQuery('');
      setInviteResults([]);
      refresh();
    } catch (e) {
      console.error('Affiliation invite failed:', e);
      showError('Affiliation', 'Failed to send the invite');
    } finally {
      setBusyId(null);
    }
  };

  const accept = async (row: AffRow) => {
    const targetId = side === 'league' ? row.club_id : row.league_id;
    setBusyId(targetId);
    try {
      const response = await fetch(base, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [targetKey]: targetId, action: 'accept' }),
      });
      const body = await response.json();
      if (!response.ok) {
        showError('Affiliation', body.error || 'Failed to accept');
        return;
      }
      showSuccess('Affiliation', 'Affiliation accepted');
      refresh();
    } catch (e) {
      console.error('Affiliation accept failed:', e);
      showError('Affiliation', 'Failed to accept');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (row: AffRow, kind: 'withdraw' | 'decline' | 'dissolve') => {
    const targetId = side === 'league' ? row.club_id : row.league_id;
    setBusyId(targetId);
    try {
      const response = await fetch(`${base}?${targetKey}=${encodeURIComponent(targetId)}`, {
        method: 'DELETE',
      });
      const body = await response.json();
      if (!response.ok) {
        showError('Affiliation', body.error || 'Failed');
        return;
      }
      showSuccess(
        'Affiliation',
        kind === 'withdraw' ? 'Invite withdrawn' : kind === 'decline' ? 'Invite declined' : 'Affiliation ended'
      );
      refresh();
    } catch (e) {
      console.error('Affiliation remove failed:', e);
      showError('Affiliation', 'Failed');
    } finally {
      setBusyId(null);
      setConfirmTarget(null);
    }
  };

  // 143 chips. Direction reads from the CLUB's side (the club is a
  // member_of / sanctioned_by the league); labels phrase per viewing side.
  // Shown for every type — the partner_of backfill stays visible.
  const typeLabel = (t: AffiliationType | null | undefined) => {
    const type = t ?? 'partner_of';
    if (side === 'league') {
      return type === 'member_of' ? 'Member club' : type === 'sanctioned_by' ? 'Sanctioned club' : 'Partner';
    }
    return type === 'member_of' ? 'Member of' : type === 'sanctioned_by' ? 'Sanctioned by' : 'Partner';
  };

  const typeChip = (row: AffRow) => (
    <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-surface-sunken text-secondary shrink-0">
      {typeLabel(row.affiliation_type)}
    </span>
  );

  const orgLine = (org: AffOrg | null) => {
    if (!org) return null;
    const sport = org.sport_key
      ? SPORT_REGISTRY[org.sport_key as keyof typeof SPORT_REGISTRY]?.display_name ?? org.sport_key
      : null;
    const place = formatPlace({ city: org.city, region: org.region, country: org.country });
    return [sport, place].filter(Boolean).join(' · ') || null;
  };

  // Nothing to show for visitors when there are no active affiliations.
  if (!data || (data.active.length === 0 && !data.viewerIsManager)) return null;

  return (
    <div className="mt-6 bg-surface rounded-xl shadow-sm border border-border p-4 sm:p-6">
      <h2 className="text-lg font-semibold text-primary mb-4">
        {side === 'league' ? 'Affiliated clubs' : 'Leagues'}
      </h2>

      {data.active.length > 0 ? (
        <ul className="space-y-2">
          {data.active.map(row => {
            const targetId = side === 'league' ? row.club_id : row.league_id;
            return (
              <li key={targetId} className="flex items-center justify-between gap-3 p-2 rounded-lg hover:bg-surface-muted">
                <Link href={otherPath(targetId)} className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 min-w-0">
                    <span className="font-medium text-primary truncate">{row.org?.name ?? 'Unknown'}</span>
                    {typeChip(row)}
                  </p>
                  {orgLine(row.org) && <p className="text-sm text-muted truncate">{orgLine(row.org)}</p>}
                </Link>
                {data.viewerIsManager && (
                  <button
                    type="button"
                    disabled={busyId === targetId}
                    onClick={() => setConfirmTarget({ kind: 'dissolve', row })}
                    className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors shrink-0"
                  >
                    End affiliation
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-sm text-tertiary">No affiliations yet.</p>
      )}

      {data.viewerIsManager && (
        <>
          {data.incoming.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-secondary mb-2">Incoming requests</h3>
              <ul className="space-y-2">
                {data.incoming.map(row => {
                  const targetId = side === 'league' ? row.club_id : row.league_id;
                  return (
                    <li key={targetId} className="flex items-center justify-between gap-3 p-2 border border-border rounded-lg">
                      <p className="flex items-center gap-1.5 min-w-0">
                        <span className="font-medium text-primary truncate">{row.org?.name ?? 'Unknown'}</span>
                        {typeChip(row)}
                      </p>
                      <div className="flex gap-2 shrink-0">
                        <button
                          type="button"
                          disabled={busyId === targetId}
                          onClick={() => accept(row)}
                          className="px-3 py-1.5 min-h-[36px] rounded-md text-xs font-medium bg-brand text-white hover:bg-brand-hover disabled:opacity-60"
                        >
                          Accept
                        </button>
                        <button
                          type="button"
                          disabled={busyId === targetId}
                          onClick={() => setConfirmTarget({ kind: 'decline', row })}
                          className="px-3 py-1.5 min-h-[36px] rounded-md text-xs font-medium border border-border-strong text-secondary hover:bg-surface-sunken disabled:opacity-60"
                        >
                          Decline
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {data.outgoing.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-semibold text-secondary mb-2">Pending invites</h3>
              <ul className="space-y-2">
                {data.outgoing.map(row => {
                  const targetId = side === 'league' ? row.club_id : row.league_id;
                  return (
                    <li key={targetId} className="flex items-center justify-between gap-3 p-2 border border-border rounded-lg">
                      <p className="flex items-center gap-1.5 min-w-0">
                        <span className="font-medium text-primary truncate">{row.org?.name ?? 'Unknown'}</span>
                        {typeChip(row)}
                      </p>
                      <button
                        type="button"
                        disabled={busyId === targetId}
                        onClick={() => remove(row, 'withdraw')}
                        className="px-3 py-1.5 min-h-[36px] rounded-md text-xs font-medium border border-border-strong text-secondary hover:bg-surface-sunken disabled:opacity-60"
                      >
                        Withdraw
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <div className="mt-4">
            <label htmlFor={`aff-invite-${orgId}`} className="block text-sm font-medium text-secondary mb-1">
              {side === 'league' ? 'Affiliate a club' : 'Request a league'}
            </label>
            <select
              value={inviteType}
              onChange={e => setInviteType(e.target.value as AffiliationType)}
              aria-label="Affiliation type"
              className="w-full mb-2 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
            >
              <option value="partner_of">Partner</option>
              <option value="member_of">
                {side === 'league' ? 'The club is a member of this league' : 'Member of the league'}
              </option>
              <option value="sanctioned_by">
                {side === 'league' ? 'This league sanctions the club' : 'Sanctioned by the league'}
              </option>
            </select>
            <input
              id={`aff-invite-${orgId}`}
              type="text"
              value={inviteQuery}
              onChange={e => {
                setInviteQuery(e.target.value);
                if (e.target.value.trim().length < 2) setInviteResults([]);
              }}
              placeholder={side === 'league' ? 'Search clubs to affiliate…' : 'Search leagues to join…'}
              className="w-full px-3 py-2 border border-border-strong rounded-md outline-none"
            />
            {inviteResults.length > 0 && (
              <ul className="mt-1 border border-border rounded-md divide-y divide-border-subtle bg-surface-raised">
                {inviteResults.map(candidate => (
                  <li key={candidate.id}>
                    <button
                      type="button"
                      disabled={busyId === candidate.id}
                      onClick={() => invite(candidate)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-surface-muted disabled:opacity-60"
                    >
                      <span className="text-primary">{candidate.name}</span>
                      {orgLine(candidate) && <span className="text-muted"> · {orgLine(candidate)}</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}

      <ConfirmModal
        isOpen={confirmTarget !== null}
        title={confirmTarget?.kind === 'dissolve' ? 'End affiliation' : 'Decline invite'}
        message={
          confirmTarget?.kind === 'dissolve'
            ? `End the affiliation with ${confirmTarget?.row.org?.name ?? 'this organization'}?`
            : `Decline the affiliation request from ${confirmTarget?.row.org?.name ?? 'this organization'}?`
        }
        confirmText={confirmTarget?.kind === 'dissolve' ? 'End affiliation' : 'Decline'}
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={() => confirmTarget && remove(confirmTarget.row, confirmTarget.kind)}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
