'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatPlace } from '@/lib/geo/regions';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { SUGGEST_DEBOUNCE_MS } from '@/lib/search/typeahead';

// Explore's org discovery section (connections PR B) — mirrors
// ExploreCoursesSection: fully self-contained (own search box + near-me,
// own heading, own fetches), mounted outside the page's loading gate.
// Consumes /api/search?type=leagues|clubs (two typed calls — quotas stay
// clean; search_all does the ranking, no new SQL). An active sport chip on
// the page filters the LEAGUES list only — clubs are multi-sport.

interface OrgRow {
  id: string;
  name: string;
  city: string | null;
  region: string | null;
  country: string | null;
  sport_key?: string | null;
}

interface ExploreOrgsSectionProps {
  /** The page's active sport chip; filters leagues client-side. */
  sportKey?: string | null;
}

export default function ExploreOrgsSection({ sportKey }: ExploreOrgsSectionProps) {
  const [query, setQuery] = useState('');
  const [near, setNear] = useState<{ lat: number; lng: number } | null>(null);
  const [nearError, setNearError] = useState<string | null>(null);
  const [leagues, setLeagues] = useState<OrgRow[]>([]);
  const [clubs, setClubs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const q = query.trim();
    // Browse needs a query OR a location (the search route's own rule).
    if (q.length < 2 && !near) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (q.length >= 2) params.set('q', q);
        if (near) {
          params.set('near', `${near.lat},${near.lng}`);
          params.set('radius', '50');
        }
        const [leaguesRes, clubsRes] = await Promise.all([
          fetch(`/api/search?${params}&type=leagues`),
          fetch(`/api/search?${params}&type=clubs`),
        ]);
        if (cancelled) return;
        const leaguesBody = leaguesRes.ok ? await leaguesRes.json() : null;
        const clubsBody = clubsRes.ok ? await clubsRes.json() : null;
        if (cancelled) return;
        setLeagues((leaguesBody?.results?.leagues ?? []) as OrgRow[]);
        setClubs((clubsBody?.results?.clubs ?? []) as OrgRow[]);
      } catch {
        /* discovery is additive — a failed search leaves the lists as-is */
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, SUGGEST_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, near]);

  const nearMe = () => {
    if (near) {
      setNear(null);
      return;
    }
    if (!navigator.geolocation) {
      setNearError('Location is not available in this browser');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setNearError(null);
        setNear({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      () => setNearError('Could not get your location')
    );
  };

  // Filter only for a real registry key — the page's chip state may carry
  // an 'all'-style sentinel, and clubs are never filtered (multi-sport).
  const filterKey = sportKey && sportKey in SPORT_REGISTRY ? sportKey : null;
  const visibleLeagues = filterKey
    ? leagues.filter(l => l.sport_key === filterKey)
    : leagues;
  const hasResults = visibleLeagues.length > 0 || clubs.length > 0;
  const searched = query.trim().length >= 2 || near !== null;

  const orgRow = (org: OrgRow, kind: 'league' | 'club') => {
    const sport = org.sport_key
      ? SPORT_REGISTRY[org.sport_key as keyof typeof SPORT_REGISTRY]?.display_name ?? org.sport_key
      : null;
    const place = formatPlace({ city: org.city, region: org.region, country: org.country });
    return (
      <li key={org.id}>
        <Link
          href={kind === 'league' ? `/league/${org.id}` : `/club/${org.id}`}
          className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-surface-muted transition-colors min-w-0"
        >
          <i
            className={`fas ${kind === 'league' ? 'fa-trophy' : 'fa-building'} text-brand-fg shrink-0`}
            aria-hidden="true"
          ></i>
          <div className="min-w-0">
            <p className="font-medium text-primary truncate">{org.name}</p>
            <p className="text-sm text-muted truncate">
              {[sport, place].filter(Boolean).join(' · ') || '—'}
            </p>
          </div>
        </Link>
      </li>
    );
  };

  return (
    <section aria-labelledby="explore-orgs" className="bg-surface rounded-xl shadow-sm border border-border p-4 sm:p-6 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <h2 id="explore-orgs" className="text-lg font-semibold text-primary">
          Leagues &amp; Clubs
        </h2>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search leagues and clubs…"
            className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm w-56"
          />
          <button
            type="button"
            onClick={nearMe}
            aria-pressed={near !== null}
            className={`px-3 py-2 min-h-[40px] rounded-md text-sm font-medium transition-colors ${
              near
                ? 'bg-brand text-white hover:bg-brand-hover'
                : 'border border-border-strong text-secondary hover:bg-surface-sunken'
            }`}
          >
            Near me
          </button>
        </div>
      </div>
      {nearError && <p className="text-sm text-red-600 mb-3">{nearError}</p>}

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand"></div>
        </div>
      ) : hasResults ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 className="text-sm font-semibold text-secondary mb-1">Leagues</h3>
            {visibleLeagues.length > 0 ? (
              <ul className="divide-y divide-border-subtle">
                {visibleLeagues.slice(0, 6).map(l => orgRow(l, 'league'))}
              </ul>
            ) : (
              <p className="text-sm text-tertiary py-2">No leagues found.</p>
            )}
          </div>
          <div>
            <h3 className="text-sm font-semibold text-secondary mb-1">Clubs</h3>
            {clubs.length > 0 ? (
              <ul className="divide-y divide-border-subtle">
                {clubs.slice(0, 6).map(c => orgRow(c, 'club'))}
              </ul>
            ) : (
              <p className="text-sm text-tertiary py-2">No clubs found.</p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-tertiary py-2">
          {searched
            ? 'Nothing found — try a different name or place.'
            : 'Search by name, or use Near me to find leagues and clubs around you.'}
        </p>
      )}

      <div className="mt-4 pt-3 border-t border-border-subtle flex flex-wrap gap-3">
        <Link href="/league/start" className="text-sm text-brand-fg hover:text-brand-fg-strong">
          Start a league →
        </Link>
        <Link href="/club/start" className="text-sm text-brand-fg hover:text-brand-fg-strong">
          Start a club →
        </Link>
      </div>
    </section>
  );
}
