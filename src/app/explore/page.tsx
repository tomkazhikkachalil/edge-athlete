'use client';

/**
 * Explore — discovery surface for athletes and activity across all sports.
 *
 * Browse-first (no search query needed): sport filter chips drive both the
 * athlete grid and the recent-activity list. Complements the header's
 * AdvancedSearchBar (query-based) with the kind of discovery surface every
 * strong sports/social network leads with.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import AppHeader from '@/components/AppHeader';
import ExploreCoursesSection from '@/components/golf/ExploreCoursesSection';
import LazyImage from '@/components/LazyImage';
import LiveNowStrip from '@/components/LiveNowStrip';
import { formatDistanceToNow } from 'date-fns';
import { getAllSports, getEnabledSports, type SportKey } from '@/lib/sports/SportRegistry';
import { formatDisplayName } from '@/lib/formatters';
import { getHandle } from '@/lib/profile-display';
import PlacePicker, { type PlaceValue } from '@/components/PlacePicker';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { formatPlace } from '@/lib/geo/regions';

interface ExploreAthlete {
  id: string;
  full_name: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  handle: string | null;
  sport: string | null;
  school: string | null;
  location: string | null;
  // Structured location (108); distance only on a "near" search.
  city?: string | null;
  region?: string | null;
  country?: string | null;
  distance_km?: number | null;
}

interface ExplorePostProfile {
  id: string;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  handle: string | null;
  sport: string | null;
  school: string | null;
}

interface ExplorePost {
  id: string;
  caption: string | null;
  sport_key: string | null;
  created_at: string;
  likes_count: number;
  comments_count: number;
  profile: ExplorePostProfile | ExplorePostProfile[] | null;
  media: Array<{ id: string }>;
}

const postProfile = (p: ExplorePost): ExplorePostProfile | null =>
  Array.isArray(p.profile) ? (p.profile[0] ?? null) : p.profile;

export default function ExplorePage() {
  const [selectedSport, setSelectedSport] = useState<SportKey | null>(null);
  // Athlete search (108): free text, a picked place (50 km), or the
  // device's position. `q` is the debounced value the fetch keys on.
  const [qInput, setQInput] = useState('');
  const [q, setQ] = useState('');
  const [place, setPlace] = useState<PlaceValue | null>(null);
  const [placeText, setPlaceText] = useState('');
  const [nearMe, setNearMe] = useState<{ lat: number; lng: number } | null>(null);
  const [nearMeError, setNearMeError] = useState<string | null>(null);
  const [debouncedSetQ] = useDebouncedCallback((_signal: AbortSignal, value: string) => setQ(value.trim()), 250);
  const [athletes, setAthletes] = useState<ExploreAthlete[]>([]);
  const [posts, setPosts] = useState<ExplorePost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const enabledKeys = new Set(getEnabledSports().map(s => s.sport_key));
  // Enabled sports first, then the rest of the catalog
  const sportChips = [...getAllSports()].sort(
    (a, b) => Number(b.enabled) - Number(a.enabled)
  );

  // Inlined cancellable IIFE: the rule flags the call site of a setState-ing
  // function, and the guard stops a slow response for a previously selected
  // sport chip from landing after a newer one.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (selectedSport) params.set('sport', selectedSport);
        if (q) params.set('q', q);
        // A picked place or the device position → "near" (50 km).
        const near = nearMe ?? (place ? { lat: place.lat, lng: place.lng } : null);
        if (near) {
          params.set('near', `${near.lat},${near.lng}`);
          params.set('radius', '50');
        }
        const response = await fetch(`/api/explore?${params.toString()}`, {
          credentials: 'include',
        });
        if (!response.ok) {
          throw new Error(`Explore request failed (${response.status})`);
        }
        const data = await response.json();
        if (cancelled) return;
        setAthletes(data.athletes || []);
        setPosts(data.posts || []);
      } catch (e) {
        console.error('[explore] fetch failed:', e);
        if (!cancelled) setError('Could not load Explore right now. Please try again.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedSport, q, place, nearMe]);

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader />

      <main className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        {/* Heading */}
        <div className="mb-6">
          <h1 className="text-h1 font-bold text-primary">Explore</h1>
          <p className="text-tertiary mt-1">
            Discover athletes and activity across every sport.
          </p>
        </div>

        {/* Live Now — fuller grid than the feed strip */}
        <LiveNowStrip variant="grid" />

        {/* Athlete search (108): name/handle text, a place (50 km), or
            Near me. Guest-safe — the endpoint serves public profiles only. */}
        <div className="mb-4 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <div className="relative">
            <i className="fas fa-search absolute left-3 top-1/2 -translate-y-1/2 text-xs text-faint" aria-hidden="true"></i>
            <input
              type="search"
              value={qInput}
              onChange={e => {
                setQInput(e.target.value);
                debouncedSetQ(e.target.value);
              }}
              placeholder="Search athletes by name"
              aria-label="Search athletes"
              className="w-full min-h-[44px] rounded-lg border border-border bg-surface pl-9 pr-3 text-sm text-primary placeholder:text-faint"
            />
          </div>
          <PlacePicker
            value={place}
            text={placeText}
            allowFreeText={false}
            placeholder="Near a city or town"
            onChange={(next, text) => {
              setPlaceText(text);
              setPlace(next);
              if (next) {
                setNearMe(null);
                setNearMeError(null);
              }
            }}
            className="w-full min-h-[44px] rounded-lg border border-border bg-surface px-3 text-sm text-primary placeholder:text-faint"
          />
          <button
            type="button"
            aria-pressed={!!nearMe}
            onClick={() => {
              if (nearMe) {
                setNearMe(null);
                return;
              }
              if (!('geolocation' in navigator)) {
                setNearMeError('Location is not available on this device.');
                return;
              }
              setNearMeError(null);
              navigator.geolocation.getCurrentPosition(
                pos => {
                  setNearMe({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                  setPlace(null);
                  setPlaceText('');
                },
                () => setNearMeError('Could not get your location — allow it in the browser, or pick a city.'),
                { maximumAge: 300_000, timeout: 10_000 }
              );
            }}
            className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium ea-interactive ${
              nearMe ? 'border-brand bg-brand text-white' : 'border-border bg-surface text-brand-fg'
            }`}
          >
            <i className="fas fa-location-crosshairs" aria-hidden="true"></i>
            Near me
          </button>
        </div>
        {nearMeError && <p className="mb-4 text-xs text-tertiary">{nearMeError}</p>}

        {/* Sport filter chips */}
        <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-2 mb-6 -mx-4 px-4 sm:mx-0 sm:px-0" role="tablist" aria-label="Filter by sport">
          <button
            role="tab"
            aria-selected={selectedSport === null}
            onClick={() => setSelectedSport(null)}
            className={`shrink-0 min-h-[44px] px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
              selectedSport === null
                ? 'bg-brand text-white border-brand'
                : 'bg-surface text-secondary border-border-strong hover:bg-surface-sunken'
            }`}
          >
            All Sports
          </button>
          {sportChips.map(sport => (
            <button
              key={sport.sport_key}
              role="tab"
              aria-selected={selectedSport === sport.sport_key}
              onClick={() =>
                setSelectedSport(
                  selectedSport === sport.sport_key ? null : sport.sport_key
                )
              }
              className={`shrink-0 min-h-[44px] inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                selectedSport === sport.sport_key
                  ? 'bg-brand text-white border-brand'
                  : enabledKeys.has(sport.sport_key)
                    ? 'bg-surface text-secondary border-border-strong hover:bg-surface-sunken'
                    : 'bg-surface text-faint border-border hover:bg-surface-muted'
              }`}
              title={enabledKeys.has(sport.sport_key) ? sport.display_name : `${sport.display_name} — coming soon`}
            >
              <i className={sport.icon_id} aria-hidden="true"></i>
              {sport.display_name}
            </button>
          ))}
        </div>

        {error && (
          <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-6 text-red-700 dark:text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Courses ride the golf chip — own loading state, deliberately
            OUTSIDE the athletes/posts loading gate so course typing never
            flashes the rest of the page. Guest-safe end to end. */}
        {selectedSport === 'golf' && <ExploreCoursesSection />}

        {loading ? (
          <div className="flex items-center justify-center py-24">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Athletes */}
            <section className="lg:col-span-2" aria-labelledby="explore-athletes">
              <h2 id="explore-athletes" className="text-h3 font-bold text-primary mb-4">
                Athletes
              </h2>
              {athletes.length === 0 ? (
                <div className="bg-surface rounded-lg border border-border p-8 text-center text-muted">
                  <i className="fas fa-users text-3xl text-gray-300 dark:text-stone-600 mb-3" aria-hidden="true"></i>
                  <p>No athletes found{selectedSport ? ' for this sport yet' : ''}.</p>
                  <p className="text-sm mt-1">Invite your teammates to join Edge Athlete!</p>
                </div>
              ) : (
                <div className="grid sm:grid-cols-2 gap-4">
                  {athletes.map(a => (
                    <Link
                      key={a.id}
                      href={`/athlete/${a.id}`}
                      className="bg-surface rounded-lg border border-border p-4 flex items-center gap-3 hover:shadow-md hover:border-violet-300 dark:hover:border-violet-700 transition-all"
                    >
                      {a.avatar_url ? (
                        <LazyImage
                          src={a.avatar_url}
                          alt=""
                          width={48}
                          height={48}
                          className="w-12 h-12 rounded-full object-cover shrink-0"
                        />
                      ) : (
                        <div className="w-12 h-12 rounded-full bg-violet-100 dark:bg-violet-950/60 text-brand-fg-strong flex items-center justify-center font-bold shrink-0">
                          {(a.first_name?.[0] ?? a.full_name?.[0] ?? '?').toUpperCase()}
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="font-bold text-black dark:text-primary truncate">
                          {a.full_name || formatDisplayName(a.first_name, a.middle_name, a.last_name)}
                        </div>
                        <div className="text-sm text-muted truncate">{getHandle(a)}</div>
                        <div className="text-xs text-tertiary truncate">
                          {[
                            a.sport,
                            a.school,
                            formatPlace({ city: a.city, region: a.region, country: a.country }) || a.location,
                            typeof a.distance_km === 'number' ? `${Math.round(a.distance_km)} km` : null,
                          ]
                            .filter(Boolean)
                            .join(' • ')}
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            {/* Recent activity */}
            <section aria-labelledby="explore-activity">
              <h2 id="explore-activity" className="text-h3 font-bold text-primary mb-4">
                Recent Activity
              </h2>
              {posts.length === 0 ? (
                <div className="bg-surface rounded-lg border border-border p-8 text-center text-muted">
                  <i className="fas fa-bolt text-3xl text-gray-300 dark:text-stone-600 mb-3" aria-hidden="true"></i>
                  <p>No public activity{selectedSport ? ' for this sport yet' : ''}.</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {posts.slice(0, 12).map(p => {
                    const prof = postProfile(p);
                    return (
                      <Link
                        key={p.id}
                        href={prof ? `/athlete/${prof.id}` : '/feed'}
                        className="block bg-surface rounded-lg border border-border p-3 hover:shadow-md hover:border-violet-300 dark:hover:border-violet-700 transition-all"
                      >
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-black dark:text-primary text-sm truncate">
                            {prof
                              ? prof.full_name || formatDisplayName(prof.first_name, null, prof.last_name)
                              : 'Athlete'}
                          </span>
                          <span className="text-xs text-faint shrink-0">
                            {formatDistanceToNow(new Date(p.created_at), { addSuffix: true })}
                          </span>
                        </div>
                        {p.caption && (
                          <p className="text-sm text-secondary line-clamp-2 mb-1">{p.caption}</p>
                        )}
                        <div className="flex items-center gap-3 text-xs text-muted">
                          {p.sport_key && p.sport_key !== 'general' && (
                            <span className="px-2 py-0.5 bg-brand-soft text-brand-fg-strong rounded-full font-semibold">
                              {p.sport_key.replace('_', ' ')}
                            </span>
                          )}
                          {p.media.length > 0 && (
                            <span>
                              <i className="fas fa-image mr-1" aria-hidden="true"></i>
                              {p.media.length}
                            </span>
                          )}
                          <span>
                            <i className="fas fa-heart mr-1" aria-hidden="true"></i>
                            {p.likes_count}
                          </span>
                          <span>
                            <i className="fas fa-comment mr-1" aria-hidden="true"></i>
                            {p.comments_count}
                          </span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
