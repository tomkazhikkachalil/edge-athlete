'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import { toParLabel, toParColorClass } from '@/lib/golf/scoring';

interface RoundSummary {
  id: string;
  date: string;
  course: string;
  course_location: string | null;
  tee: string | null;
  holes: number;
  round_type: string;
  par: number;
  gross_score: number | null;
  total_putts: number | null;
  fir_percentage: number | null;
  gir_percentage: number | null;
  is_complete: boolean;
}

type HolesFilter = 'all' | '9' | '18';
type SortOrder = 'newest' | 'oldest';

export default function GolfRoundsListPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [rounds, setRounds] = useState<RoundSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [holesFilter, setHolesFilter] = useState<HolesFilter>('all');
  const [courseSearch, setCourseSearch] = useState('');
  const [sort, setSort] = useState<SortOrder>('newest');

  // Debounce + stale-response guard for the course search
  const requestSeqRef = useRef(0);
  const loadInFlightRef = useRef(false);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/');
    }
  }, [user, authLoading, router]);

  const buildQuery = useCallback((offset: number) => {
    const params = new URLSearchParams({ limit: '20', offset: String(offset), sort });
    if (holesFilter !== 'all') params.set('holes', holesFilter);
    if (courseSearch.trim()) params.set('course', courseSearch.trim());
    return params.toString();
  }, [holesFilter, courseSearch, sort]);

  // The loading/error reset is synchronisation keyed on the same inputs that
  // trigger the fetch; doing it during render keeps stale rows from painting
  // while the new query is in flight.
  const [syncedQuery, setSyncedQuery] = useState({ uid: user?.id, holesFilter, courseSearch, sort });
  if (
    syncedQuery.uid !== user?.id ||
    syncedQuery.holesFilter !== holesFilter ||
    syncedQuery.courseSearch !== courseSearch ||
    syncedQuery.sort !== sort
  ) {
    setSyncedQuery({ uid: user?.id, holesFilter, courseSearch, sort });
    if (user?.id) {
      setLoading(true);
      setError(null);
    }
  }

  // Initial load + reload on filter change (debounced for the text input)
  useEffect(() => {
    if (!user?.id) return;
    const seq = ++requestSeqRef.current;

    const timer = setTimeout(async () => {
      try {
        const response = await fetch(`/api/golf/rounds?${buildQuery(0)}`);
        if (seq !== requestSeqRef.current) return; // stale
        if (!response.ok) {
          setError('Failed to load rounds');
          return;
        }
        const data = await response.json();
        if (seq !== requestSeqRef.current) return; // stale
        setRounds(data.rounds);
        setTotal(data.total);
        setHasMore(data.hasMore);
        setNextOffset(data.nextOffset);
      } catch (e) {
        if (seq !== requestSeqRef.current) return;
        console.error('Failed to load rounds:', e);
        setError('Failed to load rounds');
      } finally {
        if (seq === requestSeqRef.current) setLoading(false);
      }
    }, courseSearch ? 300 : 0);

    return () => clearTimeout(timer);
  }, [user?.id, buildQuery, courseSearch]);

  const loadMore = async () => {
    if (loadInFlightRef.current || !hasMore) return;
    loadInFlightRef.current = true;
    setLoadingMore(true);
    const seq = requestSeqRef.current;
    try {
      const response = await fetch(`/api/golf/rounds?${buildQuery(nextOffset)}`);
      if (seq !== requestSeqRef.current) return; // filters changed mid-flight
      if (response.ok) {
        const data = await response.json();
        if (seq !== requestSeqRef.current) return;
        setRounds(prev => {
          const seen = new Set(prev.map(r => r.id));
          return [...prev, ...data.rounds.filter((r: RoundSummary) => !seen.has(r.id))];
        });
        setHasMore(data.hasMore);
        setNextOffset(data.nextOffset);
      }
    } catch (e) {
      console.error('Failed to load more rounds:', e);
    } finally {
      loadInFlightRef.current = false;
      setLoadingMore(false);
    }
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />

      <div className="max-w-3xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-primary">
              <i className="fas fa-golf-ball mr-2 text-green-600 dark:text-green-400"></i>
              My Rounds
            </h1>
            {!loading && (
              <p className="text-sm text-muted mt-1">
                {total} round{total !== 1 ? 's' : ''} logged
              </p>
            )}
          </div>
          <div className="flex items-center gap-4">
            <Link
              href="/app/sport/golf/trends"
              className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium min-h-[44px] flex items-center"
            >
              <i className="fas fa-chart-line mr-1"></i>
              Trends
            </Link>
            <Link
              href="/athlete"
              className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium min-h-[44px] flex items-center"
            >
              ← Profile
            </Link>
          </div>
        </div>

        {/* Filters */}
        <div className="bg-surface rounded-lg shadow-sm border border-border p-3 sm:p-4 mb-6">
          <div className="flex flex-col sm:flex-row gap-3">
            <input
              type="search"
              value={courseSearch}
              onChange={e => setCourseSearch(e.target.value)}
              placeholder="Search by course…"
              className="flex-1 px-3 py-2 min-h-[44px] border border-border-strong rounded-md text-sm text-primary focus:outline-none focus:ring-2 focus:ring-violet-500"
              aria-label="Search rounds by course"
            />
            <div className="flex gap-2">
              {(['all', '9', '18'] as HolesFilter[]).map(f => (
                <button
                  key={f}
                  onClick={() => setHolesFilter(f)}
                  className={`px-4 py-2 min-h-[44px] rounded-md text-sm font-medium transition-colors ${
                    holesFilter === f
                      ? 'bg-green-600 text-white'
                      : 'bg-surface-sunken text-secondary hover:bg-gray-200 dark:hover:bg-stone-800'
                  }`}
                >
                  {f === 'all' ? 'All' : `${f} holes`}
                </button>
              ))}
              <button
                onClick={() => setSort(s => (s === 'newest' ? 'oldest' : 'newest'))}
                className="px-3 py-2 min-h-[44px] rounded-md text-sm font-medium bg-surface-sunken text-secondary hover:bg-gray-200 dark:hover:bg-stone-800"
                title={`Sorted ${sort} first`}
                aria-label={`Change sort order, currently ${sort} first`}
              >
                <i className={`fas ${sort === 'newest' ? 'fa-arrow-down' : 'fa-arrow-up'} mr-1`}></i>
                {sort === 'newest' ? 'Newest' : 'Oldest'}
              </button>
            </div>
          </div>
        </div>

        {/* Content */}
        {loading ? (
          <div className="text-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand mx-auto"></div>
            <p className="mt-3 text-tertiary">Loading rounds…</p>
          </div>
        ) : error ? (
          <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 px-4 py-3 rounded-md text-sm">
            {error}
          </div>
        ) : rounds.length === 0 ? (
          <div className="bg-surface rounded-lg shadow-sm border border-border p-10 text-center">
            <i className="fas fa-golf-ball text-4xl text-gray-300 mb-4"></i>
            <h2 className="text-lg font-semibold text-primary mb-2">
              {courseSearch || holesFilter !== 'all' ? 'No rounds match those filters' : 'No rounds logged yet'}
            </h2>
            <p className="text-sm text-muted mb-4">
              {courseSearch || holesFilter !== 'all'
                ? 'Try clearing the filters above.'
                : 'Log your first round and it will show up here.'}
            </p>
            {!courseSearch && holesFilter === 'all' && (
              <Link
                href="/feed?create=1"
                className="inline-flex items-center bg-green-600 text-white px-5 py-2.5 rounded-lg hover:bg-green-700 transition-colors font-medium"
              >
                <i className="fas fa-golf-ball mr-2"></i>
                Log a round
              </Link>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {rounds.map(round => {
              const toPar = round.gross_score !== null ? round.gross_score - round.par : null;
              return (
                <Link
                  key={round.id}
                  href={`/app/sport/golf/rounds/${round.id}`}
                  className="block bg-surface rounded-lg shadow-sm border border-border p-4 hover:border-green-300 dark:hover:border-green-700 hover:shadow transition-all"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-bold text-primary truncate">{round.course}</h3>
                        {!round.is_complete && (
                          <span className="px-2 py-0.5 bg-yellow-100 dark:bg-yellow-950/60 text-yellow-700 dark:text-yellow-300 text-xs rounded-full flex-shrink-0">
                            Partial
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted mt-0.5">
                        {new Date(round.date + 'T00:00:00').toLocaleDateString('en-US', {
                          month: 'short', day: 'numeric', year: 'numeric',
                        })}
                        {' · '}{round.holes} holes
                        {round.tee ? ` · ${round.tee} tees` : ''}
                        {round.round_type === 'indoor' ? ' · Indoor' : ''}
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-tertiary">
                        {round.total_putts !== null && round.total_putts > 0 && (
                          <span><i className="fas fa-flag mr-1 text-faint"></i>{round.total_putts} putts</span>
                        )}
                        {round.fir_percentage !== null && round.fir_percentage > 0 && (
                          <span>FIR {Math.round(round.fir_percentage)}%</span>
                        )}
                        {round.gir_percentage !== null && round.gir_percentage > 0 && (
                          <span>GIR {Math.round(round.gir_percentage)}%</span>
                        )}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-3xl font-bold text-primary">
                        {round.gross_score ?? '—'}
                      </div>
                      {toPar !== null && (
                        <div className={`text-sm font-semibold ${toParColorClass(toPar)}`}>
                          {toParLabel(toPar)}
                        </div>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}

            {hasMore && (
              <button
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full py-3 min-h-[44px] bg-surface border border-border-strong rounded-lg text-sm font-medium text-secondary hover:bg-surface-muted transition-colors disabled:opacity-50"
              >
                {loadingMore ? (
                  <><i className="fas fa-spinner fa-spin mr-2"></i>Loading…</>
                ) : (
                  'Load more rounds'
                )}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
