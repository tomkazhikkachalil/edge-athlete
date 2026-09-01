'use client';

/**
 * Full professional breakdown for a stat-line sport (hockey, basketball,
 * soccer, baseball, volleyball — and track's race log rides the same
 * endpoint). Season totals for EVERY schema field plus the game log —
 * `/api/sports/stat-lines` has computed both since the multi-sport round;
 * this is the first UI to render them. Year select via the endpoint's
 * `years` list.
 */

import { useEffect, useRef, useState } from 'react';
import { getStatSchema } from '@/lib/sports/stat-schemas';
import type { SportKey } from '@/lib/sports/SportRegistry';

interface StatLinesResponse {
  sport: string;
  entryCount: number;
  totals: Record<string, number>;
  recentActivity: Array<{
    id: string;
    date: string | null;
    opponent: string | null;
    result: string | null;
    keyStat: string | null;
  }>;
  years: number[];
  /** Phase 4: org-entered lines from public competitions — labeled apart
   *  from the self-posted log, never merged (no cross-source dedup). */
  official?: Array<{
    contestId: string;
    date: string | null;
    competitionName: string;
    teamName: string | null;
    opponent: string | null;
    keyStat: string | null;
    provenance: string;
    href: string;
  }>;
}

const OFFICIAL_PROVENANCE_LABELS: Record<string, string> = {
  sanctioned: 'Sanctioned',
  league_verified: 'League verified',
  club_recorded: 'Club recorded',
  imported: 'Imported',
  entered: 'Self reported',
};

const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

export default function StatLineBreakdown({
  profileId,
  sportKey,
}: {
  profileId: string;
  sportKey: SportKey;
}) {
  const [data, setData] = useState<StatLinesResponse | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const requestSeqRef = useRef(0);
  const schema = getStatSchema(sportKey);

  useEffect(() => {
    const run = async () => {
      const seq = ++requestSeqRef.current;
      setLoading(true);
      try {
        const params = new URLSearchParams({ profileId, sport: sportKey });
        if (year !== null) params.set('year', String(year));
        const res = await fetch(`/api/sports/stat-lines?${params}`);
        const body = res.ok ? await res.json() : null;
        if (seq !== requestSeqRef.current) return;
        setData(body);
      } catch {
        if (seq !== requestSeqRef.current) return;
      } finally {
        if (seq === requestSeqRef.current) setLoading(false);
      }
    };
    run();
  }, [profileId, sportKey, year]);

  if (!schema) return null;
  if (loading) {
    return (
      <div className="flex justify-center items-center py-8">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-brand"></div>
      </div>
    );
  }
  const official = data?.official ?? [];
  if (!data || (data.entryCount === 0 && official.length === 0)) {
    return (
      <p className="text-sm text-muted py-2">
        No {schema.activityNoun.toLowerCase()}s logged{year !== null ? ` in ${year}` : ''} yet.
      </p>
    );
  }

  const isTrack = sportKey === 'track_field';
  // For times, a summed total is meaningless — the PB table above carries
  // the bests, so track's season table shows entry counts per event instead.
  const totalRows = schema.fields
    .map(f => ({ field: f, total: data.totals[f.key] ?? 0 }))
    .filter(r => r.total > 0);

  return (
    <div>
      {/* Year select — the endpoint's real years, not a catalog. */}
      {data.years.length > 1 && (
        <div className="mb-4">
          <select
            value={year ?? ''}
            onChange={e => setYear(e.target.value === '' ? null : Number(e.target.value))}
            aria-label="Season"
            className="px-3 py-2 border border-border-strong rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
          >
            <option value="">All seasons</option>
            {data.years.map(y => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Season totals — every schema field the athlete has recorded. */}
      {!isTrack && totalRows.length > 0 && (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-border-subtle">
                <th className="py-2 pr-4 font-semibold">Season totals</th>
                <th className="py-2 text-right font-semibold">
                  {data.entryCount} {schema.activityNoun.toLowerCase()}
                  {data.entryCount !== 1 ? 's' : ''}
                </th>
              </tr>
            </thead>
            <tbody>
              {totalRows.map(({ field, total }) => (
                <tr key={field.key} className="border-b border-border-subtle/60 last:border-0">
                  <td className="py-2 pr-4 text-secondary">{field.label}</td>
                  <td className="py-2 text-right font-bold text-primary tabular-nums">{total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Official log (phase 4) — org-entered lines, each row naming its
          competition and carrying the ACTUAL provenance rung, linking to
          the owner's public standings (the contest backlink). */}
      {official.length > 0 && (
        <div className="mb-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-border-subtle">
                <th className="py-2 pr-4 font-semibold">Official</th>
                <th className="py-2 pr-4 font-semibold">Competition</th>
                <th className="py-2 pr-4 font-semibold">{schema.opponentLabel}</th>
                <th className="py-2 text-right font-semibold">Key stat</th>
              </tr>
            </thead>
            <tbody>
              {official.map(row => (
                <tr key={row.contestId} className="border-b border-border-subtle/60 last:border-0">
                  <td className="py-2 pr-4 text-secondary whitespace-nowrap">
                    {row.date ? shortDate(row.date) : '—'}
                    <span className="block text-[11px] text-brand-fg">
                      <i className="fas fa-shield-halved mr-1" aria-hidden="true"></i>
                      {OFFICIAL_PROVENANCE_LABELS[row.provenance] ?? row.provenance}
                    </span>
                  </td>
                  <td className="py-2 pr-4 text-secondary">
                    <a href={row.href} className="hover:text-brand-fg">
                      {row.competitionName}
                    </a>
                  </td>
                  <td className="py-2 pr-4 text-secondary">{row.opponent ?? '—'}</td>
                  <td className="py-2 text-right font-semibold text-primary tabular-nums">
                    {row.keyStat ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Game / race log. */}
      {data.recentActivity.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted border-b border-border-subtle">
                <th className="py-2 pr-4 font-semibold">Date</th>
                <th className="py-2 pr-4 font-semibold">{schema.opponentLabel}</th>
                <th className="py-2 pr-4 font-semibold">Result</th>
                <th className="py-2 text-right font-semibold">Key stat</th>
              </tr>
            </thead>
            <tbody>
              {data.recentActivity.map(row => (
                <tr key={row.id} className="border-b border-border-subtle/60 last:border-0">
                  <td className="py-2 pr-4 text-secondary whitespace-nowrap">
                    {row.date ? shortDate(row.date) : '—'}
                  </td>
                  <td className="py-2 pr-4 text-secondary">{row.opponent ?? '—'}</td>
                  <td className="py-2 pr-4 text-secondary">{row.result ?? '—'}</td>
                  <td className="py-2 text-right font-semibold text-primary tabular-nums">
                    {row.keyStat ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
