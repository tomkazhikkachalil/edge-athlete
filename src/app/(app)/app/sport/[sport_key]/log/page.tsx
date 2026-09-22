'use client';

/**
 * /app/sport/[sport_key]/log — the game log for a stat-line sport (Round 4,
 * Sep 2026: the golfer's "View all rounds" door for everyone else). Every
 * self-posted line, newest first, a year select from the endpoint's real
 * years, the official (org-entered) lines apart; each row opens the
 * activity page. Golf owns its own routes and is sent there.
 */

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import { getStatSchema } from '@/lib/sports/stat-schemas';
import { getSportDefinition, getSportAdapter, type SportKey } from '@/lib/sports';
import { pluralNoun } from '@/lib/sports/adapters/StatLinePostAdapter';
import { UNCONFIRMED_LABEL, UNCONFIRMED_TITLE } from '@/lib/sports/provenance-copy';

interface LogResponse {
  entryCount: number;
  years: number[];
  recentActivity: Array<{ id: string; date: string | null; opponent: string | null; result: string | null; keyStat: string | null }>;
  official?: Array<{ contestId: string; date: string | null; competitionName: string; teamName: string | null; opponent: string | null; keyStat: string | null; provenance: string; href: string; disputed?: boolean }>;
}

const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export default function SportLogPage() {
  const params = useParams();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const sportKey = String(params.sport_key ?? '') as SportKey;
  const schema = getStatSchema(sportKey);
  const [data, setData] = useState<LogResponse | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) router.push('/');
  }, [user, authLoading, router]);

  // A sport with its own list route (golf) goes there; an unknown sport goes home.
  useEffect(() => {
    if (!schema) {
      try {
        const own = getSportAdapter(sportKey).getNavLinks()[0]?.href;
        router.replace(own && !own.includes('/log') ? own : '/feed');
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
        const q = new URLSearchParams({ profileId: user.id, sport: sportKey });
        if (year !== null) q.set('year', String(year));
        const res = await fetch(`/api/sports/stat-lines?${q}`);
        if (!cancelled) setData(res.ok ? await res.json() : null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id, sportKey, schema, year]);

  if (authLoading || !user || !schema) {
    return <div className="min-h-screen bg-canvas flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" /></div>;
  }
  const sport = getSportDefinition(sportKey);
  const noun = schema.activityNoun;
  const rows = data?.recentActivity ?? [];
  const official = data?.official ?? [];

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />
      <div className="max-w-4xl mx-auto px-4 py-6">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-6">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-primary">{sport.display_name} {pluralNoun(noun)}</h1>
            {data && !loading && <p className="text-sm text-muted mt-1">{data.entryCount} {data.entryCount === 1 ? noun.toLowerCase() : pluralNoun(noun.toLowerCase())} logged{year !== null ? ` in ${year}` : ''}</p>}
          </div>
          <Link href={`/app/sport/${sportKey}/trends`} className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium min-h-[44px] flex items-center">Trends →</Link>
        </div>

        {data && data.years.length > 1 && (
          <div className="mb-4">
            <select value={year ?? ''} onChange={e => setYear(e.target.value === '' ? null : Number(e.target.value))} aria-label="Year" className="px-3 py-2 min-h-[44px] border border-border-strong rounded-lg text-sm bg-surface text-primary">
              <option value="">All years</option>
              {data.years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-8"><div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand" /></div>
        ) : rows.length === 0 && official.length === 0 ? (
          <div className="bg-surface rounded-lg border border-border p-8 text-center">
            <p className="text-secondary mb-3">No {pluralNoun(noun.toLowerCase())} logged yet{year !== null ? ` in ${year}` : ''}.</p>
            <Link href="/feed" className="text-sm text-brand-fg font-medium">Log a {noun.toLowerCase()} from the feed →</Link>
          </div>
        ) : (
          <>
            {rows.length > 0 && (
              <div className="bg-surface rounded-lg shadow-sm border border-border overflow-x-auto mb-6" data-sport-log="">
                <table className="min-w-full text-sm">
                  <thead className="text-xs uppercase text-tertiary border-b border-border">
                    <tr><th className="text-left px-4 py-2">Date</th><th className="text-left px-4 py-2">{schema.opponentLabel}</th><th className="text-left px-4 py-2">Result</th><th className="text-left px-4 py-2">Line</th></tr>
                  </thead>
                  <tbody>
                    {rows.map(r => (
                      <tr key={r.id} className="border-b border-border last:border-0 ea-interactive">
                        <td className="px-4 py-3 whitespace-nowrap"><Link href={`/app/sport/${sportKey}/activity/${r.id}`} className="text-primary font-medium">{r.date ? shortDate(r.date) : '—'}</Link></td>
                        <td className="px-4 py-3 text-secondary">{r.opponent ?? '—'}</td>
                        <td className="px-4 py-3 text-secondary whitespace-nowrap">{r.result ?? '—'}</td>
                        <td className="px-4 py-3 text-primary whitespace-nowrap">{r.keyStat ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {official.length > 0 && (
              <section aria-labelledby="official-heading">
                <h2 id="official-heading" className="text-base font-semibold text-primary mb-2">Official lines</h2>
                <p className="text-xs text-tertiary mb-3">Entered by a club or league from a public competition — kept apart from your own log.</p>
                <ul className="bg-surface rounded-lg shadow-sm border border-border divide-y divide-border">
                  {official.map(o => (
                    <li key={o.contestId} className="px-4 py-3 text-sm flex flex-wrap justify-between gap-2">
                      <span><Link href={o.href} className="text-primary font-medium">{o.date ? shortDate(o.date) : '—'}</Link> <span className="text-secondary">· {o.competitionName}{o.opponent ? ` vs ${o.opponent}` : ''}</span></span>
                      <span className="text-primary">{o.disputed ? <span title={UNCONFIRMED_TITLE} className="text-tertiary">{UNCONFIRMED_LABEL}</span> : o.keyStat ?? '—'}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </div>
    </div>
  );
}
