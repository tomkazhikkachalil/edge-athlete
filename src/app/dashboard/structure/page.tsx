'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';
import { FEATURE_FLAGS } from '@/lib/features';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';

// Admin structure console (0.5): seasons → divisions → team entries, plus
// the org's persistent teams. The ONLY structure writer in v1 (Tom,
// Aug 31) — org-manager CRUD arrives with phase 1's dashboard. Access =
// ADMIN_EMAILS, enforced server-side; a 403 renders the lock panel.

interface OrgOption {
  side: 'league' | 'club';
  id: string;
  name: string;
}

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
  capacity_estimate: number | null;
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

export default function AdminStructurePage() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { showSuccess, showError } = useToast();

  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [selected, setSelected] = useState<OrgOption | null>(null);
  const [seasons, setSeasons] = useState<SeasonRow[]>([]);
  const [teams, setTeams] = useState<TeamRow[]>([]);
  const [reloadKey, setReloadKey] = useState(0);
  const [confirmTarget, setConfirmTarget] = useState<
    | { kind: 'season'; id: string; label: string }
    | { kind: 'division'; id: string; label: string }
    | { kind: 'team'; id: string; label: string }
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

  useEffect(() => {
    if (!authLoading && !user) router.push('/');
  }, [user, authLoading, router]);

  // Org lists (the existing admin GETs — no new endpoint).
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const [leaguesRes, clubsRes] = await Promise.all([
          fetch('/api/admin/leagues'),
          fetch('/api/admin/clubs'),
        ]);
        if (cancelled) return;
        if (leaguesRes.status === 403) {
          setAuthorized(false);
          return;
        }
        setAuthorized(true);
        const leagues = leaguesRes.ok ? (await leaguesRes.json()).leagues ?? [] : [];
        const clubs = clubsRes.ok ? (await clubsRes.json()).clubs ?? [] : [];
        if (cancelled) return;
        setOrgs([
          ...leagues.map((l: { id: string; name: string }) => ({ side: 'league' as const, id: l.id, name: l.name })),
          ...clubs.map((c: { id: string; name: string }) => ({ side: 'club' as const, id: c.id, name: c.name })),
        ]);
      } catch {
        if (!cancelled) setAuthorized(false);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  // The one aggregate per selected org.
  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(
          `/api/admin/structure?side=${selected.side}&orgId=${encodeURIComponent(selected.id)}`
        );
        if (!response.ok || cancelled) return;
        const data = await response.json();
        if (cancelled) return;
        setSeasons(data.seasons ?? []);
        setTeams(data.teams ?? []);
      } catch {
        /* console is additive */
      }
    })();
    return () => { cancelled = true; };
  }, [selected, reloadKey]);

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

  const createSeason = async () => {
    if (!selected || !seasonLabel.trim()) {
      showError('Structure', 'A season label is required');
      return;
    }
    const ok = await act(
      '/api/admin/structure/seasons',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          side: selected.side,
          orgId: selected.id,
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
      '/api/admin/structure/divisions',
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
    if (!selected || !teamName.trim()) {
      showError('Structure', 'A team name is required');
      return;
    }
    const ok = await act(
      '/api/admin/structure/teams',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ side: selected.side, orgId: selected.id, name: teamName.trim() }),
      },
      'Team created',
      'Failed to create team'
    );
    if (ok) setTeamName('');
  };

  const remove = (target: NonNullable<typeof confirmTarget>) => {
    const paths = {
      season: '/api/admin/structure/seasons',
      division: '/api/admin/structure/divisions',
      team: '/api/admin/structure/teams',
    } as const;
    void act(
      `${paths[target.kind]}?id=${encodeURIComponent(target.id)}`,
      { method: 'DELETE' },
      `${target.kind === 'season' ? 'Season' : target.kind === 'division' ? 'Division' : 'Team'} deleted`,
      'Delete failed'
    );
  };

  const teamById = new Map(teams.map(t => [t.id, t]));
  const activeTeams = teams.filter(t => t.status === 'active');

  if (authLoading || authorized === null) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand"></div>
        </div>
      </div>
    );
  }

  if (!authorized) {
    return (
      <div className="min-h-screen bg-canvas">
        <AppHeader showSearch={false} />
        <div className="flex items-center justify-center py-20">
          <div className="text-center max-w-md mx-auto px-4">
            <div className="w-16 h-16 bg-surface-sunken rounded-full flex items-center justify-center mx-auto mb-4">
              <i className="fas fa-lock text-2xl text-faint" aria-hidden="true"></i>
            </div>
            <h1 className="text-2xl font-bold text-primary mb-2">Admin access required</h1>
            <p className="text-sm text-tertiary">This area is for Edge Athlete administrators.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-canvas">
      <AppHeader showSearch={false} />

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-8">
        <div>
          <Link href="/dashboard" className="text-sm text-brand-fg hover:text-brand-fg-strong">
            ← Admin
          </Link>
          <h1 className="mt-2 text-2xl sm:text-3xl font-bold text-primary">
            <i className="fas fa-sitemap mr-2 text-brand-fg"></i>
            Structure
          </h1>
        </div>

        {/* Org selector */}
        <section className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
          <label htmlFor="structure-org" className="block text-sm font-medium text-secondary mb-1">
            Organization
          </label>
          <select
            id="structure-org"
            value={selected ? `${selected.side}:${selected.id}` : ''}
            onChange={e => {
              const [side, id] = e.target.value.split(':');
              const org = orgs.find(o => o.side === side && o.id === id) ?? null;
              setSelected(org);
              setDivisionSeasonId(null);
            }}
            className="w-full px-3 py-2 border border-border-strong rounded-md outline-none"
          >
            <option value="">Select an organization…</option>
            {orgs.map(o => (
              <option key={`${o.side}:${o.id}`} value={`${o.side}:${o.id}`}>
                {o.name} ({o.side})
              </option>
            ))}
          </select>
        </section>

        {selected && (
          <>
            {/* Seasons */}
            <section className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
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
                                              `/api/admin/structure/entries?id=${encodeURIComponent(entry.id)}`,
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
                                            '/api/admin/structure/entries',
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

            {/* Teams */}
            <section className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6">
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
                        {team.status === 'archived' && (
                          <p className="text-xs text-muted">Archived</p>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            void act(
                              '/api/admin/structure/teams',
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
                        <button
                          type="button"
                          onClick={() => setConfirmTarget({ kind: 'team', id: team.id, label: team.name })}
                          aria-label={`Delete ${team.name}`}
                          className="ea-icon-btn inline-flex items-center justify-center text-muted hover:text-red-600"
                        >
                          <i className="fas fa-trash" aria-hidden="true"></i>
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={!!confirmTarget}
        title={`Delete ${confirmTarget?.label ?? 'this'}?`}
        message={
          confirmTarget?.kind === 'season'
            ? 'Its divisions and their entries are removed too. Teams persist.'
            : confirmTarget?.kind === 'division'
              ? 'Its entries are removed too. Teams persist.'
              : 'The team and its entries are removed. Prefer Archive — teams are meant to persist.'
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
