'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import ConfirmModal from '@/components/ConfirmModal';
import OrgSetupChecklist from '@/components/orgs/OrgSetupChecklist';
import { useToast } from '@/components/Toast';
import { FEATURE_FLAGS } from '@/lib/features';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';

// ── The org-manager console (phase 1, round 1) ──────────────────────────────
// The guardian-console shape (AppHeader — a recurring signed-in
// destination), forked from the admin structure console minus the org
// selector: the org comes from the URL, the gate from the server
// (requireOrgManager behind /api/{side}s/[id]/structure*). A non-manager
// gets an in-page notice, never a dead end. Admin console sibling:
// src/app/dashboard/structure/page.tsx.

interface EntryRow {
  id: string;
  team_id: string;
}

interface DivisionRow {
  id: string;
  season_id: string;
  sport_key: string;
  name: string;
  age_band: string | null;
  gender_stream: string | null;
  tier: string | null;
  entries: EntryRow[];
}

interface SeasonRow {
  id: string;
  label: string;
  starts_on: string | null;
  ends_on: string | null;
  sport_key: string | null;
  divisions: DivisionRow[];
}

interface TeamRow {
  id: string;
  name: string;
  display_name: string | null;
  status: 'active' | 'archived';
}

interface CompetitionEntryRow {
  id: string;
  team_id: string | null;
  profile_id: string | null;
  status: string;
  entrant_name: string;
}

interface CompetitionRow {
  id: string;
  season_id: string;
  division_id: string | null;
  sport_key: string;
  name: string;
  format: string;
  entrant_type: string;
  status: 'draft' | 'active' | 'completed' | 'archived';
  visibility: 'public' | 'private';
  season_label: string | null;
  entries: CompetitionEntryRow[];
}

export default function OrgConsolePage() {
  const params = useParams();
  const side = params.side as string;
  const orgId = params.id as string;
  const validSide = side === 'league' || side === 'club';
  const plural = side === 'league' ? 'leagues' : 'clubs';

  const { user, initialAuthCheckComplete } = useAuth();
  const { showSuccess, showError } = useToast();

  const [orgName, setOrgName] = useState<string | null>(null);
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [counts, setCounts] = useState<{ managers: number; rosterAthletes: number }>({
    managers: 0,
    rosterAthletes: 0,
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmTarget, setConfirmTarget] = useState<
    | { kind: 'season'; id: string; label: string }
    | { kind: 'division'; id: string; label: string }
    | null
  >(null);

  // Create forms
  const [seasonLabel, setSeasonLabel] = useState('');
  const [seasonStarts, setSeasonStarts] = useState('');
  const [seasonEnds, setSeasonEnds] = useState('');
  const [seasonSport, setSeasonSport] = useState('');
  const [divisionSeasonId, setDivisionSeasonId] = useState<string | null>(null);
  const [divisionName, setDivisionName] = useState('');
  const [divisionSport, setDivisionSport] = useState('golf');
  const [divisionAge, setDivisionAge] = useState('');
  const [divisionGender, setDivisionGender] = useState('');
  const [divisionTier, setDivisionTier] = useState('');
  const [teamName, setTeamName] = useState('');
  // Roster import (R3): per-team inline expander, the divisionSeasonId
  // toggle precedent (never a modal — 375px).
  const [importTeamId, setImportTeamId] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<
    { name: string; claimUrl: string | null; emailSent: boolean; error?: string }[] | null
  >(null);
  // Competitions (phase 2 R1). The console creates FIXTURE competitions
  // only — the leaderboard flow arrives with its round (R5); the API
  // already accepts both.
  const [competitions, setCompetitions] = useState<CompetitionRow[]>([]);
  const [affiliatedTeams, setAffiliatedTeams] = useState<
    { id: string; name: string; club_name: string }[]
  >([]);
  const [compName, setCompName] = useState('');
  const [compSeasonId, setCompSeasonId] = useState('');
  const [compDivisionId, setCompDivisionId] = useState('');
  const [compSport, setCompSport] = useState('ice_hockey');
  const [compPublic, setCompPublic] = useState(false);
  const [entriesCompetitionId, setEntriesCompetitionId] = useState<string | null>(null);

  useEffect(() => {
    if (!validSide || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const [orgRes, structureRes, competitionsRes] = await Promise.all([
          fetch(`/api/${plural}/${orgId}`),
          fetch(`/api/${plural}/${orgId}/structure`),
          fetch(`/api/${plural}/${orgId}/competitions`),
        ]);
        if (cancelled) return;
        if (orgRes.ok) {
          const data = await orgRes.json();
          if (!cancelled) setOrgName((data.league ?? data.club)?.name ?? null);
        }
        if (structureRes.status === 403 || structureRes.status === 401) {
          setAuthorized(false);
          return;
        }
        if (!structureRes.ok) {
          setAuthorized(false);
          return;
        }
        const structure = await structureRes.json();
        if (cancelled) return;
        setAuthorized(true);
        setSeasons(structure.seasons ?? []);
        setTeams(structure.teams ?? []);
        setCounts(structure.counts ?? { managers: 0, rosterAthletes: 0 });
        // Pre-151 the route degrades to an empty list; any other failure
        // renders the section empty rather than blocking the console.
        if (competitionsRes.ok) {
          const compBody = await competitionsRes.json();
          if (!cancelled) {
            setCompetitions(compBody.competitions ?? []);
            setAffiliatedTeams(compBody.affiliatedTeams ?? []);
          }
        }
      } catch {
        if (!cancelled) setAuthorized(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [validSide, plural, orgId, user?.id, reloadKey]);

  const refresh = () => setReloadKey(k => k + 1);

  const act = async (
    path: string,
    init: RequestInit,
    successMessage: string,
    failMessage: string
  ) => {
    try {
      const response = await fetch(path, init);
      const body = await response.json();
      if (!response.ok) {
        showError('Structure', body.error || failMessage);
        return false;
      }
      showSuccess('Structure', successMessage);
      refresh();
      return true;
    } catch (e) {
      console.error('Structure action failed:', e);
      showError('Structure', failMessage);
      return false;
    }
  };

  const base = `/api/${plural}/${orgId}/structure`;

  const createSeason = async () => {
    if (!seasonLabel.trim()) {
      showError('Structure', 'A season label is required');
      return;
    }
    const ok = await act(
      `${base}/seasons`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          side,
          orgId,
          label: seasonLabel.trim(),
          ...(seasonStarts ? { startsOn: seasonStarts } : {}),
          ...(seasonEnds ? { endsOn: seasonEnds } : {}),
          ...(seasonSport ? { sportKey: seasonSport } : {}),
        }),
      },
      'Season created',
      'Failed to create season'
    );
    if (ok) {
      setSeasonLabel('');
      setSeasonStarts('');
      setSeasonEnds('');
      setSeasonSport('');
    }
  };

  const createDivision = async (seasonId: string) => {
    if (!divisionName.trim()) {
      showError('Structure', 'A division name is required');
      return;
    }
    const ok = await act(
      `${base}/divisions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          seasonId,
          sportKey: divisionSport,
          name: divisionName.trim(),
          ...(divisionAge.trim() ? { ageBand: divisionAge.trim() } : {}),
          ...(divisionGender.trim() ? { genderStream: divisionGender.trim() } : {}),
          ...(divisionTier.trim() ? { tier: divisionTier.trim() } : {}),
        }),
      },
      'Division created',
      'Failed to create division'
    );
    if (ok) {
      setDivisionName('');
      setDivisionAge('');
      setDivisionGender('');
      setDivisionTier('');
    }
  };

  const createTeam = async () => {
    if (!teamName.trim()) {
      showError('Structure', 'A team name is required');
      return;
    }
    const ok = await act(
      `${base}/teams`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ side, orgId, name: teamName.trim() }),
      },
      'Team created',
      'Failed to create team'
    );
    if (ok) setTeamName('');
  };

  const runImport = async (teamId: string) => {
    if (!importText.trim() || importing) return;
    setImporting(true);
    setImportReport(null);
    try {
      const response = await fetch(`/api/${plural}/${orgId}/roster-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ teamId, text: importText }),
      });
      const body = await response.json();
      if (!response.ok) {
        showError('Roster import', body.error || 'Import failed');
        return;
      }
      setImportReport(body.report ?? []);
      setImportText('');
      showSuccess('Roster import', `${(body.report ?? []).filter((r: { error?: string }) => !r.error).length} athletes imported`);
      refresh();
    } catch (e) {
      console.error('Roster import failed:', e);
      showError('Roster import', 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  const createCompetition = async () => {
    if (!compName.trim() || !compSeasonId) {
      showError('Competitions', 'A name and season are required');
      return;
    }
    const ok = await act(
      `/api/${plural}/${orgId}/competitions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          side,
          orgId,
          seasonId: compSeasonId,
          ...(compDivisionId ? { divisionId: compDivisionId } : {}),
          sportKey: compSport,
          name: compName.trim(),
          format: 'fixture',
          visibility: compPublic ? 'public' : 'private',
        }),
      },
      'Competition created',
      'Failed to create competition'
    );
    if (ok) {
      setCompName('');
      setCompDivisionId('');
      setCompPublic(false);
    }
  };

  const patchCompetition = (competitionId: string, patch: { status?: string; visibility?: string }) =>
    act(
      `/api/${plural}/${orgId}/competitions`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: competitionId, ...patch }),
      },
      'Competition updated',
      'Failed to update competition'
    );

  const remove = (target: NonNullable<typeof confirmTarget>) => {
    const paths = { season: `${base}/seasons`, division: `${base}/divisions` } as const;
    void act(
      `${paths[target.kind]}?id=${encodeURIComponent(target.id)}`,
      { method: 'DELETE' },
      `${target.kind === 'season' ? 'Season' : 'Division'} deleted`,
      'Delete failed'
    );
  };

  const teamById = new Map(teams.map(t => [t.id, t]));
  const activeTeams = teams.filter(t => t.status === 'active');
  const hasSeasonWithDates = seasons.some(s => s.starts_on && s.ends_on);
  const hasDivisions = seasons.some(s => s.divisions.length > 0);

  if (!validSide) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-tertiary">Not found.</p>
        </div>
      </div>
    );
  }

  if (!initialAuthCheckComplete || (user && authorized === null)) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
        </div>
      </div>
    );
  }

  if (!user || authorized === false) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center max-w-md mx-auto px-4">
            <div className="w-16 h-16 bg-surface-sunken rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-lock text-2xl text-faint" aria-hidden="true"></i>
            </div>
            <h1 className="text-2xl font-bold text-primary mb-2">Managers only</h1>
            <p className="text-sm text-tertiary mb-4">
              This console is for the organization&apos;s owner and managers.
            </p>
            <Link
              href={`/${side}/${orgId}`}
              className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium"
            >
              View the public page →
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-primary">
            <i className="fas fa-sitemap mr-2 text-brand-fg" aria-hidden="true"></i>
            {orgName ?? 'Organization'}
          </h1>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <Link href={`/${side}/${orgId}`} className="text-brand-fg hover:text-brand-fg-strong">
              View public page
            </Link>
            <Link
              href={`/${side}/${orgId}`}
              className="text-brand-fg hover:text-brand-fg-strong"
            >
              Members &amp; roster
            </Link>
          </div>
        </div>

        <OrgSetupChecklist
          storageKey={`org-checklist:${side}:${orgId}`}
          input={{
            hasSeasonWithDates,
            hasDivisions,
            hasTeams: teams.length > 0,
            managerCount: counts.managers,
            rosterAthleteCount: counts.rosterAthletes,
          }}
        />

        {/* Roster (R3) — counts + the door; per-team import lives on the
            team rows below. */}
        <section
          aria-label="Roster"
          className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
        >
          <h2 className="text-lg font-semibold text-primary mb-1">Roster</h2>
          <p className="text-sm text-tertiary">
            {counts.rosterAthletes} rostered athlete{counts.rosterAthletes === 1 ? '' : 's'}.
            Import athletes per team below — each import creates claimable profiles and
            claim links to hand out.
          </p>
          <Link
            href={`/${side}/${orgId}#members`}
            className="mt-2 inline-block text-sm text-brand-fg hover:text-brand-fg-strong"
          >
            View members &amp; roster →
          </Link>
        </section>

        {/* Seasons & divisions — forked from the admin console; the org is
            the URL's, every write scope-pinned server-side. */}
        <section
          aria-label="Seasons and divisions"
          className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
        >
          <h2 className="text-lg font-semibold text-primary mb-4">Seasons</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            <input
              type="text"
              value={seasonLabel}
              maxLength={60}
              onChange={e => setSeasonLabel(e.target.value)}
              placeholder="Label (e.g., 2026-27)"
              aria-label="Season label"
              className="grow basis-40 min-w-0 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
            />
            <input
              type="date"
              value={seasonStarts}
              onChange={e => setSeasonStarts(e.target.value)}
              aria-label="Season starts"
              className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
            />
            <input
              type="date"
              value={seasonEnds}
              onChange={e => setSeasonEnds(e.target.value)}
              aria-label="Season ends"
              className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
            />
            <select
              value={seasonSport}
              onChange={e => setSeasonSport(e.target.value)}
              aria-label="Season sport"
              className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
            >
              <option value="">All sports</option>
              {FEATURE_FLAGS.FEATURE_SPORTS.map(key => (
                <option key={key} value={key}>
                  {SPORT_REGISTRY[key]?.display_name ?? key}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void createSeason()}
              className="px-4 py-2 text-sm min-h-[40px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
            >
              Add season
            </button>
          </div>

          {seasons.length === 0 ? (
            <p className="text-sm text-tertiary">No seasons yet.</p>
          ) : (
            <ul className="space-y-3">
              {seasons.map(season => (
                <li key={season.id} className="border border-border rounded-lg p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium text-primary">{season.label}</p>
                      <p className="text-xs text-muted">
                        {[season.starts_on, season.ends_on].filter(Boolean).join(' → ') || 'No dates'}
                        {season.sport_key
                          ? ` · ${SPORT_REGISTRY[season.sport_key as keyof typeof SPORT_REGISTRY]?.display_name ?? season.sport_key}`
                          : ''}
                      </p>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setDivisionSeasonId(divisionSeasonId === season.id ? null : season.id)}
                        className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                      >
                        {divisionSeasonId === season.id ? 'Close divisions' : 'Divisions'}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmTarget({ kind: 'season', id: season.id, label: season.label })}
                        aria-label={`Delete ${season.label}`}
                        className="ea-icon-btn inline-flex items-center justify-center text-muted hover:text-red-600"
                      >
                        <i className="fas fa-trash" aria-hidden="true"></i>
                      </button>
                    </div>
                  </div>

                  {divisionSeasonId === season.id && (
                    <div className="mt-3 border-t border-border-subtle pt-3">
                      <div className="flex flex-wrap gap-2 mb-3">
                        <input
                          type="text"
                          value={divisionName}
                          maxLength={80}
                          onChange={e => setDivisionName(e.target.value)}
                          placeholder="Division name (e.g., U13 Boys A)"
                          aria-label="Division name"
                          className="grow basis-48 min-w-0 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                        />
                        <select
                          value={divisionSport}
                          onChange={e => setDivisionSport(e.target.value)}
                          aria-label="Division sport"
                          className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                        >
                          {FEATURE_FLAGS.FEATURE_SPORTS.map(key => (
                            <option key={key} value={key}>
                              {SPORT_REGISTRY[key]?.display_name ?? key}
                            </option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={divisionAge}
                          maxLength={30}
                          onChange={e => setDivisionAge(e.target.value)}
                          placeholder="Age band"
                          aria-label="Age band"
                          className="w-28 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                        />
                        <input
                          type="text"
                          value={divisionGender}
                          maxLength={30}
                          onChange={e => setDivisionGender(e.target.value)}
                          placeholder="Stream"
                          aria-label="Gender stream"
                          className="w-28 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                        />
                        <input
                          type="text"
                          value={divisionTier}
                          maxLength={30}
                          onChange={e => setDivisionTier(e.target.value)}
                          placeholder="Tier"
                          aria-label="Tier"
                          className="w-24 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => void createDivision(season.id)}
                          className="px-3 py-2 text-sm min-h-[40px] rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                        >
                          Add division
                        </button>
                      </div>

                      {season.divisions.length === 0 ? (
                        <p className="text-xs text-muted">No divisions in this season.</p>
                      ) : (
                        <ul className="space-y-2">
                          {season.divisions.map(division => (
                            <li key={division.id} className="rounded-md bg-surface-muted p-2">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-medium text-primary">{division.name}</p>
                                  <p className="text-xs text-muted">
                                    {[
                                      SPORT_REGISTRY[division.sport_key as keyof typeof SPORT_REGISTRY]?.display_name ?? division.sport_key,
                                      division.age_band,
                                      division.gender_stream,
                                      division.tier,
                                    ].filter(Boolean).join(' · ')}
                                  </p>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => setConfirmTarget({ kind: 'division', id: division.id, label: division.name })}
                                  aria-label={`Delete ${division.name}`}
                                  className="ea-icon-btn inline-flex items-center justify-center text-muted hover:text-red-600"
                                >
                                  <i className="fas fa-trash" aria-hidden="true"></i>
                                </button>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                {division.entries.map(entry => (
                                  <span
                                    key={entry.id}
                                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-surface-sunken text-secondary"
                                  >
                                    {teamById.get(entry.team_id)?.name ?? 'Unknown team'}
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void act(
                                          `${base}/entries?id=${encodeURIComponent(entry.id)}`,
                                          { method: 'DELETE' },
                                          'Entry removed',
                                          'Failed to remove the entry'
                                        )
                                      }
                                      aria-label="Remove entry"
                                      className="text-muted hover:text-red-600"
                                    >
                                      <i className="fas fa-times" aria-hidden="true"></i>
                                    </button>
                                  </span>
                                ))}
                                {activeTeams.length > 0 && (
                                  <select
                                    value=""
                                    onChange={e => {
                                      if (!e.target.value) return;
                                      void act(
                                        `${base}/entries`,
                                        {
                                          method: 'POST',
                                          headers: { 'Content-Type': 'application/json' },
                                          body: JSON.stringify({ teamId: e.target.value, divisionId: division.id }),
                                        },
                                        'Team entered',
                                        'Failed to enter the team'
                                      );
                                    }}
                                    aria-label={`Enter a team in ${division.name}`}
                                    className="px-2 py-1 text-xs border border-border-strong rounded-md outline-none"
                                  >
                                    <option value="">+ Enter team…</option>
                                    {activeTeams.map(t => (
                                      <option key={t.id} value={t.id}>{t.name}</option>
                                    ))}
                                  </select>
                                )}
                              </div>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Teams — archive/restore only; teams persist (no manager delete). */}
        <section
          aria-label="Teams"
          className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
        >
          <h2 className="text-lg font-semibold text-primary mb-4">Teams</h2>
          <div className="flex flex-wrap gap-2 mb-4">
            <input
              type="text"
              value={teamName}
              maxLength={80}
              onChange={e => setTeamName(e.target.value)}
              placeholder="Team name (e.g., Blazers U13 A)"
              aria-label="Team name"
              className="grow basis-48 min-w-0 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
            />
            <button
              type="button"
              onClick={() => void createTeam()}
              className="px-4 py-2 text-sm min-h-[40px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
            >
              Add team
            </button>
          </div>
          {teams.length === 0 ? (
            <p className="text-sm text-tertiary">No teams yet.</p>
          ) : (
            <ul className="space-y-2">
              {teams.map(team => (
                <li key={team.id} className="flex flex-wrap items-center justify-between gap-2 p-2 rounded-lg hover:bg-surface-muted">
                  <div className="min-w-0 grow basis-40">
                    <p className="font-medium text-primary">{team.name}</p>
                    {team.status === 'archived' && <p className="text-xs text-muted">Archived</p>}
                  </div>
                  <div className="flex gap-2 shrink-0">
                    {team.status === 'active' && (
                      <button
                        type="button"
                        onClick={() => {
                          setImportTeamId(importTeamId === team.id ? null : team.id);
                          setImportReport(null);
                        }}
                        className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                      >
                        {importTeamId === team.id ? 'Close import' : 'Import roster'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() =>
                        void act(
                          `${base}/teams`,
                          {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              id: team.id,
                              status: team.status === 'active' ? 'archived' : 'active',
                            }),
                          },
                          team.status === 'active' ? 'Team archived' : 'Team restored',
                          'Failed to update team'
                        )
                      }
                      className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                    >
                      {team.status === 'active' ? 'Archive' : 'Restore'}
                    </button>
                  </div>
                  {importTeamId === team.id && (
                    <div className="w-full mt-2 border-t border-border-subtle pt-3 space-y-2">
                      <textarea
                        value={importText}
                        onChange={e => setImportText(e.target.value)}
                        rows={4}
                        aria-label="Roster import lines"
                        placeholder={'One athlete per line:\nFirst Last, email@example.com (email optional)'}
                        className="w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                      />
                      <button
                        type="button"
                        disabled={importing || !importText.trim()}
                        onClick={() => void runImport(team.id)}
                        className="px-4 py-2 text-sm min-h-[44px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
                      >
                        {importing ? 'Importing…' : 'Import'}
                      </button>
                      {importReport && (
                        <ul className="space-y-1.5">
                          {importReport.map((r, i) => (
                            <li key={`${r.name}-${i}`} className="text-xs">
                              <span className="font-medium text-primary">{r.name}</span>{' '}
                              {r.error ? (
                                <span className="text-red-600">failed ({r.error})</span>
                              ) : (
                                <>
                                  {r.emailSent ? (
                                    <span className="text-emerald-600">emailed</span>
                                  ) : (
                                    <span className="text-muted">link only</span>
                                  )}
                                  {r.claimUrl && (
                                    <span className="mt-0.5 flex flex-wrap items-center gap-1.5">
                                      <input
                                        readOnly
                                        value={r.claimUrl}
                                        aria-label={`Claim link for ${r.name}`}
                                        className="grow basis-48 min-w-0 px-2 py-1 border border-border rounded-md text-[11px] text-muted"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => void navigator.clipboard.writeText(r.claimUrl!)}
                                        className="px-2 py-1 min-h-[32px] rounded-md border border-border-strong text-secondary hover:bg-surface-sunken"
                                      >
                                        Copy
                                      </button>
                                    </span>
                                  )}
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Competitions (phase 2 R1) — create + entries; contests and
            standings arrive with rounds 2–3's detail subpage. */}
        <section
          aria-label="Competitions"
          className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
        >
          <h2 className="text-lg font-semibold text-primary mb-1">Competitions</h2>
          <p className="text-sm text-tertiary mb-4">
            A competition holds a schedule and standings. Create one per season — pin it
            to a division for house play.
          </p>
          {seasons.length === 0 ? (
            <p className="text-sm text-tertiary">Create a season first.</p>
          ) : (
            <div className="flex flex-wrap gap-2 mb-4">
              <input
                type="text"
                value={compName}
                maxLength={80}
                onChange={e => setCompName(e.target.value)}
                placeholder="Name (e.g., House League)"
                aria-label="Competition name"
                className="grow basis-44 min-w-0 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
              />
              <select
                value={compSeasonId}
                onChange={e => {
                  setCompSeasonId(e.target.value);
                  setCompDivisionId('');
                }}
                aria-label="Competition season"
                className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
              >
                <option value="">Season…</option>
                {seasons.map(s => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
              <select
                value={compDivisionId}
                onChange={e => setCompDivisionId(e.target.value)}
                aria-label="Competition division"
                className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
              >
                <option value="">Whole org</option>
                {(seasons.find(s => s.id === compSeasonId)?.divisions ?? []).map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
              <select
                value={compSport}
                onChange={e => setCompSport(e.target.value)}
                aria-label="Competition sport"
                className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
              >
                {FEATURE_FLAGS.FEATURE_SPORTS.map(key => (
                  <option key={key} value={key}>
                    {SPORT_REGISTRY[key]?.display_name ?? key}
                  </option>
                ))}
              </select>
              <label className="flex items-center gap-1.5 text-sm text-secondary">
                <input
                  type="checkbox"
                  checked={compPublic}
                  onChange={e => setCompPublic(e.target.checked)}
                  aria-label="Public competition"
                />
                Public
              </label>
              <button
                type="button"
                onClick={() => void createCompetition()}
                className="px-4 py-2 text-sm min-h-[40px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
              >
                Add competition
              </button>
            </div>
          )}

          {competitions.length === 0 ? (
            seasons.length > 0 && <p className="text-sm text-tertiary">No competitions yet.</p>
          ) : (
            <ul className="space-y-3">
              {competitions.map(comp => (
                <li key={comp.id} className="border border-border rounded-lg p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <Link
                        href={`/app/org/${side}/${orgId}/competitions/${comp.id}`}
                        className="font-medium text-primary hover:text-brand-fg"
                      >
                        {comp.name}
                      </Link>
                      <p className="text-xs text-muted">
                        {[
                          comp.season_label,
                          SPORT_REGISTRY[comp.sport_key as keyof typeof SPORT_REGISTRY]?.display_name ?? comp.sport_key,
                          comp.format,
                          comp.status,
                          comp.visibility === 'public' ? 'public' : 'private',
                        ].filter(Boolean).join(' · ')}
                      </p>
                    </div>
                    {/* min-w-0, NOT shrink-0: four buttons' max-content basis
                        (~341px) can't fit 375px minus padding; the container
                        must be allowed to shrink so its own wrap engages. */}
                    <div className="flex flex-wrap gap-2 min-w-0">
                      {comp.entrant_type === 'team' && (
                        <button
                          type="button"
                          onClick={() =>
                            setEntriesCompetitionId(entriesCompetitionId === comp.id ? null : comp.id)
                          }
                          className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                        >
                          {entriesCompetitionId === comp.id
                            ? 'Close entries'
                            : `Entries (${comp.entries.length})`}
                        </button>
                      )}
                      {comp.status === 'draft' && (
                        <button
                          type="button"
                          onClick={() => void patchCompetition(comp.id, { status: 'active' })}
                          className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                        >
                          Activate
                        </button>
                      )}
                      {comp.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => void patchCompetition(comp.id, { status: 'completed' })}
                          className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                        >
                          Complete
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() =>
                          void patchCompetition(comp.id, {
                            visibility: comp.visibility === 'public' ? 'private' : 'public',
                          })
                        }
                        className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                      >
                        {comp.visibility === 'public' ? 'Make private' : 'Make public'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void patchCompetition(comp.id, {
                            status: comp.status === 'archived' ? 'draft' : 'archived',
                          })
                        }
                        className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                      >
                        {comp.status === 'archived' ? 'Restore' : 'Archive'}
                      </button>
                    </div>
                  </div>

                  {entriesCompetitionId === comp.id && (
                    <div className="mt-2 flex flex-wrap items-center gap-1 border-t border-border-subtle pt-2">
                      {comp.entries.map(entry => (
                        <span
                          key={entry.id}
                          className="inline-flex max-w-full items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-surface-sunken text-secondary"
                        >
                          {/* min-w-0 + truncate: a long name must shrink or the
                              un-wrappable pill overflows 375px (R4's catch). */}
                          <span className="min-w-0 truncate">{entry.entrant_name}</span>
                          {entry.status === 'pending' && (
                            <>
                              <span className="text-amber-600">pending</span>
                              <button
                                type="button"
                                onClick={() =>
                                  void act(
                                    `/api/${plural}/${orgId}/competitions/entries`,
                                    {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ entryId: entry.id, decision: 'approved' }),
                                    },
                                    'Entry approved',
                                    'Failed to approve'
                                  )
                                }
                                aria-label={`Approve ${entry.entrant_name}`}
                                className="text-emerald-600 hover:text-emerald-700"
                              >
                                <i className="fas fa-check" aria-hidden="true"></i>
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void act(
                                    `/api/${plural}/${orgId}/competitions/entries`,
                                    {
                                      method: 'PATCH',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ entryId: entry.id, decision: 'rejected' }),
                                    },
                                    'Entry declined',
                                    'Failed to decline'
                                  )
                                }
                                aria-label={`Decline ${entry.entrant_name}`}
                                className="text-muted hover:text-red-600"
                              >
                                <i className="fas fa-ban" aria-hidden="true"></i>
                              </button>
                            </>
                          )}
                          {entry.status === 'rejected' && <span className="text-muted">declined</span>}
                          <button
                            type="button"
                            onClick={() =>
                              void act(
                                `/api/${plural}/${orgId}/competitions/entries?id=${encodeURIComponent(entry.id)}`,
                                { method: 'DELETE' },
                                'Entry removed',
                                'Failed to remove the entry'
                              )
                            }
                            aria-label={`Remove ${entry.entrant_name}`}
                            className="text-muted hover:text-red-600"
                          >
                            <i className="fas fa-times" aria-hidden="true"></i>
                          </button>
                        </span>
                      ))}
                      {(activeTeams.length > 0 || affiliatedTeams.length > 0) && (
                        <select
                          value=""
                          onChange={e => {
                            if (!e.target.value) return;
                            void act(
                              `/api/${plural}/${orgId}/competitions/entries`,
                              {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ competitionId: comp.id, teamId: e.target.value }),
                              },
                              'Team entered',
                              'Failed to enter the team'
                            );
                          }}
                          aria-label={`Enter a team in ${comp.name}`}
                          className="max-w-full px-2 py-1 text-xs border border-border-strong rounded-md outline-none"
                        >
                          <option value="">+ Enter team…</option>
                          {activeTeams.map(t => (
                            <option key={t.id} value={t.id}>{t.name}</option>
                          ))}
                          {affiliatedTeams.length > 0 && (
                            <optgroup label="Affiliated clubs (enter as pending)">
                              {affiliatedTeams.map(t => (
                                <option key={t.id} value={t.id}>
                                  {t.name} — {t.club_name}
                                </option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                      )}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      <ConfirmModal
        isOpen={!!confirmTarget}
        title={`Delete ${confirmTarget?.label ?? 'this'}?`}
        message={
          confirmTarget?.kind === 'season'
            ? 'Its divisions and their entries are removed too. Teams persist.'
            : 'Its entries are removed too. Teams persist.'
        }
        confirmText="Delete"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={() => {
          const target = confirmTarget;
          setConfirmTarget(null);
          if (target) remove(target);
        }}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}
