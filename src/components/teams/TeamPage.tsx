'use client';

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { Shield } from 'lucide-react';
import AppHeader from '@/components/AppHeader';
import TeamScheduleList from './TeamScheduleList';
import { NextGameCard } from './GameDayCards';
import { useTheme } from '@/lib/use-theme';
import { ORG_ROUTE_FAMILY, type OrgKind } from '@/lib/orgs/org-ref';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { nextGameOf, type TeamScheduleItem } from '@/lib/teams/schedule';
import type { TeamLook } from '@/lib/teams/brand';

// ── The in-app team page (teams & divisions program, PR 8) ──────────────────
// /{club,league}/[id]/teams/[teamId]: the team's roster, its schedule, its
// results (from the team's side — "W 3–2") and its standings, in four tabs
// (`?tab=roster|schedule|results|standings`, a deep link on every width).
// It wears the TEAM's colours (teamLook: the team's, else the club's) inside
// the org page's own scope. "Manage team" opens the console's Teams section
// for anyone who runs this team (manage_teams at its scope). The read is
// /api/{plural}/[id]/teams/[teamId] — the org's rules decide (a private
// org's team is for members; a switched-off Teams part is not found).
//
// 375px: the tabs scroll sideways inside their own strip, never the page.

const TABS = ['roster', 'schedule', 'results', 'standings'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABEL: Record<Tab, string> = { roster: 'Roster', schedule: 'Schedule', results: 'Results', standings: 'Standings' };

interface TeamView {
  team: { id: string; name: string; sportKey: string | null; divisionLabels: string[]; divisions?: { id: string; label: string }[] };
  org: { id: string; name: string };
  look: TeamLook;
  roster: { name: string; supervised: boolean }[];
  schedule: { upcoming: TeamScheduleItem[]; results: TeamScheduleItem[] };
  records: { competitionName: string; seasonLabel: string | null; rank: number; played: number; points: number | null }[];
  canManage: boolean;
  isMember: boolean;
}

export default function TeamPage({ side }: { side: OrgKind }) {
  const params = useParams<{ id: string; teamId: string }>();
  const orgId = params?.id ?? '';
  const teamId = params?.teamId ?? '';
  const { theme } = useTheme();
  const [view, setView] = useState<TeamView | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading');
  const [tab, setTab] = useState<Tab>('schedule');

  // Deep link (?tab=…) read once on mount — window.location, not
  // useSearchParams (which would force a Suspense boundary on the route).
  useEffect(() => {
    try {
      const t = new URLSearchParams(window.location.search).get('tab');
      // eslint-disable-next-line react-hooks/set-state-in-effect -- the URL is an external input read once after mount (SSR has no window; a lazy initializer would hydrate-mismatch)
      if ((TABS as readonly string[]).includes(t ?? '')) setTab(t as Tab);
    } catch {
      /* no deep link */
    }
  }, []);

  useEffect(() => {
    if (!orgId || !teamId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/${ORG_ROUTE_FAMILY[side]}/${orgId}/teams/${teamId}`, { cache: 'no-store' });
        if (cancelled) return;
        if (!res.ok) {
          setState('missing');
          return;
        }
        setView((await res.json()) as TeamView);
        setState('ready');
      } catch {
        if (!cancelled) setState('missing');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [side, orgId, teamId]);

  const choose = useCallback((next: Tab) => {
    setTab(next);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('tab', next);
      window.history.replaceState(null, '', url.toString());
    } catch {
      /* the tab still switches */
    }
  }, []);

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
            <Shield className="w-8 h-8 text-faint" />
          </div>
          <h1 className="text-2xl font-bold text-primary mb-2">Team not found</h1>
          <p className="text-tertiary mb-6">This team does not exist or is not available to you.</p>
          <Link href={orgHref} className="inline-flex items-center px-4 py-2 bg-brand text-white rounded-lg hover:bg-brand-hover transition-colors">
            Back to the {side}
          </Link>
        </div>
      </div>
    );
  }

  const { team, org, look, roster, schedule, records, canManage } = view;
  const accentVars = look.accent
    ? ({ '--org-accent': look.accent.fill, '--org-accent-strong': look.accent.fillStrong, '--org-accent-fg': theme === 'dark' ? look.accent.fgDark : look.accent.fgLight } as CSSProperties)
    : undefined;
  const sportLabel = team.sportKey ? (SPORT_REGISTRY[team.sportKey as keyof typeof SPORT_REGISTRY]?.display_name ?? null) : null;
  const card = 'bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6';

  return (
    <div className="min-h-screen bg-canvas org-app-scope" style={accentVars} data-team-page={team.id} data-team-colours={look.source ?? 'app'}>
      <AppHeader showSearch={false} />
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <Link href={orgHref} className="inline-block text-sm font-medium text-brand-fg hover:text-brand-fg-strong">
          ← {org.name}
        </Link>

        <header className="flex items-center gap-4">
          {look.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- the tokenless logo streamers, busted by ?v (the org-logo precedent)
            <img src={look.logoUrl} alt={`${team.name} logo`} className="h-16 w-16 shrink-0 rounded-lg border border-border bg-surface object-contain" />
          ) : (
            <span aria-hidden="true" className="h-16 w-16 shrink-0 rounded-lg" style={{ background: 'linear-gradient(135deg, var(--org-accent, #8b5cf6), var(--org-accent-strong, #7c3aed))' }} />
          )}
          <div className="min-w-0 grow">
            <h1 className="text-2xl font-bold text-primary break-words">{team.name}</h1>
            {(sportLabel || team.divisionLabels.length > 0) && (
              <p className="mt-1 text-sm text-tertiary">
                {sportLabel}
                {/* PR 9: each division is a door to its page. */}
                {(team.divisions ?? []).map((d, i) => (
                  <span key={d.id}>
                    {sportLabel || i > 0 ? ' · ' : ''}
                    <Link href={`/${side}/${org.id}/divisions/${d.id}`} className="hover:underline" data-team-division={d.id}>
                      {d.label}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </div>
          {canManage && (
            <Link href={`/app/org/${side}/${org.id}#teams`} className="shrink-0 min-h-[44px] inline-flex items-center px-3 rounded-lg border border-border-strong text-sm font-medium text-secondary hover:bg-surface-sunken">
              Manage team
            </Link>
          )}
        </header>

        {/* G4: the next game leads, whatever the tab (its scoreboard while live). */}
        {nextGameOf(schedule) && (
          <section aria-label="Next game" data-team-next-game="">
            <NextGameCard game={nextGameOf(schedule)} />
          </section>
        )}

        <div role="tablist" aria-label="Team" className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
          {TABS.map(t => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => choose(t)}
              className={`shrink-0 min-h-[44px] px-4 rounded-full text-sm font-medium border transition-colors ${tab === t ? 'bg-brand text-white border-transparent' : 'border-border-strong text-secondary hover:bg-surface-sunken'}`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>

        <section role="tabpanel" aria-label={TAB_LABEL[tab]} className={card} data-team-tab={tab}>
          {tab === 'roster' &&
            (roster.length === 0 ? (
              <p className="text-sm text-tertiary">No one on this team yet.</p>
            ) : (
              <ul className="columns-2 sm:columns-3 gap-6">
                {roster.map((p, i) => (
                  <li key={`${p.name}-${i}`} className="py-1 text-sm text-primary break-inside-avoid">
                    {p.name}
                    {p.supervised && <span className="ml-2 rounded-full bg-surface-muted px-2 py-0.5 text-xs text-secondary">Minor</span>}
                  </li>
                ))}
              </ul>
            ))}
          {tab === 'schedule' && <TeamScheduleList items={schedule.upcoming} empty="Nothing on the schedule yet." />}
          {tab === 'results' && <TeamScheduleList items={schedule.results} empty="No results yet." />}
          {tab === 'standings' &&
            (records.length === 0 ? (
              <p className="text-sm text-tertiary">Not in a standings table yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted">
                      <th scope="col" className="py-1.5 pr-3 font-medium">Competition</th>
                      <th scope="col" className="py-1.5 px-2 font-medium text-right">Rank</th>
                      <th scope="col" className="py-1.5 px-2 font-medium text-right">Played</th>
                      <th scope="col" aria-label="Points" className="py-1.5 px-2 font-medium text-right">Pts</th>
                    </tr>
                  </thead>
                  <tbody>
                    {records.map((r, i) => (
                      <tr key={`${r.competitionName}-${i}`} className="border-t border-border-subtle">
                        <td className="py-1.5 pr-3 font-medium text-primary">
                          {r.competitionName}
                          {r.seasonLabel && <span className="font-normal text-muted">{` · ${r.seasonLabel}`}</span>}
                        </td>
                        <td className="py-1.5 px-2 text-right text-secondary">{r.rank}</td>
                        <td className="py-1.5 px-2 text-right text-secondary">{r.played}</td>
                        <td className="py-1.5 px-2 text-right text-secondary">{r.points ?? 0}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
        </section>
      </div>
    </div>
  );
}
