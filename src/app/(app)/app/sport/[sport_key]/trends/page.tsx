'use client';

/**
 * /app/sport/[sport_key]/trends — the trends page for a stat-line sport
 * (Round 4, Sep 2026: the golfer's Trends door for everyone else). The hero
 * number over every event (the rollups reader with `?trend=` the whole
 * series), the seasons side by side with the schema's tiles, and the
 * career bests. Golf owns its own trends page and is sent there.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import TrendLineChart from '@/components/charts/TrendLineChart';
import { getStatSchema } from '@/lib/sports/stat-schemas';
import { getSportDefinition, getSportAdapter, type SportKey } from '@/lib/sports';
import { pluralNoun } from '@/lib/sports/adapters/StatLinePostAdapter';
import type { Rollups } from '@/lib/performance/rollups';
import { headlineDirection } from '@/lib/performance/types';

const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const longDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export default function SportTrendsPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const sportKey = String(params.sport_key ?? '') as SportKey;
  const schema = getStatSchema(sportKey);
  const [rollups, setRollups] = useState<Rollups | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) router.push('/');
  }, [user, authLoading, router]);

  useEffect(() => {
    if (!schema) {
      try {
        const own = getSportAdapter(sportKey).getNavLinks().find(l => l.href.includes('/trends'))?.href;
        router.replace(own && !own.includes(`/${sportKey}/trends`) ? own : '/feed');
      } catch {
        router.replace('/feed');
      }
    }
  }, [schema, sportKey, router]);

  useEffect(() => {
    if (!user?.id || !schema) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/performance/rollups?profileId=${encodeURIComponent(user.id)}&sport=${encodeURIComponent(sportKey)}&trend=2000`);
        const body = res.ok ? ((await res.json()) as { rollups: Rollups | null }) : null;
        if (!cancelled) setRollups(body?.rollups ?? null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, sportKey, schema]);

  if (authLoading || !user || !schema) {
    return <div className="min-h-screen bg-canvas flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" /></div>;
  }
  const sport = getSportDefinition(sportKey);
  const noun = schema.activityNoun.toLowerCase();
  const lower = headlineDirection(sportKey) === 'lower';
  const points = (rollups?.trend ?? []).map(p => ({ label: shortDate(p.date), value: p.value, meta: longDate(p.date) }));

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-primary">
              <i className="fas fa-chart-line mr-2 text-brand-fg" aria-hidden="true"></i>
              {sport.display_name} Trends
            </h1>
            {rollups && !loading && (
              <p className="text-sm text-muted mt-1">
                {rollups.events} {rollups.events === 1 ? noun : pluralNoun(noun)}
                {rollups.career.from && rollups.career.to ? ` · ${longDate(rollups.career.from)} – ${longDate(rollups.career.to)}` : ''}
              </p>
            )}
          </div>
          <Link href={`/app/sport/${sportKey}/log`} className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium min-h-[44px] flex items-center">View {pluralNoun(noun)} list →</Link>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand" /></div>
        ) : !rollups || rollups.events === 0 ? (
          <div className="bg-surface rounded-lg border border-border p-8 text-center">
            <p className="text-secondary mb-3">No {pluralNoun(noun)} logged yet — trends need a few.</p>
            <Link href="/feed" className="text-sm text-brand-fg font-medium">Log a {noun} from the feed →</Link>
          </div>
        ) : (
          <div className="space-y-6" data-sport-trends="">
            <div className="bg-surface rounded-lg shadow-sm border border-border p-4">
              <TrendLineChart
                title={`${schema.heroStat.label} per ${noun}`}
                points={points}
                color="#7c3aed"
                pointNoun={noun}
                rollingWindow={5}
                emptyMessage={`Log a few more ${pluralNoun(noun)} to see a trend.`}
              />
            </div>

            <section aria-labelledby="seasons-heading">
              <h2 id="seasons-heading" className="text-base font-semibold text-primary mb-3">Seasons</h2>
              <div className="bg-surface rounded-lg shadow-sm border border-border overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-xs uppercase text-tertiary border-b border-border">
                    <tr>
                      <th className="text-left px-4 py-2">Season</th>
                      {schema.profileTiles.map(t => <th key={t.label} className="text-right px-4 py-2">{t.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {rollups.seasons.map(s => (
                      <tr key={s.key} className="border-b border-border last:border-0">
                        <td className="px-4 py-3 text-primary font-medium whitespace-nowrap">{s.label}</td>
                        {s.tiles.map(t => <td key={t.label} className="px-4 py-3 text-right text-primary tabular-nums">{t.value ?? '—'}</td>)}
                      </tr>
                    ))}
                    <tr className="bg-surface-sunken">
                      <td className="px-4 py-3 text-primary font-semibold">Career</td>
                      {rollups.career.tiles.map(t => <td key={t.label} className="px-4 py-3 text-right text-primary font-semibold tabular-nums">{t.value ?? '—'}</td>)}
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>

            {rollups.career.bests.length > 0 && (
              <section aria-labelledby="bests-heading">
                <h2 id="bests-heading" className="text-base font-semibold text-primary mb-3">Career bests{lower ? ' (fastest)' : ''}</h2>
                <ul className="bg-surface rounded-lg shadow-sm border border-border divide-y divide-border">
                  {rollups.career.bests.map(b => (
                    <li key={b.key} className="px-4 py-3 text-sm flex justify-between gap-3">
                      <span className="text-secondary">{b.label}</span>
                      <span className="text-primary tabular-nums">{b.value} <span className="text-xs text-tertiary">{longDate(b.date)}</span></span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
