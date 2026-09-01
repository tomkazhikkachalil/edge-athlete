'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/Toast';
import { getStatSchema } from '@/lib/sports/stat-schemas';

// ── Player stats entry for ONE contest (phase 4 R1) ─────────────────────────
// Mounted inside a contest row's expander on the competition console —
// owner AND participant views share it (the server decides authority; the
// panel just renders what the aggregate returns: participants see only
// their own club's teams and lines). Data source = the stat-lines
// aggregate; a degraded read (pre-157 database) renders a quiet
// unavailable note, never an error state.

interface StatLineRow {
  id: string;
  contest_id: string;
  team_id: string | null;
  profile_id: string;
  stats: Record<string, number>;
  provenance: string;
}

interface AggregateSide {
  participantId: string;
  side: string | null;
  teamId: string | null;
  teamName: string | null;
}

interface Aggregate {
  competition: { id: string; name: string; sportKey: string; access: 'owner' | 'participant' };
  contests: { id: string; sides: AggregateSide[] }[];
  rosterByTeam: Record<string, { profileId: string; displayName: string }[]>;
  lines: StatLineRow[];
  linesAvailable: boolean;
}

const PROVENANCE_LABELS: Record<string, string> = {
  sanctioned: 'Sanctioned',
  league_verified: 'League verified',
  club_recorded: 'Club recorded',
  self_reported: 'Self reported',
  imported: 'Imported',
};

export default function PlayerStatsPanel({
  base,
  contestId,
}: {
  /** `/api/{plural}/{orgId}/competitions/{competitionId}` */
  base: string;
  contestId: string;
}) {
  const { showSuccess, showError } = useToast();
  const [agg, setAgg] = useState<Aggregate | null>(null);
  const [failed, setFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  // Input values keyed profileId → statKey → raw string.
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${base}/stat-lines`);
        if (cancelled) return;
        if (!res.ok) {
          setFailed(true);
          return;
        }
        const body = (await res.json()) as Aggregate;
        if (cancelled) return;
        setAgg(body);
        const prefill: Record<string, Record<string, string>> = {};
        for (const line of body.lines) {
          if (line.contest_id !== contestId) continue;
          prefill[line.profile_id] = Object.fromEntries(
            Object.entries(line.stats).map(([k, v]) => [k, String(v)])
          );
        }
        setValues(prefill);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [base, contestId, reloadKey]);

  if (failed) {
    return <p className="mt-2 text-xs text-tertiary">Player stats aren’t available.</p>;
  }
  if (!agg) {
    return <p className="mt-2 text-xs text-tertiary">Loading player stats…</p>;
  }
  if (!agg.linesAvailable) {
    return (
      <p className="mt-2 text-xs text-tertiary">
        Player stats aren’t set up yet (migration 157).
      </p>
    );
  }
  const schema = getStatSchema(agg.competition.sportKey);
  if (!schema) {
    return <p className="mt-2 text-xs text-tertiary">Player stats aren’t available for this sport.</p>;
  }
  const contest = agg.contests.find(c => c.id === contestId);
  if (!contest) return null;

  const teams = contest.sides
    .filter(s => s.teamId && agg.rosterByTeam[s.teamId])
    .map(s => ({ teamId: s.teamId as string, teamName: s.teamName ?? 'Team' }));
  if (teams.length === 0) {
    return (
      <p className="mt-2 text-xs text-tertiary">
        No rostered teams to record stats for in this game.
      </p>
    );
  }

  const lineFor = (profileId: string) =>
    agg.lines.find(l => l.contest_id === contestId && l.profile_id === profileId);

  const saveTeam = async (teamId: string) => {
    const roster = agg.rosterByTeam[teamId] ?? [];
    const lines = roster
      .map(({ profileId }) => {
        const raw = values[profileId] ?? {};
        const stats: Record<string, number> = {};
        for (const field of schema.fields) {
          const text = (raw[field.key] ?? '').trim();
          if (text === '') continue;
          const num = Number(text);
          if (!Number.isFinite(num)) return { profileId, invalid: true as const, stats };
          stats[field.key] = num;
        }
        return { profileId, invalid: false as const, stats };
      })
      .filter(l => l.invalid || Object.keys(l.stats).length > 0);
    if (lines.some(l => l.invalid)) {
      showError('Player stats', 'Stats must be numbers');
      return;
    }
    if (lines.length === 0) {
      showError('Player stats', 'Enter at least one stat first');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${base}/stat-lines`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contestId,
          lines: lines.map(l => ({ profileId: l.profileId, teamId, stats: l.stats })),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        showError('Player stats', body.error || 'Failed to save player stats');
        return;
      }
      showSuccess('Player stats', 'Player stats saved');
      setReloadKey(k => k + 1);
    } catch {
      showError('Player stats', 'Failed to save player stats');
    } finally {
      setSaving(false);
    }
  };

  const deleteLine = async (lineId: string) => {
    try {
      const res = await fetch(`${base}/stat-lines?lineId=${encodeURIComponent(lineId)}`, {
        method: 'DELETE',
      });
      const body = await res.json();
      if (!res.ok) {
        showError('Player stats', body.error || 'Failed to remove the stat line');
        return;
      }
      showSuccess('Player stats', 'Stat line removed');
      setReloadKey(k => k + 1);
    } catch {
      showError('Player stats', 'Failed to remove the stat line');
    }
  };

  return (
    <div className="mt-2 space-y-4 border-t border-border-subtle pt-2">
      {teams.map(({ teamId, teamName }) => {
        const roster = agg.rosterByTeam[teamId] ?? [];
        return (
          <div key={teamId}>
            <p className="text-sm font-semibold text-primary">{teamName}</p>
            {roster.length === 0 ? (
              <p className="mt-1 text-xs text-tertiary">No active roster on this team.</p>
            ) : (
              <ul className="mt-1 space-y-2">
                {roster.map(({ profileId, displayName }) => {
                  const existing = lineFor(profileId);
                  return (
                    <li key={profileId} className="flex flex-wrap items-end gap-2">
                      <span className="w-full sm:w-40 min-w-0 text-sm text-secondary">
                        <span className="block truncate">{displayName}</span>
                        {existing && (
                          <span className="block text-[11px] text-muted">
                            {PROVENANCE_LABELS[existing.provenance] ?? existing.provenance}
                          </span>
                        )}
                      </span>
                      {schema.fields.map(field => (
                        <label key={field.key} className="text-[11px] text-muted">
                          {field.shortLabel}
                          <input
                            type="number"
                            inputMode="numeric"
                            value={values[profileId]?.[field.key] ?? ''}
                            onChange={e =>
                              setValues(prev => ({
                                ...prev,
                                [profileId]: { ...prev[profileId], [field.key]: e.target.value },
                              }))
                            }
                            aria-label={`${field.label} for ${displayName}`}
                            className="mt-0.5 block w-16 px-2 py-1.5 border border-border-strong rounded-md outline-none text-sm"
                          />
                        </label>
                      ))}
                      {existing && (
                        <button
                          type="button"
                          onClick={() => void deleteLine(existing.id)}
                          aria-label={`Remove stat line for ${displayName}`}
                          className="ea-icon-btn inline-flex items-center justify-center text-muted hover:text-red-600"
                        >
                          <i className="fas fa-trash" aria-hidden="true"></i>
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {roster.length > 0 && (
              <button
                type="button"
                disabled={saving}
                onClick={() => void saveTeam(teamId)}
                className="mt-2 px-3 py-1.5 text-sm min-h-[36px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-60"
              >
                Save {teamName} stats
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
