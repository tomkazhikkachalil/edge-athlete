'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import AppHeader from '@/components/AppHeader';
import ConfirmModal from '@/components/ConfirmModal';
import { useToast } from '@/components/Toast';
import { SPORT_REGISTRY } from '@/lib/sports/SportRegistry';
import { getStatSchema } from '@/lib/sports/stat-schemas';
import PlayerStatsPanel from '@/components/org/PlayerStatsPanel';
import ContestMediaPanel from '@/components/org/ContestMediaPanel';

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
  result: {
    score: number | null;
    provenance: string;
    dispute_status?: string | null;
    /** G2: the synced round's proof (gross/net/holes/tee/handicap/noRating). */
    payload?: Record<string, unknown> | null;
  } | null;
}

interface ContestRow {
  id: string;
  event_id: string | null;
  scheduled_at: string | null;
  round: string | null;
  status: string;
  participants: ParticipantRow[];
  /** G1 (172): a golf league round's declaration. Absent pre-172. */
  venue_id?: string | null;
  holes?: number | null;
  play_from?: string | null;
  play_to?: string | null;
}

interface VenueOption {
  id: string;
  name: string;
  golfClubId: string | null;
  golfCourseId: string | null;
  courses: { id: string; name: string; clubName?: string }[];
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

/** The participant (team-staff) view's data — the stat-lines aggregate is
 *  its whole world: club managers whose teams are entered in a
 *  competition they don't own get stat entry, nothing else (phase 4 R1). */
interface ParticipantAggregate {
  competition: { id: string; name: string; sportKey: string; access: 'owner' | 'participant' };
  contests: {
    id: string;
    round: string | null;
    scheduledAt: string | null;
    status: string;
    sides: { teamId: string | null; teamName: string | null; side: string | null }[];
  }[];
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
  // G1: the golf league round's venue (must carry a course link), holes, window.
  const [venues, setVenues] = useState<VenueOption[]>([]);
  const [roundVenueId, setRoundVenueId] = useState('');
  const [roundHoles, setRoundHoles] = useState<'' | '9' | '18'>('');
  const [playFrom, setPlayFrom] = useState('');
  const [playTo, setPlayTo] = useState('');
  // Score entry: one expander at a time, values keyed by participant id.
  const [scoreContestId, setScoreContestId] = useState<string | null>(null);
  // G2: the last sync report per contest (synced / kept / skipped with reasons).
  const [syncReports, setSyncReports] = useState<
    Record<string, { synced: number; kept: number; skipped: { entryId: string; profileId: string; reason: string }[]; blocked?: string }>
  >({});
  const [syncBusy, setSyncBusy] = useState<string | null>(null);
  // Phase 6 R4 (mig 168): dispute controls — inline note expander, never
  // a modal. Raising is withdrawable, so no confirm.
  const [disputeContestId, setDisputeContestId] = useState<string | null>(null);
  const [disputeNote, setDisputeNote] = useState('');
  // Phase 6 R6: schedule/results CSV import (dry-run-first).
  const [schedImportOpen, setSchedImportOpen] = useState(false);
  const [schedCsvText, setSchedCsvText] = useState('');
  // I2: per-athlete stat lines by CSV (fixture competitions with a stat schema).
  const [statsImportOpen, setStatsImportOpen] = useState(false);
  const [statsCsvText, setStatsCsvText] = useState('');
  const [statsBusy, setStatsBusy] = useState(false);
  const [statsReport, setStatsReport] = useState<{
    dryRun: boolean;
    report: { row: number; date: string; matchup: string; player: string; action: string; error?: string }[];
    summary: { rows: number; errors: number; imported: number; games: number };
  } | null>(null);
  const [schedBusy, setSchedBusy] = useState(false);
  const [schedReport, setSchedReport] = useState<{
    dryRun: boolean;
    summary: { rows: number; errors: number; warnings: number; created: number; reused: number; withResults: number };
    report: { row: number; matchup: string; action: string; withResult: boolean; warning?: string; error?: string }[];
  } | null>(null);
  const [scoreValues, setScoreValues] = useState<Record<string, string>>({});
  const [deleteTarget, setDeleteTarget] = useState<ContestRow | null>(null);
  // Player stats: one expander at a time (the scoreContestId pattern).
  const [statsContestId, setStatsContestId] = useState<string | null>(null);
  // Game media: same pattern (phase 4 R3).
  const [mediaContestId, setMediaContestId] = useState<string | null>(null);
  const [participantAgg, setParticipantAgg] = useState<ParticipantAggregate | null>(null);

  const base = `/api/${plural}/${orgId}/competitions/${competitionId}`;

  useEffect(() => {
    if (!validSide || !user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(base);
        if (cancelled) return;
        if (!res.ok) {
          // Not the owning org's manager — probe the participant surface:
          // a club with an approved team entry gets stat entry only.
          if (side === 'club') {
            try {
              const probe = await fetch(`${base}/stat-lines`);
              if (!cancelled && probe.ok) {
                const body = (await probe.json()) as ParticipantAggregate;
                if (!cancelled && body.competition?.access === 'participant') {
                  setParticipantAgg(body);
                }
              }
            } catch {
              // fall through to the managers-only screen
            }
          }
          if (!cancelled) setAuthorized(false);
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
        // G1: the org's venues for the golf round form (best-effort).
        if (body.competition?.sport_key === 'golf') {
          try {
            const venuesRes = await fetch(`/api/${plural}/${orgId}/venues`);
            if (venuesRes.ok) {
              const venuesBody = await venuesRes.json();
              if (!cancelled) setVenues(venuesBody.venues ?? []);
            }
          } catch {
            /* the venue select simply stays empty */
          }
        }
      } catch {
        if (!cancelled) setAuthorized(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [validSide, side, base, user?.id, reloadKey, orgId, plural]);

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
            ...(roundVenueId ? { venueId: roundVenueId } : {}),
            ...(roundHoles ? { holes: Number(roundHoles) } : {}),
            ...(playFrom && playTo ? { playFrom, playTo } : {}),
          }),
        },
        'Round added',
        'Failed to add the round'
      );
      if (ok) {
        setWhen('');
        setRoundLabel('');
        setPlayFrom('');
        setPlayTo('');
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

  // G2: fill a league round from members' posted rounds / confirm it.
  const syncRounds = async (contestId: string) => {
    setSyncBusy(contestId);
    try {
      const res = await fetch(`${base}/golf-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contestId }),
      });
      const body = await res.json();
      if (!res.ok) {
        showError('Competition', body.error || 'Sync failed');
        return;
      }
      const report = (body.reports ?? [])[0];
      if (report) setSyncReports(prev => ({ ...prev, [contestId]: report }));
      showSuccess(
        'Competition',
        report?.blocked
          ? `Nothing synced — ${report.blocked}`
          : `${report?.synced ?? 0} round${report?.synced === 1 ? '' : 's'} synced`
      );
      refresh();
    } catch {
      showError('Competition', 'Sync failed — please try again');
    } finally {
      setSyncBusy(null);
    }
  };
  const confirmRounds = (contestId: string) =>
    act(
      `${base}/golf-sync/confirm`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contestId }),
      },
      'Round confirmed',
      'Failed to confirm the round'
    );

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

  // Phase 6 R4: raise / withdraw / resolve (the dispute-server matrix;
  // this console is the owner org, so all three are available here —
  // participating orgs raise through the same API from their side).
  const disputeAct = async (
    contestId: string,
    action: 'raise' | 'withdraw' | 'resolve',
    note?: string
  ) => {
    const ok = await act(
      `${base}/results/dispute`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contestId, action, ...(note ? { note } : {}) }),
      },
      action === 'raise'
        ? 'Result disputed — both organizations were notified'
        : action === 'withdraw'
          ? 'Dispute withdrawn'
          : 'Dispute resolved',
      'Failed to update the dispute'
    );
    if (ok) {
      setDisputeContestId(null);
      setDisputeNote('');
    }
  };

  // Phase 6 R6: the schedule-import runner (Preview → Import).
  // I1: the same expander takes a pasted .ics (calendar export) instead of CSV.
  const [schedIcsMode, setSchedIcsMode] = useState(false);
  const runScheduleImport = async (dryRun: boolean) => {
    if (schedBusy) return;
    setSchedBusy(true);
    try {
      const response = await fetch(`${base}/schedule-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(schedIcsMode ? { ics: schedCsvText } : { csv: schedCsvText }),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          dryRun,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        showError('Schedule import', body.error || 'Import failed');
        return;
      }
      setSchedReport(body);
      if (!dryRun) {
        showSuccess('Schedule import', 'Imported — games are on the schedule');
        refresh();
      }
    } catch {
      showError('Schedule import', 'Import failed');
    } finally {
      setSchedBusy(false);
    }
  };

  const runStatsImport = async (dryRun: boolean) => {
    if (statsBusy) return;
    setStatsBusy(true);
    try {
      const response = await fetch(`${base}/stat-lines-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          csv: statsCsvText,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
          dryRun,
        }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        showError('Player stats import', body.error || 'Import failed');
        return;
      }
      setStatsReport(body);
      if (!dryRun) {
        showSuccess('Player stats import', 'Imported — stats are on the games');
        refresh();
      }
    } catch {
      showError('Player stats import', 'Import failed');
    } finally {
      setStatsBusy(false);
    }
  };

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

  // Team-staff view: stat entry for the club's own players in a
  // competition someone else owns — no schedule/entry/standings controls.
  if (user && authorized === false && participantAgg) {
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
              {participantAgg.competition.name}
            </h1>
            <p className="mt-1 text-sm text-muted">
              Player stats for your club&apos;s teams — recorded as club stats until the
              competition owner verifies them.
            </p>
          </div>
          <section
            aria-label="Player stats"
            className="bg-surface rounded-lg shadow-sm border border-border p-4 sm:p-6"
          >
            <h2 className="text-lg font-semibold text-primary mb-4">Games</h2>
            {participantAgg.contests.length === 0 ? (
              <p className="text-sm text-tertiary">No games yet.</p>
            ) : (
              <ul className="space-y-3">
                {participantAgg.contests.map(contest => (
                  <li key={contest.id} className="border border-border rounded-lg p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-primary">
                          {contest.sides.map(s => s.teamName ?? '—').join(' vs ') || 'Game'}
                        </p>
                        <p className="text-xs text-muted">
                          {[
                            contest.scheduledAt
                              ? new Date(contest.scheduledAt).toLocaleString([], {
                                  dateStyle: 'medium',
                                  timeStyle: 'short',
                                })
                              : 'Unscheduled',
                            contest.round,
                            contest.status,
                          ].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      {contest.status !== 'canceled' && (
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setStatsContestId(prev => (prev === contest.id ? null : contest.id))
                            }
                            className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                          >
                            {statsContestId === contest.id ? 'Close player stats' : 'Player stats'}
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              setMediaContestId(prev => (prev === contest.id ? null : contest.id))
                            }
                            className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                          >
                            {mediaContestId === contest.id ? 'Close media' : 'Media'}
                          </button>
                        </div>
                      )}
                    </div>
                    {statsContestId === contest.id && (
                      <PlayerStatsPanel base={base} contestId={contest.id} />
                    )}
                    {mediaContestId === contest.id && (
                      <ContestMediaPanel base={base} contestId={contest.id} />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </main>
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
                {competition.sport_key === 'golf' && (
                  <>
                    {/* G1: a golf league round — course (via a golf-linked
                        venue), hole count, play window. Members' rounds in
                        the window at that course fill the results (G2). */}
                    <select
                      value={roundVenueId}
                      onChange={e => setRoundVenueId(e.target.value)}
                      aria-label="Round course"
                      // max-w-full: a select's intrinsic width is its widest option;
                      // without the cap it pushes the 375px page sideways.
                      className="max-w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                    >
                      <option value="">Course (optional)</option>
                      {venues.map(v => (
                        <option
                          key={v.id}
                          value={v.id}
                          disabled={!v.golfClubId && !v.golfCourseId}
                          title={!v.golfClubId && !v.golfCourseId ? 'Link a golf course to this venue first' : undefined}
                        >
                          {v.name}
                          {v.courses.length > 0 ? ` — ${v.courses[0].name}` : ' (no course linked)'}
                        </option>
                      ))}
                    </select>
                    <select
                      value={roundHoles}
                      onChange={e => setRoundHoles(e.target.value as '' | '9' | '18')}
                      aria-label="Holes"
                      className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                    >
                      <option value="">Holes</option>
                      <option value="9">9 holes</option>
                      <option value="18">18 holes</option>
                    </select>
                    <input
                      type="date"
                      value={playFrom}
                      onChange={e => setPlayFrom(e.target.value)}
                      aria-label="Play from"
                      className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                    />
                    <input
                      type="date"
                      value={playTo}
                      onChange={e => setPlayTo(e.target.value)}
                      aria-label="Play to"
                      className="px-3 py-2 border border-border-strong rounded-md outline-none text-sm"
                    />
                  </>
                )}
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

          {/* Phase 6 R6: schedule + historical results by CSV. */}
          {competition.format === 'fixture' && (
            <div className="mb-4">
              <button
                type="button"
                onClick={() => {
                  setSchedImportOpen(o => !o);
                  setSchedReport(null);
                }}
                className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
              >
                {schedImportOpen ? 'Close schedule import' : 'Import schedule CSV'}
              </button>
              {schedImportOpen && (
                <div className="mt-2 border border-border rounded-lg p-3">
                  <div className="flex flex-wrap items-center gap-2 mb-2">
                    <button
                      type="button"
                      aria-pressed={schedIcsMode}
                      onClick={() => {
                        setSchedIcsMode(v => !v);
                        setSchedReport(null);
                      }}
                      className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                    >
                      {schedIcsMode ? 'Paste CSV instead' : 'Paste ICS instead'}
                    </button>
                  </div>
                  {schedIcsMode ? (
                    <p className="text-xs text-muted mb-2">
                      Paste the contents of a calendar export (<code>.ics</code>). Each event&apos;s
                      title must read <code>Home vs Away</code> (or <code>Away @ Home</code>);
                      its location is matched to your venues. Recurring and all-day events are
                      reported per row — expand recurring events in your calendar first.
                    </p>
                  ) : (
                    <p className="text-xs text-muted mb-2">
                      Columns: <code>date, time, home, away</code> (optional: venue,
                      home_score, away_score — scores mark the game played and the
                      result is labeled <em>imported</em>). Times read in your
                      timezone. Team names must match this competition&apos;s entries.
                    </p>
                  )}
                  <textarea
                    value={schedCsvText}
                    onChange={e => {
                      setSchedCsvText(e.target.value);
                      setSchedReport(null);
                    }}
                    rows={5}
                    placeholder={
                      schedIcsMode
                        ? 'BEGIN:VCALENDAR\nBEGIN:VEVENT\nDTSTART;TZID=America/Toronto:20261003T190000\nSUMMARY:Blazers vs Comets\nEND:VEVENT\nEND:VCALENDAR'
                        : 'date,time,home,away,home_score,away_score\n2026-10-03,19:00,Blazers,Comets,3,2'
                    }
                    aria-label={schedIcsMode ? 'Schedule ICS' : 'Schedule CSV'}
                    className="w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm font-mono"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={schedBusy || schedCsvText.trim() === ''}
                      onClick={() => void runScheduleImport(true)}
                      className="px-3 py-1.5 text-sm min-h-[36px] rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50"
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      disabled={schedBusy || schedReport === null || schedReport.dryRun !== true}
                      onClick={() => void runScheduleImport(false)}
                      title={schedReport?.dryRun !== true ? 'Preview first' : undefined}
                      className="px-3 py-1.5 text-sm min-h-[36px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
                    >
                      Import
                    </button>
                  </div>
                  {schedReport && (
                    <div className="mt-2 text-xs text-secondary">
                      <p className="font-medium text-primary mb-1">
                        {schedReport.dryRun ? 'Preview' : 'Imported'}:{' '}
                        {schedReport.summary.created} games ({schedReport.summary.withResults} with
                        results), {schedReport.summary.reused} already existed
                        {schedReport.summary.errors > 0 && (
                          <span className="text-red-600"> · {schedReport.summary.errors} errors</span>
                        )}
                        {schedReport.summary.warnings > 0 && (
                          <span className="text-amber-700 dark:text-amber-300"> · {schedReport.summary.warnings} warnings</span>
                        )}
                      </p>
                      <div className="overflow-x-auto">
                        <ul className="space-y-0.5">
                          {schedReport.report.map(r => (
                            <li key={r.row} className={r.error ? 'text-red-600' : r.warning ? 'text-amber-700 dark:text-amber-300' : ''}>
                              #{r.row} {r.matchup} — {r.action}
                              {r.withResult ? ' + result' : ''}
                              {r.error ? ` — ${r.error}` : r.warning ? ` — ${r.warning}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Phase 6c I2: per-athlete stat lines by CSV — the last §10 importer. */}
          {competition.format === 'fixture' && !!getStatSchema(competition.sport_key) && (
            <div className="mb-4">
              <button
                type="button"
                onClick={() => {
                  setStatsImportOpen(o => !o);
                  setStatsReport(null);
                }}
                className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
              >
                {statsImportOpen ? 'Close player stats import' : 'Import player stats CSV'}
              </button>
              {statsImportOpen && (
                <div className="mt-2 border border-border rounded-lg p-3">
                  <p className="text-xs text-muted mb-2">
                    Columns: <code>date, home, away, team, player</code> plus any of{' '}
                    <code>{(getStatSchema(competition.sport_key)?.fields ?? []).map(f => f.key).join(', ')}</code>.
                    Each row names a game already on the schedule (that date, those teams), the
                    player&apos;s team and the player exactly as on the roster. Imported stats are
                    labeled <em>imported</em>.
                  </p>
                  <textarea
                    value={statsCsvText}
                    onChange={e => {
                      setStatsCsvText(e.target.value);
                      setStatsReport(null);
                    }}
                    rows={5}
                    placeholder={'date,home,away,team,player,goals,assists\n2026-10-03,Blazers,Comets,Blazers,Ava Chen,2,1'}
                    aria-label="Player stats CSV"
                    className="w-full px-3 py-2 border border-border-strong rounded-md outline-none text-sm font-mono"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={statsBusy || !statsCsvText.trim()}
                      onClick={() => void runStatsImport(true)}
                      className="px-3 py-1.5 text-sm min-h-[36px] rounded-lg border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-50"
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      disabled={statsBusy || statsReport === null || statsReport.dryRun !== true}
                      onClick={() => void runStatsImport(false)}
                      title={statsReport?.dryRun !== true ? 'Preview first' : undefined}
                      className="px-3 py-1.5 text-sm min-h-[36px] rounded-lg bg-brand text-white font-medium hover:bg-brand-hover transition-colors disabled:opacity-50"
                    >
                      Import
                    </button>
                  </div>
                  {statsReport && (
                    <div className="mt-2 text-xs text-secondary">
                      <p className="font-medium text-primary mb-1">
                        {statsReport.dryRun ? 'Preview' : 'Imported'}: {statsReport.summary.imported} stat lines across{' '}
                        {statsReport.summary.games} games
                        {statsReport.summary.errors > 0 && (
                          <span className="text-red-600"> · {statsReport.summary.errors} errors</span>
                        )}
                      </p>
                      <div className="overflow-x-auto">
                        <ul className="space-y-0.5">
                          {statsReport.report.map(r => (
                            <li key={r.row} className={r.error ? 'text-red-600' : ''}>
                              #{r.row} {r.date} {r.matchup} · {r.player} — {r.action}
                              {r.error ? ` — ${r.error}` : ''}
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
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
                          {/* G1: the golf league round's declaration chips. */}
                          {(contest.holes || contest.play_from) && (
                            <span className="ml-2 text-xs font-normal text-tertiary">
                              {[
                                contest.holes ? `${contest.holes} holes` : null,
                                contest.play_from && contest.play_to
                                  ? `${contest.play_from} → ${contest.play_to}`
                                  : null,
                                contest.venue_id
                                  ? (venues.find(v => v.id === contest.venue_id)?.courses[0]?.name ??
                                    venues.find(v => v.id === contest.venue_id)?.name ??
                                    null)
                                  : null,
                              ]
                                .filter(Boolean)
                                .join(' · ')}
                            </span>
                          )}
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
                          {/* R4: the unconfirmed marker — a disputed score
                              must never read as settled. */}
                          {contest.participants[0]?.result?.dispute_status === 'disputed' && (
                            <span className="ml-1.5 text-amber-700 dark:text-amber-300 font-medium">
                              · disputed
                            </span>
                          )}
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
                        {/* G2: a golf league round fills itself. */}
                        {contest.status !== 'canceled' &&
                          competition.sport_key === 'golf' &&
                          competition.format === 'leaderboard' &&
                          !!contest.holes && (
                            <>
                              <button
                                type="button"
                                disabled={syncBusy === contest.id}
                                onClick={() => void syncRounds(contest.id)}
                                className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors disabled:opacity-60"
                              >
                                {syncBusy === contest.id ? 'Syncing…' : 'Sync rounds'}
                              </button>
                              {contest.participants.some(p => p.result?.provenance === 'self_reported') && (
                                <button
                                  type="button"
                                  aria-label="Confirm rounds"
                                  onClick={() => void confirmRounds(contest.id)}
                                  className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                                >
                                  Confirm rounds
                                </button>
                              )}
                            </>
                          )}
                        {contest.status !== 'canceled' &&
                          competition.format === 'fixture' &&
                          !!getStatSchema(competition.sport_key) && (
                            <button
                              type="button"
                              onClick={() =>
                                setStatsContestId(prev => (prev === contest.id ? null : contest.id))
                              }
                              className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                            >
                              {statsContestId === contest.id ? 'Close player stats' : 'Player stats'}
                            </button>
                          )}
                        {contest.status !== 'canceled' && (
                          <button
                            type="button"
                            onClick={() =>
                              setMediaContestId(prev => (prev === contest.id ? null : contest.id))
                            }
                            className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                          >
                            {mediaContestId === contest.id ? 'Close media' : 'Media'}
                          </button>
                        )}
                        {/* Phase 6 R4: dispute controls on scored contests. */}
                        {scored && (() => {
                          const ds = contest.participants[0]?.result?.dispute_status ?? 'none';
                          if (ds === 'disputed') {
                            return (
                              <>
                                <button
                                  type="button"
                                  onClick={() => void disputeAct(contest.id, 'withdraw')}
                                  className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                                >
                                  Withdraw dispute
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void disputeAct(contest.id, 'resolve')}
                                  className="px-2 py-1 text-xs rounded-md border border-amber-400 text-amber-700 dark:text-amber-300 hover:bg-surface-sunken transition-colors"
                                >
                                  Resolve dispute
                                </button>
                              </>
                            );
                          }
                          if (ds !== 'resolved') {
                            return (
                              <button
                                type="button"
                                onClick={() =>
                                  setDisputeContestId(prev => (prev === contest.id ? null : contest.id))
                                }
                                className="px-2 py-1 text-xs rounded-md border border-border-strong text-secondary hover:bg-surface-sunken transition-colors"
                              >
                                {disputeContestId === contest.id ? 'Close dispute' : 'Dispute result'}
                              </button>
                            );
                          }
                          return null;
                        })()}
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

                    {/* G2: the synced rows — gross/net/holes with the provenance
                        chip, and a plain reason for anyone gross-only or skipped. */}
                    {competition.sport_key === 'golf' &&
                      competition.format === 'leaderboard' &&
                      !!contest.holes &&
                      (contest.participants.some(p => p.result) || syncReports[contest.id]) && (
                        <div className="mt-2 border-t border-border-subtle pt-2 text-xs text-secondary space-y-1">
                          {contest.participants
                            .filter(p => p.result)
                            .map(p => {
                              const payload = (p.result?.payload ?? {}) as {
                                gross?: number;
                                net?: number;
                                holes?: number;
                                tee?: string | null;
                                courseHandicap?: number;
                                noRating?: boolean;
                                noIndex?: boolean;
                              };
                              return (
                                <p key={p.id}>
                                  <span className="font-medium text-primary">{p.entrant_name}</span>
                                  {typeof payload.gross === 'number'
                                    ? ` · gross ${payload.gross}${typeof payload.net === 'number' ? ` · net ${payload.net} (CH ${payload.courseHandicap})` : ''}${payload.holes ? ` · ${payload.holes} holes` : ''}${payload.tee ? ` · ${payload.tee}` : ''}`
                                    : ` · ${p.result?.score ?? '—'}`}
                                  <span className="ml-2 rounded-full border border-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-tertiary">
                                    {p.result?.provenance === 'self_reported'
                                      ? 'posted'
                                      : p.result?.provenance === 'league_verified'
                                        ? 'verified'
                                        : (p.result?.provenance ?? '')}
                                  </span>
                                  {payload.noRating && (
                                    <span className="ml-2 text-amber-700">no rating for this tee — gross only</span>
                                  )}
                                  {payload.noIndex && (
                                    <span className="ml-2 text-amber-700">no handicap index yet — gross only</span>
                                  )}
                                </p>
                              );
                            })}
                          {syncReports[contest.id]?.blocked && (
                            <p className="text-amber-700">Nothing synced — {syncReports[contest.id].blocked}</p>
                          )}
                          {syncReports[contest.id]?.skipped.map(s => (
                            <p key={s.entryId ?? s.profileId} className="text-tertiary">
                              {/* W1: match on the participant's entry id — the
                                  profileId route printed a raw UUID whenever
                                  the entries list hadn't resolved. */}
                              {contest.participants.find(p => p.entry_id === s.entryId)?.entrant_name
                                ?? contest.participants.find(p => p.entry_id && entries.find(e => e.id === p.entry_id)?.profile_id === s.profileId)?.entrant_name
                                ?? 'A member'}
                              {' — '}
                              {s.reason}
                            </p>
                          ))}
                        </div>
                      )}

                    {disputeContestId === contest.id && (
                      <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-border-subtle pt-2">
                        <label className="flex-1 min-w-48 text-xs text-secondary">
                          What’s wrong with this result? (optional, shared with both organizations)
                          <textarea
                            value={disputeNote}
                            onChange={e => setDisputeNote(e.target.value.slice(0, 500))}
                            rows={2}
                            className="mt-0.5 block w-full px-2 py-1.5 border border-border-strong rounded-md outline-none text-sm"
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => void disputeAct(contest.id, 'raise', disputeNote.trim() || undefined)}
                          className="px-3 py-1.5 text-sm min-h-[36px] rounded-lg bg-amber-600 text-white font-medium hover:bg-amber-700 transition-colors"
                        >
                          Dispute
                        </button>
                      </div>
                    )}

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

                    {statsContestId === contest.id && (
                      <PlayerStatsPanel base={base} contestId={contest.id} />
                    )}
                    {mediaContestId === contest.id && (
                      <ContestMediaPanel base={base} contestId={contest.id} />
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
                    <th className="py-1.5 pr-3 font-medium">
                      {competition.entrant_type === 'athlete' ? 'Player' : 'Team'}
                    </th>
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
                              ? (row.points ?? '—')
                              : (row.stats[col.key] ?? '—')}
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
