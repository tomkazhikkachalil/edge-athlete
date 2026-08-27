'use client';

/**
 * Golf's full professional breakdown, embedded in the Stats hub — the same
 * numbers and charts as /app/sport/golf/trends (same endpoint, same
 * formatting), viewable by ANYONE the profile is visible to. Until this
 * existed the trends experience was owner-only; the endpoint has carried a
 * visibility gate since the maps era and gained anonymous-public support in
 * the Stats Hub round.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import TrendLineChart from '../charts/TrendLineChart';
import { toParLabel, toParColorClass } from '@/lib/golf/scoring';
import { formatHandicapIndex } from '@/lib/golf/handicap';
import { useTheme } from '@/lib/use-theme';

interface TrendPoint {
  round_id: string;
  date: string;
  course: string;
  holes: number;
  to_par: number;
  putts_per_hole: number | null;
  gir_pct: number | null;
}

interface TrendsSummary {
  rounds: number;
  avgToParLast5: number | null;
  bestToPar: number | null;
  avgPuttsPerHole: number | null;
  avgGirPct: number | null;
  handicapIndex: number | null;
  handicapRounds: number;
}

interface TrendsResponse {
  series: TrendPoint[];
  summary: TrendsSummary;
  handicapSeries: Array<{ date: string; index: number }>;
  isOwner: boolean;
}

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export default function GolfBreakdown({ profileId }: { profileId: string }) {
  const [data, setData] = useState<TrendsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const requestSeqRef = useRef(0);
  const { theme } = useTheme();

  useEffect(() => {
    const seq = ++requestSeqRef.current;
    fetch(`/api/golf/trends?profileId=${profileId}`)
      .then(res => (res.ok ? res.json() : null))
      .then(body => {
        if (seq !== requestSeqRef.current) return;
        setData(body);
        setLoading(false);
      })
      .catch(() => {
        if (seq !== requestSeqRef.current) return;
        setLoading(false);
      });
  }, [profileId]);

  if (loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand"></div>
      </div>
    );
  }
  if (!data || data.series.length === 0) {
    return <p className="text-sm text-muted py-2">No rounds logged yet.</p>;
  }

  const { summary, handicapSeries, series, isOwner } = data;
  const toParPoints = series.map(p => ({
    label: shortDate(p.date),
    value: p.to_par,
    meta: `${p.course} (${p.holes})`,
  }));

  return (
    <div>
      {/* Summary tiles — same five as the trends page, same formatting. */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
        <div className="bg-surface-sunken rounded-lg border border-border p-3 text-center">
          <div className="text-xl font-bold text-green-700 dark:text-green-300">
            {summary.handicapIndex !== null ? formatHandicapIndex(summary.handicapIndex) : '—'}
          </div>
          <div className="text-xs text-muted uppercase mt-1">
            Handicap est.{summary.handicapIndex !== null ? ` · ${summary.handicapRounds} rds` : ''}
          </div>
        </div>
        <div className="bg-surface-sunken rounded-lg border border-border p-3 text-center">
          <div className={`text-xl font-bold ${toParColorClass(summary.avgToParLast5)}`}>
            {summary.avgToParLast5 !== null
              ? (summary.avgToParLast5 > 0 ? `+${summary.avgToParLast5}` : summary.avgToParLast5)
              : '—'}
          </div>
          <div className="text-xs text-muted uppercase mt-1">Avg to par · last 5</div>
        </div>
        <div className="bg-surface-sunken rounded-lg border border-border p-3 text-center">
          <div className={`text-xl font-bold ${toParColorClass(summary.bestToPar)}`}>
            {summary.bestToPar !== null ? toParLabel(summary.bestToPar) : '—'}
          </div>
          <div className="text-xs text-muted uppercase mt-1">Best round</div>
        </div>
        <div className="bg-surface-sunken rounded-lg border border-border p-3 text-center">
          <div className="text-xl font-bold text-primary">{summary.avgPuttsPerHole ?? '—'}</div>
          <div className="text-xs text-muted uppercase mt-1">Putts per hole</div>
        </div>
        <div className="bg-surface-sunken rounded-lg border border-border p-3 text-center">
          <div className="text-xl font-bold text-primary">
            {summary.avgGirPct !== null ? `${summary.avgGirPct}%` : '—'}
          </div>
          <div className="text-xs text-muted uppercase mt-1">Avg GIR</div>
        </div>
      </div>

      {/* Handicap trend, then scoring trend — the two charts that tell the
          story; the full four-chart spread stays on the trends page. */}
      {handicapSeries.length >= 2 && (
        <div className="mb-4">
          <TrendLineChart
            title="Handicap index (estimated)"
            points={handicapSeries.map(p => ({ label: shortDate(p.date), value: p.index }))}
            color={theme === 'dark' ? '#4ade80' : '#16a34a'}
            rollingWindow={0}
            formatValue={v => formatHandicapIndex(Math.round(v * 10) / 10)}
          />
        </div>
      )}
      {toParPoints.length >= 2 && (
        <TrendLineChart
          title="Score to par"
          points={toParPoints}
          color={theme === 'dark' ? '#a78bfa' : '#7c3aed'}
          pointNoun="round"
        />
      )}

      {isOwner && (
        <Link
          href="/app/sport/golf/trends"
          className="mt-4 inline-flex min-h-[44px] items-center text-sm font-medium text-brand-fg hover:text-brand-fg-strong"
        >
          Open full trends →
        </Link>
      )}
    </div>
  );
}
