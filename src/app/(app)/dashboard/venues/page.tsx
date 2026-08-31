'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import ConfirmModal from '@/components/ConfirmModal';
import PlacePicker, { type PlaceValue } from '@/components/PlacePicker';
import { useToast } from '@/components/Toast';
import { SUGGEST_DEBOUNCE_MS } from '@/lib/search/typeahead';

// Admin venue console (0.4): the ONLY venue creator in v1 (Tom, Aug 30) —
// org/manager venue UX arrives with phase 1's org dashboard. Venues are
// created ORPHAN (the owning-org columns gain a writer in phase 1); the
// golf-club link is recognition against the 125 reference catalog.
// Access = ADMIN_EMAILS, enforced server-side; a 403 renders the lock panel.

interface FacilityRow {
  id: string;
  name: string;
  kind: string | null;
}

interface AdminVenueRow {
  id: string;
  name: string;
  league_id: string | null;
  club_id: string | null;
  golf_club_id: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  created_at: string;
  facilities: FacilityRow[];
  golfClubName: string | null;
}

interface GolfClubCandidate {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
}

interface FacilityDraft {
  name: string;
  kind: string;
}

export default function AdminVenuesPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { showSuccess, showError } = useToast();

  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [venues, setVenues] = useState<AdminVenueRow[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<AdminVenueRow | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Create form
  const [name, setName] = useState('');
  const [place, setPlace] = useState<PlaceValue | null>(null);
  const [placeText, setPlaceText] = useState('');
  const [golfQuery, setGolfQuery] = useState('');
  const [golfResults, setGolfResults] = useState<GolfClubCandidate[]>([]);
  const [golfClub, setGolfClub] = useState<GolfClubCandidate | null>(null);
  const [facilityDrafts, setFacilityDrafts] = useState<FacilityDraft[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!authLoading && !user) router.push('/');
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/admin/venues');
        if (cancelled) return;
        if (response.status === 403) {
          setAuthorized(false);
          return;
        }
        const data = await response.json();
        if (cancelled) return;
        setAuthorized(true);
        setVenues(data.venues ?? []);
      } catch {
        if (!cancelled) setAuthorized(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, reloadKey]);

  // Golf-club lookup over the 125 reference catalog. The empty-query clear
  // happens in the input's onChange — synchronous setState in an effect
  // body is the set-state-in-effect ERROR.
  useEffect(() => {
    const q = golfQuery.trim();
    if (q.length < 2) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/admin/venues/golf-clubs?q=${encodeURIComponent(q)}`);
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (!cancelled) setGolfResults(data.golfClubs ?? []);
      } catch {
        /* lookup is best-effort */
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [golfQuery]);

  const create = async () => {
    if (creating) return;
    if (!name.trim()) {
      showError('Venues', 'A name is required');
      return;
    }
    setCreating(true);
    try {
      const facilities = facilityDrafts
        .map(f => ({ name: f.name.trim(), kind: f.kind.trim() || undefined }))
        .filter(f => f.name.length > 0);
      const response = await fetch('/api/admin/venues', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          place,
          golfClubId: golfClub?.id,
          ...(facilities.length > 0 ? { facilities } : {}),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        showError('Venues', data.error || 'Failed to create venue');
        return;
      }
      showSuccess('Venues', `${name.trim()} created`);
      setName('');
      setPlace(null);
      setPlaceText('');
      setGolfClub(null);
      setGolfQuery('');
      setFacilityDrafts([]);
      setReloadKey(k => k + 1);
    } catch (e) {
      console.error('Venue create failed:', e);
      showError('Venues', 'Failed to create venue');
    } finally {
      setCreating(false);
    }
  };

  const removeVenue = async (target: AdminVenueRow) => {
    try {
      const response = await fetch(`/api/admin/venues/${encodeURIComponent(target.id)}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (!response.ok) {
        showError('Venues', data.error || 'Failed to delete venue');
        return;
      }
      showSuccess('Venues', 'Venue deleted');
      setReloadKey(k => k + 1);
    } catch (e) {
      console.error('Venue delete failed:', e);
      showError('Venues', 'Failed to delete venue');
    } finally {
      setDeleteTarget(null);
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
            <i className="fas fa-map-marker-alt mr-2 text-brand-fg"></i>
            Venues
          </h1>
        </div>

        {/* Create */}
        <section className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-primary mb-4">Create a venue</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="venue-name" className="block text-sm font-medium text-secondary mb-1">Name</label>
              <input
                id="venue-name"
                type="text"
                value={name}
                maxLength={120}
                onChange={e => setName(e.target.value)}
                placeholder="e.g., Kanata Recreation Complex"
                className="w-full px-3 py-2 border border-border-strong rounded-md outline-none"
              />
            </div>
            <div>
              <label htmlFor="venue-place" className="block text-sm font-medium text-secondary mb-1">Location</label>
              <PlacePicker
                id="venue-place"
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
            <div className="md:col-span-2">
              <label htmlFor="venue-golf" className="block text-sm font-medium text-secondary mb-1">
                Golf club link <span className="text-muted font-normal">(optional — the 125 catalog)</span>
              </label>
              {golfClub ? (
                <div className="flex items-center justify-between px-3 py-2 border border-border-strong rounded-md bg-surface-sunken">
                  <span className="text-sm text-primary truncate">
                    {golfClub.name}
                    {golfClub.city ? ` · ${golfClub.city}` : ''}
                  </span>
                  <button
                    type="button"
                    onClick={() => setGolfClub(null)}
                    aria-label="Clear golf club"
                    className="ml-2 text-muted hover:text-primary"
                  >
                    <i className="fas fa-times" aria-hidden="true"></i>
                  </button>
                </div>
              ) : (
                <>
                  <input
                    id="venue-golf"
                    type="text"
                    value={golfQuery}
                    onChange={e => {
                      setGolfQuery(e.target.value);
                      if (!e.target.value.trim()) setGolfResults([]);
                    }}
                    placeholder="Search golf clubs by name"
                    className="w-full px-3 py-2 border border-border-strong rounded-md outline-none"
                  />
                  {golfResults.length > 0 && (
                    <ul className="mt-1 border border-border rounded-md divide-y divide-border-subtle bg-surface-raised">
                      {golfResults.map(candidate => (
                        <li key={candidate.id}>
                          <button
                            type="button"
                            onClick={() => {
                              setGolfClub(candidate);
                              setGolfResults([]);
                            }}
                            className="w-full text-left px-3 py-2 text-sm hover:bg-surface-muted"
                          >
                            <span className="text-primary">{candidate.name}</span>
                            {(candidate.city || candidate.region) && (
                              <span className="text-muted">
                                {' '}· {[candidate.city, candidate.region].filter(Boolean).join(', ')}
                              </span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
            <div className="md:col-span-2">
              <p className="block text-sm font-medium text-secondary mb-1">Facilities</p>
              {facilityDrafts.length === 0 && (
                <p className="text-xs text-muted mb-2">A course, an ice pad, court 3, field B…</p>
              )}
              <div className="space-y-2">
                {facilityDrafts.map((draft, index) => (
                  <div key={index} className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={draft.name}
                      maxLength={120}
                      onChange={e =>
                        setFacilityDrafts(drafts =>
                          drafts.map((d, i) => (i === index ? { ...d, name: e.target.value } : d))
                        )
                      }
                      placeholder="Facility name"
                      aria-label={`Facility ${index + 1} name`}
                      className="grow basis-48 min-w-0 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                    />
                    <input
                      type="text"
                      value={draft.kind}
                      maxLength={40}
                      onChange={e =>
                        setFacilityDrafts(drafts =>
                          drafts.map((d, i) => (i === index ? { ...d, kind: e.target.value } : d))
                        )
                      }
                      placeholder="Kind (rink, court…)"
                      aria-label={`Facility ${index + 1} kind`}
                      className="w-40 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setFacilityDrafts(drafts => drafts.filter((_, i) => i !== index))}
                      aria-label={`Remove facility ${index + 1}`}
                      className="ea-icon-btn inline-flex items-center justify-center shrink-0 text-muted hover:text-red-600"
                    >
                      <i className="fas fa-times" aria-hidden="true"></i>
                    </button>
                  </div>
                ))}
              </div>
              {facilityDrafts.length < 20 && (
                <button
                  type="button"
                  onClick={() => setFacilityDrafts(drafts => [...drafts, { name: '', kind: '' }])}
                  className="mt-2 px-3 py-1.5 min-h-[36px] text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                >
                  + Add facility
                </button>
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
              {creating ? 'Creating…' : 'Create venue'}
            </button>
          </div>
        </section>

        {/* List */}
        <section className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
          <h2 className="text-lg font-semibold text-primary mb-4">All venues</h2>
          {venues.length === 0 ? (
            <p className="text-sm text-tertiary">No venues yet.</p>
          ) : (
            <ul className="space-y-3">
              {venues.map(venue => (
                <li key={venue.id} className="border border-border rounded-lg p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 grow basis-48">
                      <p className="font-medium text-primary">{venue.name}</p>
                      <p className="text-sm text-muted">
                        {[venue.city, venue.region, venue.country].filter(Boolean).join(', ') || 'No location'}
                        {venue.golfClubName ? ` · ⛳ ${venue.golfClubName}` : ''}
                      </p>
                      {venue.facilities.length > 0 && (
                        <p className="mt-1 flex flex-wrap gap-1">
                          {venue.facilities.map(f => (
                            <span
                              key={f.id}
                              className="px-2 py-0.5 text-xs rounded-full bg-surface-sunken text-secondary"
                            >
                              {f.name}
                              {f.kind ? ` · ${f.kind}` : ''}
                            </span>
                          ))}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setDeleteTarget(venue)}
                      aria-label={`Delete ${venue.name}`}
                      className="ea-icon-btn inline-flex items-center justify-center shrink-0 text-muted hover:text-red-600"
                    >
                      <i className="fas fa-trash" aria-hidden="true"></i>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <ConfirmModal
        isOpen={!!deleteTarget}
        title="Delete this venue?"
        message={`${deleteTarget?.name ?? 'This venue'} and its facilities are removed; any events pointing at them keep running with no venue.`}
        confirmText="Delete"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={() => deleteTarget && removeVenue(deleteTarget)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
