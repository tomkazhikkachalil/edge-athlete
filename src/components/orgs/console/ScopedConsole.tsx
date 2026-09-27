'use client';

import { useState } from 'react';
import Link from 'next/link';
import TeamRosterPanel from './TeamRosterPanel';
import TeamIdentityForm, { type TeamIdentity } from './TeamIdentityForm';
import DivisionEditForm, { type DivisionEditable } from './DivisionEditForm';
import ScopedEventForm from './ScopedEventForm';
import { SECTION_LABELS } from '@/lib/orgs/staff-validate';
import type { OrgKind } from '@/lib/orgs/org-ref';

// ── The coach's console (teams & divisions program, PR 10) ──────────────────
// Someone whose every staff grant is on a TEAM or a DIVISION lands here
// instead of the org-wide sections (authz consoleLanding 'scoped'). One card
// per team they run (a team grant, or a team entered in a division they run):
// its roster (add / move / remove), its identity, an event on its calendar,
// its page. One card per division: its edit, an event on its calendar, its
// page. A control shows only when the grant carries the section the server
// checks (Teams → roster + identity; Seasons → the division; Competitions,
// or the grant that runs the scope → scheduling) — the server decides again.

export interface ScopedGrantView {
  scopeType: 'team' | 'division';
  scopeId: string;
  sections: string[];
}

interface Props {
  side: OrgKind;
  orgId: string;
  orgName: string | null;
  grants: ScopedGrantView[];
  teams: (TeamIdentity & { status: 'active' | 'archived' })[];
  divisions: (DivisionEditable & { season_label: string | null; team_ids: string[] })[];
  onChanged: () => void;
  onSuccess: (title: string, message: string) => void;
  onError: (title: string, message: string) => void;
}

type Open = { id: string; panel: 'roster' | 'edit' | 'event' } | null;

export default function ScopedConsole({ side, orgId, orgName, grants, teams, divisions, onChanged, onSuccess, onError }: Props) {
  const [open, setOpen] = useState<Open>(null);
  const toggle = (id: string, panel: NonNullable<Open>['panel']) => setOpen(o => (o?.id === id && o.panel === panel ? null : { id, panel }));

  // The sections each team gets: its own grant, plus any grant on a division it is entered in.
  const teamSections = new Map<string, Set<string>>();
  const add = (teamId: string, sections: string[]) => {
    const set = teamSections.get(teamId) ?? new Set<string>();
    sections.forEach(s => set.add(s));
    teamSections.set(teamId, set);
  };
  for (const g of grants) {
    if (g.scopeType === 'team') add(g.scopeId, g.sections);
    else for (const tid of divisions.find(d => d.id === g.scopeId)?.team_ids ?? []) add(tid, g.sections);
  }
  const myTeams = teams.filter(t => t.status === 'active' && teamSections.has(t.id));
  const myDivisions = grants.filter(g => g.scopeType === 'division').flatMap(g => {
    const d = divisions.find(x => x.id === g.scopeId);
    return d ? [{ division: d, sections: new Set(g.sections) }] : [];
  });
  const btn = 'min-h-[44px] px-3 text-sm rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors';
  const card = 'bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6';
  const allTeams = teams.filter(t => t.status === 'active').map(t => ({ id: t.id, name: t.name }));

  return (
    <div className="space-y-6" data-scoped-console="">
      <section className={card}>
        <h2 className="text-lg font-semibold text-primary">What you run</h2>
        <p className="mt-1 text-sm text-tertiary">
          {`Your access at ${orgName ?? `this ${side}`} covers ${[
            myTeams.length ? `${myTeams.length} ${myTeams.length === 1 ? 'team' : 'teams'}` : null,
            myDivisions.length ? `${myDivisions.length} ${myDivisions.length === 1 ? 'division' : 'divisions'}` : null,
          ].filter(Boolean).join(' and ') || 'nothing active right now'}.`}
        </p>
        <p className="mt-1 text-xs text-muted">Access tied to a season ends when that season is rolled over.</p>
      </section>

      {myDivisions.map(({ division, sections }) => (
        <section key={division.id} aria-label={division.name} className={card} data-scoped-division={division.id}>
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-primary break-words">{division.name}</h2>
              <p className="text-xs text-muted">{[division.season_label, [...sections].map(s => SECTION_LABELS[s as keyof typeof SECTION_LABELS] ?? s).join(', ')].filter(Boolean).join(' · ')}</p>
            </div>
            <Link href={`/${side}/${orgId}/divisions/${division.id}`} className="text-sm font-medium text-brand-fg hover:underline">Division page →</Link>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {sections.has('seasons') && (
              <button type="button" aria-expanded={open?.id === division.id && open.panel === 'edit'} onClick={() => toggle(division.id, 'edit')} className={btn}>
                Edit division
              </button>
            )}
            {(sections.has('seasons') || sections.has('competitions')) && (
              <button type="button" aria-expanded={open?.id === division.id && open.panel === 'event'} onClick={() => toggle(division.id, 'event')} className={btn}>
                Add an event
              </button>
            )}
          </div>
          {open?.id === division.id && open.panel === 'edit' && (
            <DivisionEditForm side={side} orgId={orgId} division={division} onSaved={m => { onSuccess('Division', m); onChanged(); }} onError={m => onError('Division', m)} onClose={() => setOpen(null)} />
          )}
          {open?.id === division.id && open.panel === 'event' && (
            <ScopedEventForm scope={{ type: 'division', id: division.id, name: division.name }} onSaved={m => onSuccess('Calendar', m)} onError={m => onError('Calendar', m)} onClose={() => setOpen(null)} />
          )}
        </section>
      ))}

      {myTeams.map(team => {
        const sections = teamSections.get(team.id) ?? new Set<string>();
        const runsTeam = sections.has('teams');
        const schedules = runsTeam || sections.has('competitions');
        return (
          <section key={team.id} aria-label={team.name} className={card} data-scoped-team={team.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-lg font-semibold text-primary break-words">{team.name}</h2>
              <Link href={`/${side}/${orgId}/teams/${team.id}`} className="text-sm font-medium text-brand-fg hover:underline">Team page →</Link>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {runsTeam && (
                <>
                  <button type="button" aria-expanded={open?.id === team.id && open.panel === 'roster'} onClick={() => toggle(team.id, 'roster')} className={btn}>
                    Roster
                  </button>
                  <button type="button" aria-expanded={open?.id === team.id && open.panel === 'edit'} onClick={() => toggle(team.id, 'edit')} className={btn}>
                    Edit team
                  </button>
                </>
              )}
              {schedules && (
                <button type="button" aria-expanded={open?.id === team.id && open.panel === 'event'} onClick={() => toggle(team.id, 'event')} className={btn}>
                  Add an event
                </button>
              )}
            </div>
            {open?.id === team.id && open.panel === 'roster' && (
              <TeamRosterPanel
                side={side}
                orgId={orgId}
                team={{ id: team.id, name: team.name }}
                otherTeams={allTeams.filter(t => t.id !== team.id && teamSections.get(t.id)?.has('teams'))}
                onSuccess={m => onSuccess('Team roster', m)}
                onError={m => onError('Team roster', m)}
                onMoved={() => setOpen(null)}
              />
            )}
            {open?.id === team.id && open.panel === 'edit' && (
              <TeamIdentityForm side={side} orgId={orgId} team={team} onSaved={m => { onSuccess('Team', m); onChanged(); }} onError={m => onError('Team', m)} onClose={() => setOpen(null)} />
            )}
            {open?.id === team.id && open.panel === 'event' && (
              <ScopedEventForm scope={{ type: 'team', id: team.id, name: team.name }} onSaved={m => onSuccess('Calendar', m)} onError={m => onError('Calendar', m)} onClose={() => setOpen(null)} />
            )}
          </section>
        );
      })}
    </div>
  );
}
