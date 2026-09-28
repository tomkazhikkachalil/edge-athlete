'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Layers } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import PublicStandingsTable from '@/components/standings/PublicStandingsTable';
import TeamScheduleList from './TeamScheduleList';
import { NextGameCard } from './GameDayCards';
import { nextGameOf } from '@/lib/teams/schedule';
import { ORG_ROUTE_FAMILY, type OrgKind } from '@/lib/orgs/org-ref';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import type { DivisionView } from '@/lib/teams/division-server';

// ── The in-app division page (teams & divisions program, PR 9) ──────────────
// /{club,league}/[id]/divisions/[divisionId]: the division's teams (each a
// door to its in-app team page), the standings of its competitions, and its
// schedule and results (home-first — no single side on a division). Reached
// from a team page's division line. The read is /api/{plural}/[id]/
// divisions/[divisionId]: a private org's division is for its members; a
// member also sees the org's private competitions' games. "Edit division"
// opens the console's Seasons section for anyone who runs it.

type View = DivisionView & { org: { id: string; name: string }; canManage: boolean };

export default function DivisionPage({ side }: { side: OrgKind }) {
  const params = useParams<{ id: string; divisionId: string }>();
  const orgId = params?.id ?? '';
  const divisionId = params?.divisionId ?? '';
  const [view, setView] = useState<View | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');

  useEffect(() => {
    if (!orgId || !divisionId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/${ORG_ROUTE_FAMILY[side]}/${orgId}/divisions/${divisionId}`, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setState('missing');
          return;
        }
        setView((await res.json()) as View);
        setState('ready');
      } catch {
        if (!cancelled) setState('missing');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [side, orgId, divisionId]);

  const orgHref = `/${side}/${orgId}`;

  if (state === 'loading') {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand" />
        </div>
      </div>
    );
  }

  if (state === 'missing' || !view) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="max-w-md mx-auto px-4 py-20 text-center">
          <div className="w-16 h-16 bg-surface-sunken rounded-full flex items-center justify-center mx-auto mb-4">
            <Layers className="w-8 h-8 text-faint" />
          </div>
          <h1 className="text-2xl font-bold text-primary mb-2">Division not found</h1>
          <p className="text-tertiary mb-6">This division does not exist or is not available to you.</p>
          <Link href={orgHref} className="inline-flex items-center px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand-hover transition-colors">
            Back to the {side}
          </Link>
        </div>
      </div>
    );
  }

  const { division, teams, standings, schedule, org, canManage } = view;
  const sport = SPORT_REGISTRY[division.sportKey as keyof typeof SPORT_REGISTRY]?.display_name ?? null;
  const card = 'bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6';
  const withRows = standings.filter(c => c.rows.length > 0 || c.golf);

  return (
    <div className="min-h-screen bg-canvas" data-division-page={division.id}>
      <AppHeader showSearch={false} />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <Link href={orgHref} className="inline-block text-sm font-medium text-brand-fg hover:text-brand-fg-strong">
          ← {org.name}
        </Link>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-primary break-words">{division.name}</h1>
            <p className="mt-1 text-sm text-tertiary">{[division.seasonLabel, sport, division.ageBand, division.genderStream, division.tier].filter(Boolean).join(' · ')}</p>
          </div>
          {canManage && (
            <Link href={`/app/org/${side}/${org.id}#seasons`} className="shrink-0 min-h-[44px] inline-flex items-center px-3 rounded-lg border border-border-strong text-sm font-medium text-secondary hover:bg-surface-sunken">
              Edit division
            </Link>
          )}
        </header>

        {/* G4: the division's next game leads the page. */}
        {nextGameOf(schedule) && (
          <section aria-label="Next game" data-division-next-game="">
            <NextGameCard game={nextGameOf(schedule)} />
          </section>
        )}

        <section aria-label="Teams" className={card}>
          <h2 className="text-lg font-semibold text-primary">Teams</h2>
          {teams.length === 0 ? (
            <p className="mt-1 text-sm text-tertiary">No teams entered yet.</p>
          ) : (
            <ul className="mt-3 grid gap-2 sm:grid-cols-2">
              {teams.map(t => (
                <li key={t.id}>
                  <Link href={`/${side}/${org.id}/teams/${t.id}`} className="ea-interactive flex min-h-[48px] items-center gap-3 rounded-lg border border-border p-2" data-division-team={t.id}>
                    {t.logoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element -- the tokenless team-logo streamer, busted by ?v (the org-logo precedent)
                      <img src={t.logoUrl} alt="" className="h-8 w-8 shrink-0 rounded-md border border-border object-contain bg-surface" />
                    ) : (
                      <span aria-hidden="true" className="h-8 w-8 shrink-0 rounded-md border border-border bg-surface-muted" style={t.primaryColor ? { background: t.secondaryColor ? `linear-gradient(135deg, ${t.primaryColor}, ${t.secondaryColor})` : t.primaryColor } : undefined} />
                    )}
                    <span className="min-w-0 truncate font-medium text-primary">{t.name}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Standings" className="space-y-4">
          {withRows.length === 0 ? (
            <div className={card}>
              <h2 className="text-lg font-semibold text-primary">Standings</h2>
              <p className="mt-1 text-sm text-tertiary">No published standings yet.</p>
            </div>
          ) : (
            withRows.map(comp => <PublicStandingsTable key={comp.id} competition={comp} />)
          )}
        </section>

        <section aria-label="Upcoming" className={card}>
          <h2 className="text-lg font-semibold text-primary">Upcoming</h2>
          <TeamScheduleList items={schedule.upcoming} empty="Nothing on the schedule yet." />
        </section>

        <section aria-label="Results" className={card}>
          <h2 className="text-lg font-semibold text-primary">Results</h2>
          <TeamScheduleList items={schedule.results} empty="No results yet." />
        </section>
      </div>
    </div>
  );
}
