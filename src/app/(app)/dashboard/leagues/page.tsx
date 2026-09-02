'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import PlacePicker, { type PlaceValue } from '@/components/PlacePicker';
import { useToast } from '@/components/Toast';
import { formatDisplayName } from '@/lib/formatters';
import { FEATURE_FLAGS } from '@/lib/features';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { SUGGEST_DEBOUNCE_MS } from '@/lib/search/typeahead';

// Admin league console: creation is admin-provisioned (Tom, Aug 24) — this
// page is the only creator in v1. Access = ADMIN_EMAILS, enforced
// server-side; a 403 renders the same lock panel as /dashboard.

interface AdminLeagueRow {
  id: string;
  name: string;
  description: string | null;
  sport_key: string;
  owner_profile_id: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  created_at: string;
  memberCount: number;
  owner: { id: string; first_name: string | null; last_name: string | null; full_name: string | null } | null;
  // Capability flags (142) — read-only v1; backfilled leagues→competitions.
  operates_competitions?: boolean;
  operates_teams?: boolean;
}

interface AdminRequestRow {
  id: string;
  name: string;
  description: string | null;
  sport_key: string;
  city: string | null;
  region: string | null;
  country: string | null;
  created_at: string;
  operates_competitions: boolean | null;
  operates_teams: boolean | null;
  structure_draft: { divisions?: unknown[]; teams?: unknown[] } | null;
  /** Phase 7 C4: the provisioned league + a signed preview of its draft site. */
  created_league_id?: string | null;
  previewUrl?: string | null;
  connections_draft: { existing?: unknown[]; stubs?: { name: string }[] } | null;
  requester: {
    id: string;
    first_name: string | null;
    last_name: string | null;
    full_name: string | null;
    handle: string | null;
    email: string | null;
  } | null;
}

interface OwnerCandidate {
  id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  full_name: string | null;
  handle: string | null;
}

export default function AdminLeaguesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { showSuccess, showError } = useToast();

  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [leagues, setLeagues] = useState<AdminLeagueRow[]>([]);
  const [pendingRequests, setPendingRequests] = useState<AdminRequestRow[]>([]);
  const [actingId, setActingId] = useState<string | null>(null);
  const [declineOpenId, setDeclineOpenId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState('');
  const [claimUrls, setClaimUrls] = useState<{ name: string; claimUrl: string | null; emailSent: boolean }[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  // Create form
  const [name, setName] = useState('');
  const [sportKey, setSportKey] = useState('golf');
  const [description, setDescription] = useState('');
  const [place, setPlace] = useState<PlaceValue | null>(null);
  const [placeText, setPlaceText] = useState('');
  const [ownerQuery, setOwnerQuery] = useState('');
  const [ownerResults, setOwnerResults] = useState<OwnerCandidate[]>([]);
  const [owner, setOwner] = useState<OwnerCandidate | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.push('/');
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const [leaguesRes, requestsRes] = await Promise.all([
          fetch('/api/admin/leagues'),
          fetch('/api/admin/league-requests'),
        ]);
        if (cancelled) return;
        if (leaguesRes.status === 403) {
          setAuthorized(false);
          return;
        }
        const data = await leaguesRes.json();
        if (cancelled) return;
        setAuthorized(true);
        setLeagues(data.leagues ?? []);
        // A failed requests fetch degrades to an empty queue, never a broken page.
        if (requestsRes.ok) {
          const rq = await requestsRes.json();
          if (!cancelled) setPendingRequests(rq.requests ?? []);
        }
      } catch {
        if (!cancelled) setAuthorized(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, reloadKey]);

  // Owner lookup — the /api/admin/users search the main dashboard uses.
  // The empty-query clear happens in the input's onChange (an event
  // handler), not here — a synchronous setState in an effect body is the
  // set-state-in-effect ERROR.
  useEffect(() => {
    const q = ownerQuery.trim();
    if (q.length < 1) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/users?q=${encodeURIComponent(q)}`);
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (!cancelled) setOwnerResults((data.users ?? []).slice(0, 8));
      } catch {
        /* lookup is best-effort */
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [ownerQuery]);

  const decide = async (requestId: string, decision: 'approve' | 'decline', reason?: string) => {
    setActingId(requestId);
    try {
      const response = await fetch('/api/admin/league-requests', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId, decision, ...(reason ? { reason } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) {
        showError('Leagues', data.error || 'Decision failed');
        return;
      }
      showSuccess('Leagues', decision === 'approve' ? 'League approved and created' : 'Request declined');
      if (decision === 'approve' && Array.isArray(data.replay?.stubs) && data.replay.stubs.length > 0) {
        setClaimUrls(data.replay.stubs);
      }
      setDeclineOpenId(null);
      setDeclineReason('');
      setReloadKey(k => k + 1);
    } catch (e) {
      console.error('League request decision failed:', e);
      showError('Leagues', 'Decision failed');
    } finally {
      setActingId(null);
    }
  };

  const create = async () => {
    if (creating) return;
    if (!name.trim() || !owner) {
      showError('Leagues', 'A name and an owner are required');
      return;
    }
    setCreating(true);
    try {
      const response = await fetch('/api/admin/leagues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          sportKey,
          description: description.trim() || undefined,
          ownerProfileId: owner.id,
          place,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        showError('Leagues', data.error || 'Failed to create league');
        return;
      }
      showSuccess('Leagues', `${name.trim()} created`);
      setName('');
      setDescription('');
      setPlace(null);
      setPlaceText('');
      setOwner(null);
      setOwnerQuery('');
      setReloadKey(k => k + 1);
    } catch (e) {
      console.error('League create failed:', e);
      showError('Leagues', 'Failed to create league');
    } finally {
      setCreating(false);
    }
  };

  if (authLoading || authorized === null) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center max-w-md mx-auto px-4">
            <div className="w-16 h-16 bg-surface-sunken rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-lock text-2xl text-faint" aria-hidden="true"></i>
            </div>
            <h1 className="text-2xl font-bold text-primary mb-2">Admin access required</h1>
            <p className="text-sm text-tertiary">This area is for Edge Athlete administrators.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-8">
        <div>
          <Link href="/dashboard" className="text-sm text-brand-fg hover:text-brand-fg-strong">
            ← Admin
          </Link>
          <h1 className="mt-2 text-2xl sm:text-3xl font-bold text-primary">
            <i className="fas fa-trophy mr-2 text-brand-fg"></i>
            Leagues
          </h1>
        </div>

        {/* Pending self-service requests (116) */}
        {claimUrls.length > 0 && (
          <section className="bg-surface rounded-lg shadow-sm border border-brand p-4">
            <h2 className="text-sm font-semibold text-primary mb-2">
              Claim links for the new partner pages
            </h2>
            <p className="text-xs text-muted mb-2">
              Single-use, 30-day links — copy and send any that weren&apos;t emailed.
            </p>
            <ul className="space-y-1">
              {claimUrls.map(stub => (
                <li key={stub.name} className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-primary">{stub.name}</span>
                  {stub.emailSent && <span className="text-emerald-600">emailed</span>}
                  {stub.claimUrl ? (
                    <button
                      type="button"
                      onClick={() => void navigator.clipboard.writeText(stub.claimUrl!)}
                      className="px-2 py-0.5 rounded-md border border-border-strong text-secondary hover:bg-surface-sunken"
                    >
                      Copy link
                    </button>
                  ) : (
                    <span className="text-red-600">invite failed — re-approve mints nothing; re-mint manually</span>
                  )}
                  {stub.claimUrl && <code className="text-muted break-all">{stub.claimUrl}</code>}
                </li>
              ))}
            </ul>
          </section>
        )}
        {pendingRequests.length > 0 && (
          <section className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
            <h2 className="text-lg font-semibold text-primary mb-4">Pending requests</h2>
            <ul className="space-y-3">
              {pendingRequests.map(req => (
                <li key={req.id} className="border border-border rounded-lg p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-primary">{req.name}</p>
                      <p className="text-sm text-muted">
                        {SPORT_REGISTRY[req.sport_key as keyof typeof SPORT_REGISTRY]?.display_name ?? req.sport_key}
                        {(req.city || req.country) ? ` · ${[req.city, req.country].filter(Boolean).join(', ')}` : ''}
                      </p>
                      <p className="text-xs text-muted mt-1">
                        By {req.requester
                          ? formatDisplayName(req.requester.first_name, null, req.requester.last_name, req.requester.full_name)
                          : 'Unknown'}
                        {req.requester?.handle ? ` · @${req.requester.handle}` : ''}
                        {` · ${new Date(req.created_at).toLocaleDateString()}`}
                      </p>
                      {req.description && (
                        <p className="text-sm text-secondary mt-2 line-clamp-3">{req.description}</p>
                      )}
                      {req.previewUrl && (
                        <a
                          href={req.previewUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-block mt-2 text-sm text-brand-fg font-medium hover:text-brand-fg-strong"
                        >
                          Preview draft site ↗
                        </a>
                      )}
                      {(req.operates_competitions !== null || req.structure_draft || req.connections_draft) && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {req.operates_competitions && (
                            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase rounded-full bg-surface-sunken text-secondary">Runs competitions</span>
                          )}
                          {req.operates_teams && (
                            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase rounded-full bg-surface-sunken text-secondary">Runs teams</span>
                          )}
                          {req.structure_draft && (
                            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase rounded-full bg-brand-soft text-brand-fg">
                              {req.structure_draft.divisions?.length ?? 0} divisions · {req.structure_draft.teams?.length ?? 0} teams
                            </span>
                          )}
                          {req.connections_draft && (
                            <span className="px-2 py-0.5 text-[10px] font-semibold uppercase rounded-full bg-brand-soft text-brand-fg">
                              {req.connections_draft.existing?.length ?? 0} connections · {req.connections_draft.stubs?.length ?? 0} new
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={actingId === req.id}
                        onClick={() => decide(req.id, 'approve')}
                        className="px-3 py-1.5 min-h-[36px] rounded-md text-xs font-medium bg-brand text-white hover:bg-brand-hover disabled:opacity-60"
                      >
                        Approve
                      </button>
                      <button
                        type="button"
                        disabled={actingId === req.id}
                        onClick={() => {
                          setDeclineOpenId(declineOpenId === req.id ? null : req.id);
                          setDeclineReason('');
                        }}
                        className="px-3 py-1.5 min-h-[36px] rounded-md text-xs font-medium border border-border-strong text-secondary hover:bg-surface-sunken disabled:opacity-60"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                  {declineOpenId === req.id && (
                    <div className="mt-3 flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={declineReason}
                        maxLength={500}
                        onChange={e => setDeclineReason(e.target.value)}
                        placeholder="Reason (required — shown to the requester)"
                        className="flex-1 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                      />
                      <button
                        type="button"
                        disabled={!declineReason.trim() || actingId === req.id}
                        onClick={() => decide(req.id, 'decline', declineReason.trim())}
                        className="px-3 py-2 min-h-[36px] rounded-md text-xs font-medium bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
                      >
                        Confirm decline
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Create */}
        <section className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-primary mb-4">Create a league</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="league-name" className="block text-sm font-medium text-secondary mb-1">Name</label>
              <input
                id="league-name"
                type="text"
                value={name}
                maxLength={120}
                onChange={e => setName(e.target.value)}
                placeholder="e.g., Ottawa Junior Golf League"
                className="w-full px-3 py-2 border border-border-strong rounded-md outline-none"
              />
            </div>
            <div>
              <label htmlFor="league-sport" className="block text-sm font-medium text-secondary mb-1">Sport</label>
              <select
                id="league-sport"
                value={sportKey}
                onChange={e => setSportKey(e.target.value)}
                className="w-full px-3 py-2 border border-border-strong rounded-md outline-none"
              >
                {FEATURE_FLAGS.FEATURE_SPORTS.map(key => (
                  <option key={key} value={key}>
                    {SPORT_REGISTRY[key]?.display_name ?? key}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label htmlFor="league-description" className="block text-sm font-medium text-secondary mb-1">Description</label>
              <textarea
                id="league-description"
                value={description}
                maxLength={2000}
                rows={3}
                onChange={e => setDescription(e.target.value)}
                className="w-full px-3 py-2 border border-border-strong rounded-md outline-none resize-y"
              />
            </div>
            <div>
              <label htmlFor="league-place" className="block text-sm font-medium text-secondary mb-1">Location</label>
              <PlacePicker
                id="league-place"
                value={place}
                text={placeText}
                allowFreeText={false}
                placeholder="City or town"
                onChange={(nextPlace, text) => {
                  setPlace(nextPlace);
                  setPlaceText(text);
                }}
                className="w-full px-3 py-2 border border-border-strong rounded-md outline-none"
              />
            </div>
            <div>
              <label htmlFor="league-owner" className="block text-sm font-medium text-secondary mb-1">Owner</label>
              {owner ? (
                <div className="flex items-center justify-between px-3 py-2 border border-border-strong rounded-md bg-surface-sunken">
                  <span className="text-sm text-primary truncate">
                    {formatDisplayName(owner.first_name, null, owner.last_name, owner.full_name)}
                    {owner.email ? ` · ${owner.email}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => setOwner(null)}
                    aria-label="Clear owner"
                    className="ml-2 text-muted hover:text-primary"
                  >
                    <i className="fas fa-times" aria-hidden="true"></i>
                  </button>
                </div>
              ) : (
                <>
                  <input
                    id="league-owner"
                    type="text"
                    value={ownerQuery}
                    onChange={e => {
                      setOwnerQuery(e.target.value);
                      if (!e.target.value.trim()) setOwnerResults([]);
                    }}
                    placeholder="Search users by name, handle or email"
                    className="w-full px-3 py-2 border border-border-strong rounded-md outline-none"
                  />
                  {ownerResults.length > 0 && (
                    <ul className="mt-1 border border-border rounded-md divide-y divide-border-subtle bg-surface-raised">
                      {ownerResults.map(candidate => (
                        <li key={candidate.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setOwner(candidate);
                              setOwnerResults([]);
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-surface-muted"
                          >
                            <span className="text-primary">
                              {formatDisplayName(candidate.first_name, null, candidate.last_name, candidate.full_name)}
                            </span>
                            {candidate.email && <span className="text-muted"> · {candidate.email}</span>}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={create}
              disabled={creating}
              className="px-4 py-2 text-sm min-h-[40px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-60"
            >
              {creating ? 'Creating…' : 'Create league'}
            </button>
          </div>
        </section>

        {/* List */}
        <section className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-primary mb-4">All leagues</h2>
          {leagues.length === 0 ? (
            <p className="text-sm text-tertiary">No leagues yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted border-b border-border-subtle">
                    <th className="py-2 pr-3">Name</th>
                    <th className="py-2 pr-3">Sport</th>
                    <th className="py-2 pr-3">Owner</th>
                    <th className="py-2 pr-3">Members</th>
                    <th className="py-2"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-subtle">
                  {leagues.map(league => (
                    <tr key={league.id}>
                      <td className="py-2 pr-3">
                        <span className="text-primary font-medium">{league.name}</span>
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {league.operates_competitions && (
                            <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-surface-sunken text-secondary">runs competitions</span>
                          )}
                          {league.operates_teams && (
                            <span className="px-1.5 py-0.5 text-[10px] rounded-full bg-surface-sunken text-secondary">runs teams</span>
                          )}
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-secondary">
                        {SPORT_REGISTRY[league.sport_key as keyof typeof SPORT_REGISTRY]?.display_name ?? league.sport_key}
                      </td>
                      <td className="py-2 pr-3 text-secondary">
                        {league.owner
                          ? formatDisplayName(league.owner.first_name, null, league.owner.last_name, league.owner.full_name)
                          : '—'}
                      </td>
                      <td className="py-2 pr-3 text-secondary">{league.memberCount}</td>
                      <td className="py-2 text-right">
                        <Link href={`/league/${league.id}`} className="text-brand-fg hover:text-brand-fg-strong">
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
