'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { formatDateRange, formatIsoDate } from '@/lib/competitions/golf-weeks';
import type { MyGolfEntry } from '@/lib/competitions/golf-league-mine';

// "Your week" (phase 6d W2): the signed-in member's own standing in this
// org's golf leagues — the round the league leads with and whether their
// posted round counted (gross/net, posted or final), or the door to post
// one. The OrgStandings contract: additive, renders nothing for a visitor,
// a non-member, or a failed load. Checks initialAuthCheckComplete BEFORE
// user (the reverse flashes at signed-in users on refresh). The door is a
// plain link to the member's rounds page — the golf write path is frozen
// and untouched.

interface GolfYourWeekProps {
  side: 'league' | 'club';
  orgId: string;
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export default function GolfYourWeek({ side, orgId }: GolfYourWeekProps) {
  const { user, initialAuthCheckComplete } = useAuth();
  const [entries, setEntries] = useState<MyGolfEntry[] | null>(null);

  useEffect(() => {
    if (!initialAuthCheckComplete || !user) return;
    let cancelled = false;
    (async () => {
      try {
        const base = side === 'league' ? `/api/leagues/${orgId}/golf/mine` : `/api/clubs/${orgId}/golf/mine`;
        const response = await fetch(base);
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (!cancelled) setEntries(data.entries ?? []);
      } catch {
        /* additive section — a failed load renders nothing */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [side, orgId, user, initialAuthCheckComplete]);

  if (!entries || entries.length === 0) return null;

  return (
    <div className="mt-6 bg-surface rounded-xl shadow-sm border border-border p-4 sm:p-6" aria-label="Your week">
      <h2 className="text-lg font-semibold text-primary mb-3">Your week</h2>
      <ul className="space-y-3">
        {entries.map(entry => {
          const week = entry.week;
          const result = entry.result;
          return (
            <li key={entry.competitionId} className="text-sm">
              <p className="font-medium text-primary">
                {entry.competitionName}
                {week ? (
                  <span className="font-normal text-muted">
                    {' '}· {week.round ?? 'Round'} · {formatDateRange(week.playFrom, week.playTo)}
                    {week.courseName ? ` · ${week.courseName}` : ''} · {week.holes} holes
                  </span>
                ) : null}
              </p>
              {/* P5: the season standing — where the member sits in the table. */}
              {entry.standing && (
                <p className="text-xs text-secondary" data-standing={entry.standing.rank}>
                  {`Season: ${ordinal(entry.standing.rank)} of ${entry.standing.of}`}
                  {entry.standing.points !== null ? ` · ${entry.standing.points} pts` : ''}
                </p>
              )}
              {!week ? (
                <p className="text-secondary">No rounds scheduled yet.</p>
              ) : result ? (
                <p className="text-secondary">
                  {result.gross !== null ? `Gross ${result.gross}` : null}
                  {result.gross !== null && result.net !== null ? ' · ' : null}
                  {result.net !== null ? `net ${result.net}` : null}
                  {' · '}
                  <span className={result.provenance === 'self_reported' ? 'text-amber-700' : 'text-emerald-700'}>
                    {result.provenance === 'self_reported' ? 'posted' : 'final'}
                  </span>
                </p>
              ) : week.state === 'open' ? (
                <p className="text-secondary">
                  Not posted yet — closes {formatIsoDate(week.playTo)}.{' '}
                  <Link href="/app/sport/golf/rounds" className="text-brand-fg hover:text-brand-fg-strong font-medium">
                    Post a round →
                  </Link>
                </p>
              ) : week.state === 'upcoming' ? (
                <p className="text-secondary">Opens {formatIsoDate(week.playFrom)}.</p>
              ) : (
                <p className="text-secondary">Closed {formatIsoDate(week.playTo)} — nothing posted.</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
