'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import TrendLineChart from '@/components/golf/TrendLineChart';
import { toParLabel, toParColorClass } from '@/lib/golf/scoring';
import { formatHandicapIndex } from '@/lib/golf/handicap';

interface TrendPoint {
  round_id: string;
  date: string;
  course: string;
  holes: number;
  gross_score: number;
  par: number;
  to_par: number;
  putts_per_hole: number | null;
  fir_pct: number | null;
  gir_pct: number | null;
}

interface HandicapPoint {
  date: string;
  index: number;
}

interface TrendSummary {
  rounds: number;
  avgToParLast5: number | null;
  avgToParAll: number | null;
  bestToPar: number | null;
  avgPuttsPerHole: number | null;
  avgFirPct: number | null;
  avgGirPct: number | null;
  handicapIndex: number | null;
  handicapRounds: number;
}

type HolesFilter = 'all' | '9' | '18';
type RangeFilter = 10 | 25 | 200;

const shortDate = (iso: string) =>
  new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export default function GolfTrendsPage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();

  const [series, setSeries] = useState<TrendPoint[]>([]);
  const [summary, setSummary] = useState<TrendSummary | null>(null);
  const [handicapSeries, setHandicapSeries] = useState<HandicapPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [holesFilter, setHolesFilter] = useState<HolesFilter>('all');
  const [range, setRange] = useState<RangeFilter>(25);
  const requestSeqRef = useRef(0);

  useEffect(() => {
    if (!authLoading && !user) router.push('/');
  }, [user, authLoading, router]);

  // Same as the rounds list: the loading/error reset is synchronisation keyed
  // on the fetch's own inputs, so it happens during render.
  const [syncedQuery, setSyncedQuery] = useState({ uid: user?.id, range, holesFilter });
  if (
    syncedQuery.uid !== user?.id ||
    syncedQuery.range !== range ||
    syncedQuery.holesFilter !== holesFilter
  ) {
    setSyncedQuery({ uid: user?.id, range, holesFilter });
    if (user?.id) {
      setLoading(true);
      setError(null);
    }
  }

  useEffect(() => {
    if (!user?.id) return;
    const seq = ++requestSeqRef.current;

    (async () => {
      try {
        const params = new URLSearchParams({ limit: String(range) });
        if (holesFilter !== 'all') params.set('holes', holesFilter);
        const response = await fetch(`/api/golf/trends?${params}`);
        if (seq !== requestSeqRef.current) return;
        if (!response.ok) {
          setError('Failed to load trends');
          return;
        }
        const data = await response.json();
        if (seq !== requestSeqRef.current) return;
        setSeries(data.series);
        setSummary(data.summary);
        setHandicapSeries(data.handicapSeries || []);
      } catch (e) {
        if (seq !== requestSeqRef.current) return;
        console.error('Failed to load trends:', e);
        setError('Failed to load trends');
      } finally {
        if (seq === requestSeqRef.current) setLoading(false);
      }
    })();
  }, [user?.id, holesFilter, range]);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600"></div>
      </div>
    );
  }

  const toParPoints = series.map(p => ({
    label: shortDate(p.date),
    value: p.to_par,
    meta: `${p.course} (${p.holes})`,
  }));
  const puttsPoints = series
    .filter(p => p.putts_per_hole !== null)
    .map(p => ({ label: shortDate(p.date), value: p.putts_per_hole as number, meta: p.course }));
  const firPoints = series
    .filter(p => p.fir_pct !== null)
    .map(p => ({ label: shortDate(p.date), value: p.fir_pct as number, meta: p.course }));
  const girPoints = series
    .filter(p => p.gir_pct !== null)
    .map(p => ({ label: shortDate(p.date), value: p.gir_pct as number, meta: p.course }));

  return (
    <div className="min-h-screen bg-gray-50">
      <AppHeader showSearch={false} />

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">
              <i className="fas fa-chart-line mr-2 text-green-600"></i>
              Golf Trends
            </h1>
            {summary && !loading && (
              <p className="text-sm text-gray-500 mt-1">
                Based on your last {summary.rounds} round{summary.rounds !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <Link
            href="/app/sport/golf/rounds"
            className="text-sm text-violet-600 hover:text-violet-700 font-medium min-h-[44px] flex items-center"
          >
            View rounds list →
          </Link>
        </div>

        {/* Filter row */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 mb-6">
          <div className="flex flex-wrap gap-2">
            {(['all', '18', '9'] as HolesFilter[]).map(f => (
              <button
                key={f}
                onClick={() => setHolesFilter(f)}
                className={`px-4 py-2 min-h-[44px] rounded-md text-sm font-medium transition-colors ${
                  holesFilter === f ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {f === 'all' ? 'All rounds' : `${f}-hole`}
              </button>
            ))}
            <div className="w-px bg-gray-200 mx-1 hidden sm:block" />
            {([10, 25, 200] as RangeFilter[]).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-4 py-2 min-h-[44px] rounded-md text-sm font-medium transition-colors ${
                  range === r ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {r === 200 ? 'All time' : `Last ${r}`}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-16">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-violet-600 mx-auto"></div>
            <p className="mt-3 text-gray-600">Crunching your rounds…</p>
          </div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">{error}</div>
        ) : series.length < 2 ? (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-10 text-center">
            <i className="fas fa-chart-line text-4xl text-gray-300 mb-4"></i>
            <h2 className="text-lg font-semibold text-gray-900 mb-2">Not enough rounds yet</h2>
            <p className="text-sm text-gray-500">
              Log at least two rounds{holesFilter !== 'all' ? ` (${holesFilter}-hole)` : ''} and your
              trends will appear here.
            </p>
          </div>
        ) : (
          <>
            {/* Stat tiles */}
            {summary && (
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
                  <div className="text-2xl font-bold text-green-700">
                    {summary.handicapIndex !== null ? formatHandicapIndex(summary.handicapIndex) : '—'}
                  </div>
                  <div className="text-xs text-gray-500 uppercase mt-1">
                    Handicap est.{summary.handicapIndex !== null ? ` · ${summary.handicapRounds} rds` : ''}
                  </div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
                  <div className={`text-2xl font-bold ${toParColorClass(summary.avgToParLast5)}`}>
                    {summary.avgToParLast5 !== null
                      ? (summary.avgToParLast5 > 0 ? `+${summary.avgToParLast5}` : summary.avgToParLast5)
                      : '—'}
                  </div>
                  <div className="text-xs text-gray-500 uppercase mt-1">Avg to par · last 5</div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
                  <div className={`text-2xl font-bold ${toParColorClass(summary.bestToPar)}`}>
                    {summary.bestToPar !== null ? toParLabel(summary.bestToPar) : '—'}
                  </div>
                  <div className="text-xs text-gray-500 uppercase mt-1">Best round</div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
                  <div className="text-2xl font-bold text-gray-900">
                    {summary.avgPuttsPerHole ?? '—'}
                  </div>
                  <div className="text-xs text-gray-500 uppercase mt-1">Putts per hole</div>
                </div>
                <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 text-center">
                  <div className="text-2xl font-bold text-gray-900">
                    {summary.avgGirPct !== null ? `${summary.avgGirPct}%` : '—'}
                  </div>
                  <div className="text-xs text-gray-500 uppercase mt-1">Avg GIR</div>
                </div>
              </div>
            )}

            {/* Handicap trend (full width) */}
            {handicapSeries.length >= 2 ? (
              <div className="mb-4">
                <TrendLineChart
                  title="Handicap index (estimated)"
                  points={handicapSeries.map(p => ({ label: shortDate(p.date), value: p.index }))}
                  color="#16a34a"
                  rollingWindow={0}
                  formatValue={v => formatHandicapIndex(Math.round(v * 10) / 10)}
                />
              </div>
            ) : summary?.handicapIndex === null ? (
              <div className="mb-4 bg-violet-50 border border-violet-200 rounded-lg p-4 text-sm text-violet-800">
                <i className="fas fa-info-circle mr-2"></i>
                Your estimated handicap appears after 3+ 18-hole rounds logged with a course
                rating and slope (find them on the course&apos;s scorecard).
              </div>
            ) : null}

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <TrendLineChart
                title="Score to par"
                points={toParPoints}
                color="#16a34a"
                formatValue={v => toParLabel(Math.round(v * 10) / 10)}
              />
              <TrendLineChart
                title="Putts per hole"
                points={puttsPoints}
                color="#16a34a"
              />
              <TrendLineChart
                title="Fairways in regulation"
                points={firPoints}
                color="#16a34a"
                unit="%"
                yDomain={[0, 100]}
              />
              <TrendLineChart
                title="Greens in regulation"
                points={girPoints}
                color="#16a34a"
                unit="%"
                yDomain={[0, 100]}
              />
            </div>

            <p className="text-xs text-gray-400 mt-4">
              9- and 18-hole rounds are compared by to-par and per-hole stats. Use the filters to
              isolate one format. Rounds without putts/FIR/GIR data are omitted from those charts. The handicap is a WHS-style estimate from your 18-hole rounds with rating &amp; slope — not an official index.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
