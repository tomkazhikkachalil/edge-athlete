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
        const response = await fetch('/api/admin/leagues');
        if (cancelled) return;
        if (response.status === 403) {
          setAuthorized(false);
          return;
        }
        const data = await response.json();
        if (cancelled) return;
        setAuthorized(true);
        setLeagues(data.leagues ?? []);
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
                      <td className="py-2 pr-3 text-primary font-medium">{league.name}</td>
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
