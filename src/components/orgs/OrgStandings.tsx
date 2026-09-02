'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import GolfWeeks from '@/components/standings/GolfWeeks';
import PointsRaceTable from '@/components/standings/PointsRaceTable';
import type { PointsRace } from '@/lib/competitions/golf-race';
import type { PublicGolfBlock } from '@/lib/competitions/golf-weeks';

// The org page's standings section (phase 2 R3) — public competitions'
// materialized tables. The OrgUpcomingEvents contract: additive, renders
// nothing when the org has no public standings, a failed load renders
// nothing. The league side links to the SSR standings page (the spike's
// shareable, crawlable surface).

interface StandingRow {
  rank: number;
  entrant_name: string;
  played: number;
  points: number | null;
  stats: Record<string, number>;
}

interface CompetitionStandings {
  id: string;
  name: string;
  season_label: string | null;
  columns: { key: string; label: string; shortLabel: string }[];
  rows: StandingRow[];
  /** G1: 'athlete' boards head the entrant column "Player". */
  entrant_type?: string;
  /** W1: the golf week-to-week block (present only for windowed rounds). */
  golf?: PublicGolfBlock;
  race?: PointsRace;
}

interface OrgStandingsProps {
  side: 'league' | 'club';
  orgId: string;
}

export default function OrgStandings({ side, orgId }: OrgStandingsProps) {
  const [competitions, setCompetitions] = useState<CompetitionStandings[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const base = side === 'league' ? `/api/leagues/${orgId}/standings` : `/api/clubs/${orgId}/standings`;
        const response = await fetch(base);
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (!cancelled) {
          setCompetitions(
            // W1: a golf league with an open window has a week to show
            // before it has rows.
            (data.competitions ?? []).filter((c: CompetitionStandings) => c.rows.length > 0 || c.golf)
          );
        }
      } catch {
        /* additive section — a failed load renders nothing */
      }
    })();
    return () => { cancelled = true; };
  }, [side, orgId]);

  if (!competitions || competitions.length === 0) return null;

  return (
    <div className="mt-6 bg-surface rounded-xl shadow-sm border border-border p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-lg font-semibold text-primary">Standings</h2>
        {side === 'league' && (
          <Link
            href={`/league/${orgId}/standings`}
            className="text-sm text-brand-fg hover:text-brand-fg-strong"
          >
            Full standings →
          </Link>
        )}
      </div>
      <div className="space-y-5">
        {competitions.map(comp => (
          <div key={comp.id}>
            <p className="text-sm font-medium text-primary mb-2">
              {comp.name}
              {comp.season_label ? <span className="text-muted"> · {comp.season_label}</span> : null}
            </p>
            {comp.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-1 pr-2 font-medium">#</th>
                    <th className="py-1 pr-3 font-medium">
                      {comp.entrant_type === 'athlete' ? 'Player' : 'Team'}
                    </th>
                    {comp.columns.map(col => (
                      <th key={col.key} className="py-1 px-2 font-medium text-right" title={col.label}>
                        {col.shortLabel}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {comp.rows.map(row => (
                    <tr key={`${comp.id}-${row.rank}-${row.entrant_name}`} className="border-t border-border-subtle">
                      <td className="py-1 pr-2 text-muted">{row.rank}</td>
                      <td className="py-1 pr-3 font-medium text-primary">{row.entrant_name}</td>
                      {comp.columns.map(col => (
                        <td key={col.key} className="py-1 px-2 text-right text-secondary">
                          {col.key === 'played'
                            ? row.played
                            : col.key === 'points'
                              ? (row.points ?? '—')
                              : (row.stats[col.key] ?? '—')}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
            {comp.golf && <GolfWeeks golf={comp.golf} competitionId={comp.id} />}
            {comp.race && <PointsRaceTable race={comp.race} competitionId={comp.id} />}
          </div>
        ))}
      </div>
    </div>
  );
}
