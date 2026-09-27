'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import DivisionEditForm from './DivisionEditForm';
import RolloverCarryPicker from './RolloverCarryPicker';
import { FEATURE_FLAGS } from '@/lib/features';
import { ORG_ROUTE_FAMILY, type OrgKind } from '@/lib/orgs/org-ref';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';

// ── The console's Seasons section (teams & divisions program, leftovers) ────
// Lifted out of the console page byte for byte (every label the specs read
// is unchanged): add a season, per season its divisions (add / edit / view /
// delete, enter a team), the structure CSV import (preview first) and the
// roll forward with the per-team roster carry (RolloverCarryPicker). The
// deletes go through the page's one ConfirmModal (onConfirmDelete) — it owns
// every destructive confirm in the console.
//
// 375px: every expander opens inline, never a modal; the action group wraps.

export interface ConsoleSeasonTeam {
  id: string;
  name: string;
  status: 'active' | 'archived';
}

export interface ConsoleSeasonRow {
  id: string;
  label: string;
  starts_on: string | null;
  ends_on: string | null;
  sport_key: string | null;
  archived?: boolean;
  divisions: {
    id: string;
    sport_key: string;
    name: string;
    age_band: string | null;
    gender_stream: string | null;
    tier: string | null;
    capacity_estimate?: number | null;
    entries: { id: string; team_id: string }[];
  }[];
}

interface Props {
  side: OrgKind;
  orgId: string;
  seasons: ConsoleSeasonRow[];
  teams: ConsoleSeasonTeam[];
  /** A golf-first org points an empty list at "Start our season". */
  golfFirst: boolean;
  /** The page's delete confirm (a season or a division). */
  onConfirmDelete: (target: { kind: 'season' | 'division'; id: string; label: string }) => void;
  /** The console re-reads its structure (the page's refresh). */
  onChanged: () => void;
  onSuccess: (title: string, message: string) => void;
  onError: (title: string, message: string) => void;
}

export default function SeasonsSection({ side, orgId, seasons, teams, golfFirst, onConfirmDelete, onChanged, onSuccess, onError }: Props) {
  const plural = ORG_ROUTE_FAMILY[side];
  const base = `/api/${plural}/${orgId}/structure`;
  // Create forms
  const [seasonLabel, setSeasonLabel] = useState('');
  const [seasonStarts, setSeasonStarts] = useState('');
  const [seasonEnds, setSeasonEnds] = useState('');
  const [seasonSport, setSeasonSport] = useState('');
  const [divisionSeasonId, setDivisionSeasonId] = useState<string | null>(null);
  // Phase 5.5: the roll-forward expander (one open at a time) + its form.
  const [rolloverSeasonId, setRolloverSeasonId] = useState<string | null>(null);
  // Phase 6 R5: the structure-import expander (dry-run-first).
  const [importSeasonId, setImportSeasonId] = useState<string | null>(null);
  const [importCsvText, setImportCsvText] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importCsvReport, setImportCsvReport] = useState<{
    dryRun: boolean;
    summary: { rows: number; errors: number; divisionsCreated: number; teamsCreated: number; entriesCreated: number };
    report: { row: number; division: string; team: string; divisionAction: string; teamAction: string; entryAction: string; error?: string }[];
  } | null>(null);
  const [rolloverLabel, setRolloverLabel] = useState('');
  const [rolloverStarts, setRolloverStarts] = useState('');
  const [rolloverEnds, setRolloverEnds] = useState('');
  // PR 11: the teams whose rosters carry into the new season (default none).
  const [rolloverCarry, setRolloverCarry] = useState<string[]>([]);
  const [divisionName, setDivisionName] = useState('');
  const [divisionSport, setDivisionSport] = useState('golf');
  const [divisionAge, setDivisionAge] = useState('');
  const [divisionGender, setDivisionGender] = useState('');
  const [divisionTier, setDivisionTier] = useState('');
  const [editDivisionId, setEditDivisionId] = useState<string | null>(null);

  const teamById = new Map(teams.map(t => [t.id, t]));
  const activeTeams = teams.filter(t => t.status === 'active');

  const act = useCallback(
    async (path: string, init: RequestInit, successMessage: string, failMessage: string, title = 'Structure') => {
      try {
        const response = await fetch(path, init);
        const body = await response.json();
        if (!response.ok) {
          onError(title, body.error || failMessage);
          return false;
        }
        onSuccess(title, successMessage);
        onChanged();
        return true;
      } catch (e) {
        console.error('Structure action failed:', e);
        onError(title, failMessage);
        return false;
      }
    },
    [onChanged, onError, onSuccess]
  );

  // Phase 6 R5: the structure-import runner — Preview (dryRun, default)
  // then Import (explicit dryRun:false); commit refreshes the console.
  const runStructureImport = async (seasonId: string, dryRun: boolean) => {
    if (importBusy) return;
    setImportBusy(true);
    try {
      const response = await fetch(`/api/${plural}/${orgId}/structure-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seasonId, csv: importCsvText, dryRun }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        onError('Structure import', body.error || 'Import failed');
        return;
      }
      setImportCsvReport(body);
      if (!dryRun) {
        onSuccess('Structure import', 'Imported — the season structure is updated');
        onChanged();
      }
    } catch {
      onError('Structure import', 'Import failed');
    } finally {
      setImportBusy(false);
    }
  };

  const createSeason = async () => {
    if (!seasonLabel.trim()) {
      onError('Structure', 'A season label is required');
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
      onError('Structure', 'A division name is required');
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

  return (
    <>
    {/* Seasons & divisions — forked from the admin console; the org is
        the URL's, every write scope-pinned server-side. */}
    <section
    id="seasons"
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
        <p className="text-sm text-tertiary">
          {golfFirst ? 'No seasons yet — "Start our season" under Leagues & events creates this year’s for you.' : 'No seasons yet.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {seasons.map(season => (
            <li key={season.id} className="border border-border rounded-lg p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-primary">
                    {season.label}
                    {season.archived && (
                      <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-surface-sunken text-muted">
                        Archived
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted">
                    {[season.starts_on, season.ends_on].filter(Boolean).join(' → ') || 'No dates'}
                    {season.sport_key
                      ? ` · ${SPORT_REGISTRY[season.sport_key as keyof typeof SPORT_REGISTRY]?.display_name ?? season.sport_key}`
                      : ''}
                  </p>
                </div>
                {/* Four actions do not fit beside a 375px card — the group wraps (the probe's overflow check). */}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDivisionSeasonId(divisionSeasonId === season.id ? null : season.id)}
                    className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                  >
                    {divisionSeasonId === season.id ? 'Close divisions' : 'Divisions'}
                  </button>
                  {!season.archived && (
                    <button
                      type="button"
                      onClick={() => {
                        setRolloverSeasonId(prev => (prev === season.id ? null : season.id));
                        setRolloverCarry([]);
                        setRolloverLabel('');
                        setRolloverStarts('');
                        setRolloverEnds('');
                      }}
                      className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                    >
                      {rolloverSeasonId === season.id ? 'Close roll forward' : 'Roll forward'}
                    </button>
                  )}
                  {!season.archived && (
                    <button
                      type="button"
                      onClick={() => {
                        setImportSeasonId(prev => (prev === season.id ? null : season.id));
                        setImportCsvText('');
                        setImportCsvReport(null);
                      }}
                      className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                    >
                      {importSeasonId === season.id ? 'Close import' : 'Import CSV'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => onConfirmDelete({ kind: 'season', id: season.id, label: season.label })}
                    aria-label={`Delete ${season.label}`}
                    className="ea-icon-btn inline-flex items-center justify-center text-muted hover:text-red-600"
                  >
                    <i className="fas fa-trash" aria-hidden="true"></i>
                  </button>
                </div>
              </div>

              {/* Phase 6 R5: structure import — paste CSV, preview
                  (dry-run default), then import. Inline expander,
                  never a modal; report wraps at 375px. */}
              {importSeasonId === season.id && (
                <div className="mt-3 border-t border-border-subtle pt-3">
                  <p className="text-xs text-muted mb-2">
                    Paste CSV with columns <code>division, team_name</code> (optional:
                    age_band, gender_stream, tier, sport). Preview shows what would
                    happen; importing twice is safe — existing rows are reused.
                  </p>
                  <textarea
                    value={importCsvText}
                    onChange={e => {
                      setImportCsvText(e.target.value);
                      setImportCsvReport(null);
                    }}
                    rows={5}
                    placeholder={'division,team_name\nU13 A,Blazers\nU13 A,Comets'}
                    aria-label="Structure CSV"
                    className="w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm font-mono"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={importBusy || importCsvText.trim() === ''}
                      onClick={() => void runStructureImport(season.id, true)}
                      className="px-3 py-1.5 text-sm min-h-[36px] rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50"
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      disabled={importBusy || importCsvReport === null || importCsvReport.dryRun !== true}
                      onClick={() => void runStructureImport(season.id, false)}
                      title={importCsvReport?.dryRun !== true ? 'Preview first' : undefined}
                      className="px-3 py-1.5 text-sm min-h-[36px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
                    >
                      Import
                    </button>
                  </div>
                  {importCsvReport && (
                    <div className="mt-2 text-xs text-secondary">
                      <p className="font-medium text-primary mb-1">
                        {importCsvReport.dryRun ? 'Preview' : 'Imported'}:{' '}
                        {importCsvReport.summary.rows} rows ·{' '}
                        {importCsvReport.summary.divisionsCreated} divisions,{' '}
                        {importCsvReport.summary.teamsCreated} teams,{' '}
                        {importCsvReport.summary.entriesCreated} entries
                        {importCsvReport.summary.errors > 0 && (
                          <span className="text-red-600"> · {importCsvReport.summary.errors} errors</span>
                        )}
                      </p>
                      <div className="overflow-x-auto">
                        <ul className="space-y-0.5">
                          {importCsvReport.report.map(r => (
                            <li key={r.row} className={r.error ? 'text-red-600' : ''}>
                              #{r.row} {r.division} / {r.team} — {r.divisionAction},{' '}
                              {r.teamAction}, {r.entryAction}
                              {r.error ? ` — ${r.error}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {rolloverSeasonId === season.id && (
                <div className="mt-3 border-t border-border-subtle pt-3">
                  <p className="text-xs text-muted mb-2">
                    Clones this season&apos;s divisions and programs, re-enters the same
                    teams, and archives this season. Rosters start empty unless you carry a
                    team forward below; registration opens when you say so.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <input
                      type="text"
                      value={rolloverLabel}
                      maxLength={60}
                      onChange={e => setRolloverLabel(e.target.value)}
                      placeholder="New season label (e.g., 2027-28)"
                      aria-label="New season label"
                      className="grow basis-48 min-w-0 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                    />
                    <input
                      type="date"
                      value={rolloverStarts}
                      onChange={e => setRolloverStarts(e.target.value)}
                      aria-label="New season start"
                      className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                    />
                    <input
                      type="date"
                      value={rolloverEnds}
                      onChange={e => setRolloverEnds(e.target.value)}
                      aria-label="New season end"
                      className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                    />
                    <button
                      type="button"
                      disabled={!rolloverLabel.trim()}
                      onClick={() => {
                        const label = rolloverLabel.trim();
                        setRolloverSeasonId(null);
                        void act(
                          `/api/${plural}/${orgId}/structure/rollover`,
                          {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              seasonId: season.id,
                              label,
                              ...(rolloverStarts ? { startsOn: rolloverStarts } : {}),
                              ...(rolloverEnds ? { endsOn: rolloverEnds } : {}),
                              carryRosterTeamIds: rolloverCarry,
                            }),
                          },
                          `Rolled forward to ${label}`,
                          'Failed to roll the season forward'
                        );
                      }}
                      className="px-4 py-2 text-sm min-h-[40px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
                    >
                      Roll forward
                    </button>
                  </div>
                  <RolloverCarryPicker
                    side={side}
                    orgId={orgId}
                    teams={[...new Set(season.divisions.flatMap(d => d.entries.map(e => e.team_id)))]
                      .map(id => teams.find(t => t.id === id))
                      .filter((t): t is ConsoleSeasonTeam => !!t && t.status === 'active')
                      .map(t => ({ id: t.id, name: t.name }))}
                    selected={rolloverCarry}
                    onChange={setRolloverCarry}
                  />
                </div>
              )}

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
                            <div className="flex items-center gap-1 shrink-0">
                              <Link href={`/${side}/${orgId}/divisions/${division.id}`} className="px-2 py-1 text-xs rounded-md text-brand-fg hover:underline">
                                View
                              </Link>
                              <button
                                type="button"
                                aria-expanded={editDivisionId === division.id}
                                aria-label={`Edit ${division.name}`}
                                onClick={() => setEditDivisionId(editDivisionId === division.id ? null : division.id)}
                                className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                              >
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => onConfirmDelete({ kind: 'division', id: division.id, label: division.name })}
                                aria-label={`Delete ${division.name}`}
                                className="ea-icon-btn inline-flex items-center justify-center text-muted hover:text-red-600"
                              >
                                <i className="fas fa-trash" aria-hidden="true"></i>
                              </button>
                            </div>
                          </div>
                          {editDivisionId === division.id && (
                            <DivisionEditForm
                              side={side}
                              orgId={orgId}
                              division={division}
                              onSaved={message => {
                                onSuccess('Structure', message);
                                onChanged();
                              }}
                              onError={message => onError('Structure', message)}
                              onClose={() => setEditDivisionId(null)}
                            />
                          )}
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
    </>
  );
}
