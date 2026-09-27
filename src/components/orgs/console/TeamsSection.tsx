'use client';

import { useCallback, useState } from 'react';
import TeamRosterPanel from './TeamRosterPanel';
import TeamIdentityForm from './TeamIdentityForm';
import { teamLogoUrl } from '@/lib/teams/logo-url';
import { ORG_ROUTE_FAMILY, type OrgKind } from '@/lib/orgs/org-ref';

// ── The console's Teams section (teams & divisions program, PR 5) ───────────
// Lifted out of the console page byte for byte (every label the specs read
// is unchanged): add a team, archive / restore (teams persist — no manager
// delete), the per-team roster import (new stub athletes + claim links).
// PR 5 adds the per-team ROSTER panel — who is on the team now, add / move /
// remove (TeamRosterPanel).
//
// 375px: one column; every expander opens inline, never a modal.

export interface ConsoleTeamRow {
  id: string;
  name: string;
  display_name: string | null;
  status: 'active' | 'archived';
  // PR 6 (242): the identity the structure GET carries.
  sport_key?: string | null;
  primary_color?: string | null;
  secondary_color?: string | null;
  logo_path?: string | null;
}

interface Props {
  side: OrgKind;
  orgId: string;
  teams: ConsoleTeamRow[];
  /** The console re-reads its structure (the page's refresh). */
  onChanged: () => void;
  onSuccess: (title: string, message: string) => void;
  onError: (title: string, message: string) => void;
}

type ImportReportRow = { name: string; claimUrl: string | null; emailSent: boolean; error?: string };

export default function TeamsSection({ side, orgId, teams, onChanged, onSuccess, onError }: Props) {
  const plural = ORG_ROUTE_FAMILY[side];
  const base = `/api/${plural}/${orgId}/structure`;
  const [teamName, setTeamName] = useState('');
  // Roster import (R3): per-team inline expander, the divisionSeasonId
  // toggle precedent (never a modal — 375px).
  const [importTeamId, setImportTeamId] = useState<string | null>(null);
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<ImportReportRow[] | null>(null);
  // PR 5: the open roster panel, and a re-read after a move (both teams change).
  const [rosterTeamId, setRosterTeamId] = useState<string | null>(null);
  const [rosterReload, setRosterReload] = useState(0);
  // PR 6: the open identity editor.
  const [editTeamId, setEditTeamId] = useState<string | null>(null);

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

  const createTeam = async () => {
    if (!teamName.trim()) {
      onError('Structure', 'A team name is required');
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
        onError('Roster import', body.error || 'Import failed');
        return;
      }
      setImportReport(body.report ?? []);
      setImportText('');
      onSuccess('Roster import', `${(body.report ?? []).filter((r: { error?: string }) => !r.error).length} athletes imported`);
      onChanged();
    } catch (e) {
      console.error('Roster import failed:', e);
      onError('Roster import', 'Import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <section
    id="teams"
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
              <div className="min-w-0 grow basis-40 flex items-center gap-2">
                {teamLogoUrl(team.id, team.logo_path) ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a tokenless streamer URL busted by ?v (the org-logo precedent)
                  <img src={teamLogoUrl(team.id, team.logo_path)!} alt="" className="h-8 w-8 shrink-0 rounded-md border border-border object-contain bg-surface" />
                ) : team.primary_color ? (
                  <span aria-hidden="true" className="h-8 w-8 shrink-0 rounded-md border border-border" style={{ background: team.secondary_color ? `linear-gradient(135deg, ${team.primary_color}, ${team.secondary_color})` : team.primary_color }} />
                ) : null}
                <div className="min-w-0">
                  <p className="font-medium text-primary">{team.name}</p>
                  {team.status === 'archived' && <p className="text-xs text-muted">Archived</p>}
                  {team.display_name && team.display_name !== team.name && <p className="text-xs text-muted">Shown as {team.display_name}</p>}
                </div>
              </div>
              <div className="flex flex-wrap gap-2 shrink-0">
                {team.status === 'active' && (
                  <button
                    type="button"
                    aria-expanded={editTeamId === team.id}
                    aria-label={`Edit ${team.name}`}
                    onClick={() => setEditTeamId(editTeamId === team.id ? null : team.id)}
                    className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                  >
                    Edit
                  </button>
                )}
                {team.status === 'active' && (
                  <button
                    type="button"
                    aria-expanded={rosterTeamId === team.id}
                    onClick={() => setRosterTeamId(rosterTeamId === team.id ? null : team.id)}
                    className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                  >
                    {rosterTeamId === team.id ? 'Close roster' : 'Roster'}
                  </button>
                )}
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
              {editTeamId === team.id && team.status === 'active' && (
                <TeamIdentityForm
                  side={side}
                  orgId={orgId}
                  team={team}
                  onSaved={message => {
                    onSuccess('Team', message);
                    onChanged();
                  }}
                  onError={message => onError('Team', message)}
                  onClose={() => setEditTeamId(null)}
                />
              )}
              {rosterTeamId === team.id && team.status === 'active' && (
                <TeamRosterPanel
                  key={`${team.id}:${rosterReload}`}
                  side={side}
                  orgId={orgId}
                  team={{ id: team.id, name: team.name }}
                  otherTeams={teams.filter(t => t.status === 'active' && t.id !== team.id).map(t => ({ id: t.id, name: t.name }))}
                  onSuccess={message => onSuccess('Team roster', message)}
                  onError={message => onError('Team roster', message)}
                  onMoved={() => setRosterReload(k => k + 1)}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
