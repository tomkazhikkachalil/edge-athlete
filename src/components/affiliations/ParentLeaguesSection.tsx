'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/Toast';
import ConfirmModal from '@/components/ConfirmModal';

// ── League chain section (phase 6 R3, mig 167) ──────────────────────────────
// The league↔league counterpart of AffiliationSection, slimmer on
// purpose: request a parent (or invite a child), accept/decline/dissolve
// — the /api/leagues/[id]/parents matrix. Renders nothing pre-167 or on
// a failed load (additive section, never broken chrome). Managers see
// pendings; everyone sees the active chain.

const SUGGEST_DEBOUNCE_MS = 250;

type AffType = 'partner_of' | 'member_of' | 'sanctioned_by';

interface ChainOrg {
  id: string;
  name: string;
  city?: string | null;
  region?: string | null;
}

interface ChainRow {
  league_id: string;
  parent_league_id: string;
  status: string;
  initiated_by: 'child' | 'parent';
  affiliation_type: AffType | null;
  direction: 'up' | 'down';
  org: ChainOrg | null;
}

interface ChainData {
  active: ChainRow[];
  outgoing: ChainRow[];
  incoming: ChainRow[];
  viewerIsManager: boolean;
}

const UP_LABEL: Record<AffType, string> = {
  partner_of: 'Partner of',
  member_of: 'Member of',
  sanctioned_by: 'Sanctioned by',
};
const DOWN_LABEL: Record<AffType, string> = {
  partner_of: 'Partner',
  member_of: 'Member league',
  sanctioned_by: 'Sanctions',
};

export default function ParentLeaguesSection({ leagueId }: { leagueId: string }) {
  const { showSuccess, showError } = useToast();
  const base = `/api/leagues/${leagueId}/parents`;

  const [data, setData] = useState<ChainData | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [inviteType, setInviteType] = useState<AffType>('sanctioned_by');
  const [direction, setDirection] = useState<'up' | 'down'>('up');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ChainOrg[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRow, setConfirmRow] = useState<ChainRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(base);
        if (!response.ok || cancelled) return;
        const body = await response.json();
        if (!cancelled) setData(body as ChainData);
      } catch {
        /* additive section */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, reloadKey]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(q)}&type=leagues`);
        if (!response.ok || cancelled) return;
        const body = await response.json();
        const rows = ((body.results?.leagues ?? []) as ChainOrg[]).filter(
          r => r.id !== leagueId
        );
        if (!cancelled) setResults(rows.slice(0, 6));
      } catch {
        /* best-effort */
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, leagueId]);

  const refresh = () => setReloadKey(k => k + 1);

  const act = async (
    init: RequestInit & { url?: string },
    okMsg: string,
    failMsg: string,
    busy: string
  ) => {
    setBusyId(busy);
    try {
      const response = await fetch(init.url ?? base, init);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        showError('League chain', body.error || failMsg);
        return;
      }
      showSuccess('League chain', okMsg);
      refresh();
    } catch {
      showError('League chain', failMsg);
    } finally {
      setBusyId(null);
    }
  };

  if (!data) return null;
  const rowOtherId = (r: ChainRow) => (r.league_id === leagueId ? r.parent_league_id : r.league_id);
  const label = (r: ChainRow) =>
    r.affiliation_type
      ? (r.direction === 'up' ? UP_LABEL : DOWN_LABEL)[r.affiliation_type]
      : '';
  if (
    data.active.length === 0 &&
    data.outgoing.length === 0 &&
    data.incoming.length === 0 &&
    !data.viewerIsManager
  ) {
    return null;
  }

  return (
    <section
      aria-label="League chain"
      className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
    >
      <h2 className="text-lg font-semibold text-primary mb-1">League chain</h2>
      <p className="text-xs text-muted mb-3">
        Governing bodies above, member leagues below. Affiliation grants no
        authority — it carries the sanctioning story on results.
      </p>

      {data.active.length > 0 && (
        <ul className="divide-y divide-border-subtle mb-3">
          {data.active.map(r => (
            <li key={rowOtherId(r)} className="py-2 flex flex-wrap items-center justify-between gap-2">
              <span className="min-w-0 text-sm">
                <span className="font-medium text-primary">{r.org?.name ?? 'League'}</span>
                <span className="text-muted"> · {label(r)}</span>
              </span>
              {data.viewerIsManager && (
                <button
                  type="button"
                  disabled={busyId === rowOtherId(r)}
                  onClick={() => setConfirmRow(r)}
                  className="px-3 py-1.5 text-sm min-h-[36px] rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                >
                  End
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {data.viewerIsManager && data.incoming.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-secondary mb-1">Awaiting your decision</p>
          <ul className="space-y-2">
            {data.incoming.map(r => (
              <li key={rowOtherId(r)} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  {r.org?.name ?? 'League'} · {label(r)}
                </span>
                <span className="flex gap-2">
                  <button
                    type="button"
                    disabled={busyId === rowOtherId(r)}
                    onClick={() =>
                      void act(
                        {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ leagueId: rowOtherId(r) }),
                        },
                        'Affiliation accepted',
                        'Failed to accept',
                        rowOtherId(r)
                      )
                    }
                    className="px-3 py-1.5 text-sm min-h-[36px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    disabled={busyId === rowOtherId(r)}
                    onClick={() =>
                      void act(
                        { method: 'DELETE', url: `${base}?leagueId=${rowOtherId(r)}` },
                        'Invite declined',
                        'Failed to decline',
                        rowOtherId(r)
                      )
                    }
                    className="px-3 py-1.5 text-sm min-h-[36px] rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                  >
                    Decline
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.viewerIsManager && data.outgoing.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-semibold text-secondary mb-1">Sent — awaiting the other league</p>
          <ul className="space-y-2">
            {data.outgoing.map(r => (
              <li key={rowOtherId(r)} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="min-w-0">
                  {r.org?.name ?? 'League'} · {label(r)}
                </span>
                <button
                  type="button"
                  disabled={busyId === rowOtherId(r)}
                  onClick={() =>
                    void act(
                      { method: 'DELETE', url: `${base}?leagueId=${rowOtherId(r)}` },
                      'Invite withdrawn',
                      'Failed to withdraw',
                      rowOtherId(r)
                    )
                  }
                  className="px-3 py-1.5 text-sm min-h-[36px] rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                >
                  Withdraw
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.viewerIsManager && (
        <div className="border border-border rounded-lg p-3 space-y-2">
          <div className="flex flex-wrap gap-2">
            <select
              value={direction}
              onChange={e => setDirection(e.target.value === 'down' ? 'down' : 'up')}
              aria-label="Chain direction"
              className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
            >
              <option value="up">Request a governing body</option>
              <option value="down">Invite a member league</option>
            </select>
            <select
              value={inviteType}
              onChange={e => setInviteType(e.target.value as AffType)}
              aria-label="Affiliation type"
              className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
            >
              <option value="sanctioned_by">Sanctioning</option>
              <option value="member_of">Membership</option>
              <option value="partner_of">Partnership</option>
            </select>
          </div>
          <input
            type="search"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search leagues…"
            aria-label="Search leagues to affiliate"
            className="w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
          />
          {results.length > 0 && query.trim().length >= 2 && (
            <ul className="space-y-1">
              {results.map(r => (
                <li key={r.id}>
                  <button
                    type="button"
                    disabled={busyId === r.id}
                    onClick={() =>
                      void act(
                        {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({
                            leagueId: r.id,
                            affiliationType: inviteType,
                            direction,
                          }),
                        },
                        `Invite sent to ${r.name}`,
                        'Failed to send the invite',
                        r.id
                      )
                    }
                    className="w-full text-left px-3 py-2 text-sm rounded-md hover:bg-surface-sunken transition-colors"
                  >
                    <span className="font-medium text-primary">{r.name}</span>
                    {(r.city || r.region) && (
                      <span className="text-muted"> · {[r.city, r.region].filter(Boolean).join(', ')}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmModal
        isOpen={confirmRow !== null}
        title="End this affiliation?"
        message={`The link with ${confirmRow?.org?.name ?? 'this league'} is removed for both sides. Sanctioned results keep their history.`}
        confirmText="End affiliation"
        onConfirm={() => {
          if (confirmRow) {
            void act(
              { method: 'DELETE', url: `${base}?leagueId=${rowOtherId(confirmRow)}` },
              'Affiliation ended',
              'Failed to end the affiliation',
              rowOtherId(confirmRow)
            );
          }
          setConfirmRow(null);
        }}
        onCancel={() => setConfirmRow(null)}
      />
    </section>
  );
}
