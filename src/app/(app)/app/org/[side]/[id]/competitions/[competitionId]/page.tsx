'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';

// ── The competition detail console (phase 2 R2) ─────────────────────────────
// The org-console template one level deeper: schedule (contests) + score
// entry for ONE competition. Fixture-first — the create row takes home/
// away entries and a time; scores land as one batch ("3 – 2" is one
// save); publish-to-calendar mints the mirror event. Standings arrive
// with R3 on this page.

interface EntryRow {
  id: string;
  team_id: string | null;
  profile_id: string | null;
  status: string;
  entrant_name: string;
}

interface ParticipantRow {
  id: string;
  entry_id: string;
  side: 'home' | 'away' | null;
  entrant_name: string;
  result: { score: number | null; provenance: string } | null;
}

interface ContestRow {
  id: string;
  event_id: string | null;
  scheduled_at: string | null;
  round: string | null;
  status: string;
  participants: ParticipantRow[];
}

interface StandingRowUi {
  entry_id: string;
  rank: number;
  points: number | null;
  played: number;
  stats: Record<string, number>;
  entrant_name: string;
}

interface StandingsColumnUi {
  key: string;
  label: string;
  shortLabel: string;
}

interface CompetitionInfo {
  id: string;
  name: string;
  sport_key: string;
  format: string;
  entrant_type: string;
  status: string;
  visibility: string;
}

export default function CompetitionDetailPage() {
  const params = useParams();
  const side = params.side as string;
  const orgId = params.id as string;
  const competitionId = params.competitionId as string;
  const validSide = side === 'league' || side === 'club';
  const plural = side === 'league' ? 'leagues' : 'clubs';

  const { user, initialAuthCheckComplete } = useAuth();
  const { showSuccess, showError } = useToast();

  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [competition, setCompetition] = useState<CompetitionInfo | null>(null);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [contests, setContests] = useState<ContestRow[]>([]);
  const [standings, setStandings] = useState<StandingRowUi[]>([]);
  const [standingsColumns, setStandingsColumns] = useState<StandingsColumnUi[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  // Create form
  const [homeEntryId, setHomeEntryId] = useState('');
  const [awayEntryId, setAwayEntryId] = useState('');
  const [when, setWhen] = useState('');
  const [roundLabel, setRoundLabel] = useState('');
  // Score entry: one expander at a time, values keyed by participant id.
  const [scoreContestId, setScoreContestId] = useState<string | null>(null);
  const [scoreValues, setScoreValues] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<ContestRow | null>(null);

  const base = `/api/${plural}/${orgId}/competitions/${competitionId}`;

  useEffect(() => {
    if (!validSide || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(base);
        if (cancelled) return;
        if (!res.ok) {
          setAuthorized(false);
          return;
        }
        const body = await res.json();
        if (cancelled) return;
        setAuthorized(true);
        setCompetition(body.competition ?? null);
        setEntries(body.entries ?? []);
        setContests(body.contests ?? []);
        setStandings(body.standings ?? []);
        setStandingsColumns(body.standingsColumns ?? []);
      } catch {
        if (!cancelled) setAuthorized(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [validSide, base, user?.id, reloadKey]);

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
        showError('Competition', body.error || failMessage);
        return false;
      }
      showSuccess('Competition', successMessage);
      refresh();
      return true;
    } catch (e) {
      console.error('Competition action failed:', e);
      showError('Competition', failMessage);
      return false;
    }
  };

  const createContest = async () => {
    if (competition?.format === 'leaderboard') {
      const ok = await act(
        `${base}/contests`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            competitionId,
            ...(when ? { scheduledAt: new Date(when).toISOString() } : {}),
            ...(roundLabel.trim() ? { round: roundLabel.trim() } : {}),
          }),
        },
        'Round added',
        'Failed to add the round'
      );
      if (ok) {
        setWhen('');
        setRoundLabel('');
      }
      return;
    }
    if (!homeEntryId || !awayEntryId) {
      showError('Competition', 'Pick a home and an away side');
      return;
    }
    const ok = await act(
      `${base}/contests`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          competitionId,
          homeEntryId,
          awayEntryId,
          ...(when ? { scheduledAt: new Date(when).toISOString() } : {}),
          ...(roundLabel.trim() ? { round: roundLabel.trim() } : {}),
        }),
      },
      'Game added',
      'Failed to add the game'
    );
    if (ok) {
      setHomeEntryId('');
      setAwayEntryId('');
      setWhen('');
      setRoundLabel('');
    }
  };

  const publishContest = (contestId: string) =>
    act(
      `${base}/contests/publish`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contestId,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        }),
      },
      'Published to the calendar',
      'Failed to publish'
    );

  const saveScores = async (contest: ContestRow) => {
    const results = contest.participants.map(p => ({
      participantId: p.id,
      score: Number(scoreValues[p.id] ?? ''),
    }));
    if (results.some(r => !Number.isFinite(r.score))) {
      showError('Competition', 'Enter a score for every side');
      return;
    }
    const ok = await act(
      `${base}/results`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contestId: contest.id, results }),
      },
      'Result saved',
      'Failed to save the result'
    );
    if (ok) {
      setScoreContestId(null);
      setScoreValues({});
    }
  };

  const bySide = (contest: ContestRow) => {
    const home = contest.participants.find(p => p.side === 'home');
    const away = contest.participants.find(p => p.side === 'away');
    return { home, away };
  };

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

  if (!user || authorized === false || !competition) {
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
              This competition console is for the organization&apos;s owner and managers.
            </p>
            <Link
              href={`/app/org/${side}/${orgId}`}
              className="text-sm text-brand-fg hover:text-brand-fg-strong font-medium"
            >
              Back to the console →
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
          <Link
            href={`/app/org/${side}/${orgId}`}
            className="text-sm text-brand-fg hover:text-brand-fg-strong"
          >
            ← Console
          </Link>
          <h1 className="mt-1 text-2xl sm:text-3xl font-bold text-primary">
            <i className="fas fa-trophy mr-2 text-brand-fg" aria-hidden="true"></i>
            {competition.name}
          </h1>
          <p className="mt-1 text-sm text-muted">
            {[
              SPORT_REGISTRY[competition.sport_key as keyof typeof SPORT_REGISTRY]?.display_name ??
                competition.sport_key,
              competition.format,
              competition.status,
              competition.visibility,
            ].join(' · ')}
          </p>
        </div>

        {/* Schedule */}
        <section
          aria-label="Schedule"
          className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
        >
          <h2 className="text-lg font-semibold text-primary mb-4">Schedule</h2>

          {competition.format === 'leaderboard' && (
            entries.length === 0 ? (
              <p className="text-sm text-tertiary mb-4">
                Enter at least one athlete from the console first.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2 mb-4">
                <input
                  type="datetime-local"
                  value={when}
                  onChange={e => setWhen(e.target.value)}
                  aria-label="Round time"
                  className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                />
                <input
                  type="text"
                  value={roundLabel}
                  maxLength={40}
                  onChange={e => setRoundLabel(e.target.value)}
                  placeholder="Round (e.g., Round 1)"
                  aria-label="Round label"
                  className="w-36 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                />
                <button
                  type="button"
                  onClick={() => void createContest()}
                  className="px-4 py-2 text-sm min-h-[40px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
                >
                  Add round
                </button>
              </div>
            )
          )}

          {competition.format === 'fixture' && (
            entries.length < 2 ? (
              <p className="text-sm text-tertiary mb-4">
                Enter at least two teams from the console first.
              </p>
            ) : (
              <div className="flex flex-wrap gap-2 mb-4">
                <select
                  value={homeEntryId}
                  onChange={e => setHomeEntryId(e.target.value)}
                  aria-label="Home side"
                  className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                >
                  <option value="">Home…</option>
                  {entries.map(en => (
                    <option key={en.id} value={en.id}>{en.entrant_name}</option>
                  ))}
                </select>
                <select
                  value={awayEntryId}
                  onChange={e => setAwayEntryId(e.target.value)}
                  aria-label="Away side"
                  className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                >
                  <option value="">Away…</option>
                  {entries
                    .filter(en => en.id !== homeEntryId)
                    .map(en => (
                      <option key={en.id} value={en.id}>{en.entrant_name}</option>
                    ))}
                </select>
                <input
                  type="datetime-local"
                  value={when}
                  onChange={e => setWhen(e.target.value)}
                  aria-label="Game time"
                  className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                />
                <input
                  type="text"
                  value={roundLabel}
                  maxLength={40}
                  onChange={e => setRoundLabel(e.target.value)}
                  placeholder="Round (e.g., Week 1)"
                  aria-label="Round label"
                  className="w-36 px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                />
                <button
                  type="button"
                  onClick={() => void createContest()}
                  className="px-4 py-2 text-sm min-h-[40px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
                >
                  Add game
                </button>
              </div>
            )
          )}

          {contests.length === 0 ? (
            <p className="text-sm text-tertiary">No games yet.</p>
          ) : (
            <ul className="space-y-3">
              {contests.map(contest => {
                const { home, away } = bySide(contest);
                const scored =
                  contest.participants.length > 0 &&
                  contest.participants.every(p => p.result?.score != null);
                return (
                  <li key={contest.id} className="border border-border rounded-lg p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-primary">
                          {competition.format === 'leaderboard'
                            ? `${contest.round || 'Round'} · ${contest.participants.length} player${contest.participants.length === 1 ? '' : 's'}`
                            : `${home?.entrant_name ?? '—'}${
                                scored ? ` ${home?.result?.score} – ${away?.result?.score} ` : ' vs '
                              }${away?.entrant_name ?? '—'}`}
                        </p>
                        <p className="text-xs text-muted">
                          {[
                            contest.scheduled_at
                              ? new Date(contest.scheduled_at).toLocaleString([], {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                })
                              : 'Unscheduled',
                            contest.round,
                            contest.status,
                            contest.event_id ? 'on calendar' : null,
                          ].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2 min-w-0">
                        {contest.status !== 'canceled' && (
                          <button
                            type="button"
                            onClick={() => {
                              if (scoreContestId === contest.id) {
                                setScoreContestId(null);
                              } else {
                                setScoreContestId(contest.id);
                                setScoreValues(
                                  Object.fromEntries(
                                    contest.participants.map(p => [
                                      p.id,
                                      p.result?.score != null ? String(p.result.score) : '',
                                    ])
                                  )
                                );
                              }
                            }}
                            className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                          >
                            {scoreContestId === contest.id ? 'Close score' : scored ? 'Edit score' : 'Enter score'}
                          </button>
                        )}
                        {!contest.event_id && contest.scheduled_at && contest.status === 'scheduled' && (
                          <button
                            type="button"
                            onClick={() => void publishContest(contest.id)}
                            className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                          >
                            Publish to calendar
                          </button>
                        )}
                        {contest.status === 'scheduled' && (
                          <button
                            type="button"
                            onClick={() =>
                              void act(
                                `${base}/contests`,
                                {
                                  method: 'PATCH',
                                  headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({ id: contest.id, status: 'canceled' }),
                                },
                                'Game canceled',
                                'Failed to cancel'
                              )
                            }
                            className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                          >
                            Cancel
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setDeleteTarget(contest)}
                          aria-label="Delete game"
                          className="ea-icon-btn inline-flex items-center justify-center text-muted hover:text-red-600"
                        >
                          <i className="fas fa-trash" aria-hidden="true"></i>
                        </button>
                      </div>
                    </div>

                    {scoreContestId === contest.id && (
                      <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-border-subtle pt-2">
                        {contest.participants.map(p => (
                          <label key={p.id} className="text-xs text-secondary">
                            {p.entrant_name}
                            <input
                              type="number"
                              value={scoreValues[p.id] ?? ''}
                              onChange={e =>
                                setScoreValues(prev => ({ ...prev, [p.id]: e.target.value }))
                              }
                              aria-label={`Score for ${p.entrant_name}`}
                              className="mt-0.5 block w-20 px-2 py-1.5 border border-border-strong rounded-md outline-none text-sm"
                            />
                          </label>
                        ))}
                        <button
                          type="button"
                          onClick={() => void saveScores(contest)}
                          className="px-3 py-1.5 text-sm min-h-[36px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors"
                        >
                          Save result
                        </button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Standings (R3) — the materialized table, columns drawn blindly
            from the scoring rule. Wide tables scroll inside their own
            container (the house overflow rule). */}
        {standings.length > 0 && standingsColumns.length > 0 && (
          <section
            aria-label="Standings"
            className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
          >
            <h2 className="text-lg font-semibold text-primary mb-4">Standings</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted">
                    <th className="py-1.5 pr-2 font-medium">#</th>
                    <th className="py-1.5 pr-3 font-medium">Team</th>
                    {standingsColumns.map(col => (
                      <th key={col.key} className="py-1.5 px-2 font-medium text-right" title={col.label}>
                        {col.shortLabel}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {standings.map(row => (
                    <tr key={row.entry_id} className="border-t border-border-subtle">
                      <td className="py-1.5 pr-2 text-muted">{row.rank}</td>
                      <td className="py-1.5 pr-3 font-medium text-primary">{row.entrant_name}</td>
                      {standingsColumns.map(col => (
                        <td key={col.key} className="py-1.5 px-2 text-right text-secondary">
                          {col.key === 'played'
                            ? row.played
                            : col.key === 'points'
                              ? (row.points ?? 0)
                              : (row.stats[col.key] ?? 0)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>

      <ConfirmModal
        isOpen={!!deleteTarget}
        title="Delete this game?"
        message="Its result and calendar event are removed too."
        confirmText="Delete"
        confirmButtonClass="bg-red-600 hover:bg-red-700 text-white"
        onConfirm={() => {
          const target = deleteTarget;
          setDeleteTarget(null);
          if (target) {
            void act(
              `${base}/contests?id=${encodeURIComponent(target.id)}`,
              { method: 'DELETE' },
              'Game deleted',
              'Failed to delete the game'
            );
          }
        }}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
